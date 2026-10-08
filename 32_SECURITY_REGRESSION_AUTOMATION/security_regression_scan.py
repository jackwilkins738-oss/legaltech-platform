#!/usr/bin/env python3
from pathlib import Path
import re, json, sys, hashlib
ROOT=Path(__file__).resolve().parents[1]
POLICY=json.loads((Path(__file__).resolve().parent/'security_policy.json').read_text())
SKIP={'.git','node_modules','dist','build','.venv','venv','__pycache__'}
TEXT={'.md','.json','.yaml','.yml','.ts','.js','.mjs','.cjs','.py','.sql','.env','.txt','.toml','.ini','.sh','.pem','.key','.crt','.cer'}
PRIVATE_FILE_SUFFIXES={'.key','.pfx','.p12','.jks'}
SECRET_PATTERNS=[
('AWS_ACCESS_KEY',re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
('GITHUB_PAT_CLASSIC',re.compile(r'\bgh[pousr]_[A-Za-z0-9_]{30,}\b')),
('GITHUB_PAT_FINE_GRAINED',re.compile(r'\bgithub_pat_[A-Za-z0-9_]{50,}\b')),
('OPENAI_KEY',re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b')),
('NPM_TOKEN',re.compile(r'\bnpm_[A-Za-z0-9]{30,}\b')),
('SLACK_TOKEN',re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{20,}\b')),
('GOOGLE_API_KEY',re.compile(r'\bAIza[0-9A-Za-z_-]{30,}\b')),
('AZURE_STORAGE_KEY',re.compile(r'(?i)AccountKey=[A-Za-z0-9+/]{32,}={0,2}')),
('DATABASE_URI_PASSWORD',re.compile(r'(?i)\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?)://[^\s:/@]+:([^\s@]{8,})@')),
('PRIVATE_KEY',re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----')),
]
SAFE_VALUE_MARKERS=('change-me','changeme','example','dummy','synthetic','local-only','placeholder','redacted','not-a-secret','test-only','${{','${','<secret>','<token>')
GENERIC_ASSIGNMENT=re.compile(r'''(?ix)\b(?:client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_~+/.=-]{20,})''')
ACTION_USE=re.compile(r'(?im)^\s*-?\s*uses:\s*([^\s#]+)')
FULL_SHA=re.compile(r'^[0-9a-f]{40}$',re.I)

def files():
  for p in ROOT.rglob('*'):
    if p.is_file() and not any(x in SKIP for x in p.parts) and (p.suffix.lower() in TEXT or p.name.startswith('.env')): yield p

def safe_secret_value(value):
  lower=value.lower()
  return any(marker in lower for marker in SAFE_VALUE_MARKERS)

def scan_secret_files():
  out=[]
  for p in ROOT.rglob('*'):
    if not p.is_file() or any(x in SKIP for x in p.parts): continue
    if p.suffix.lower() in PRIVATE_FILE_SUFFIXES:
      out.append({'type':'PRIVATE_CREDENTIAL_FILE','file':str(p.relative_to(ROOT))})
  return out

def scan_secrets():
  out=scan_secret_files()
  for p in files():
    t=p.read_text(encoding='utf-8',errors='ignore')
    for name,rx in SECRET_PATTERNS:
      for m in rx.finditer(t):
        captured=m.group(1) if m.lastindex else m.group(0)
        if safe_secret_value(captured): continue
        out.append({'type':name,'file':str(p.relative_to(ROOT))})
    if p.suffix.lower() in {'.env','.yaml','.yml','.json','.toml','.ini','.js','.mjs','.cjs','.ts','.py'} or p.name.startswith('.env'):
      for m in GENERIC_ASSIGNMENT.finditer(t):
        if not safe_secret_value(m.group(1)):
          out.append({'type':'GENERIC_SECRET_ASSIGNMENT','file':str(p.relative_to(ROOT))})
  # Stable dedupe: a single file/value can match both a provider-specific and generic rule.
  return [dict(x) for x in {tuple(sorted(item.items())) for item in out}]

def scan_unpinned_actions():
  out=[]
  workflows=ROOT/'.github'/'workflows'
  if not workflows.exists(): return out
  for p in workflows.glob('*.y*ml'):
    t=p.read_text(encoding='utf-8',errors='ignore')
    for m in ACTION_USE.finditer(t):
      ref=m.group(1)
      if ref.startswith('./') or '@' not in ref: continue
      action,version=ref.rsplit('@',1)
      if not FULL_SHA.fullmatch(version): out.append({'action':action,'ref':version,'file':str(p.relative_to(ROOT))})
  return out

def scan_unsafe_env():
  out=[]
  for p in files():
    if 'env' not in p.name.lower() and p.suffix.lower() not in {'.yaml','.yml','.json','.toml','.ini','.md'}: continue
    t=p.read_text(encoding='utf-8',errors='ignore')
    for k,v in POLICY['unsafe_env_defaults'].items():
      if re.search(rf'(?im)^\s*{re.escape(k)}\s*[:=]\s*["\']?{re.escape(v)}["\']?\s*$',t): out.append({'key':k,'file':str(p.relative_to(ROOT))})
  return out

def scan_logs():
  out=[]; rx=re.compile(r'\b(console\.log|logger\.(?:info|debug|warn|error)|print)\s*\(',re.I)
  for p in files():
    if p.suffix.lower() not in {'.ts','.js','.mjs','.cjs','.py'}: continue
    for i,line in enumerate(p.read_text(encoding='utf-8',errors='ignore').splitlines(),1):
      if rx.search(line):
        for key in POLICY['forbidden_log_keys']:
          if key.lower() in line.lower(): out.append({'file':str(p.relative_to(ROOT)),'line':i,'key':key})
  return out

def missing_tests():
  corpus='\n'.join(p.read_text(encoding='utf-8',errors='ignore').lower() for p in files() if 'test' in p.name.lower() or 'security' in str(p).lower())
  return [x for x in POLICY['required_test_concepts'] if x.lower() not in corpus]

def fingerprint():
  targets=[]
  for p in ROOT.rglob('*'):
    if p.is_file() and (p.suffix.lower()=='.sql' or 'schema' in p.name.lower() or 'event' in p.name.lower()):
      if any(x in SKIP for x in p.parts): continue
      try: targets.append((str(p.relative_to(ROOT)),p.read_bytes()))
      except: pass
  h=hashlib.sha256()
  for n,b in sorted(targets): h.update(n.encode()+b'\0'+b+b'\0')
  return h.hexdigest(),len(targets)

def main():
  fp,n=fingerprint(); result={
    'secret_hits':scan_secrets(),
    'unpinned_action_hits':scan_unpinned_actions(),
    'unsafe_env_hits':scan_unsafe_env(),
    'sensitive_log_hits':scan_logs(),
    'missing_security_test_concepts':missing_tests(),
    'schema_event_fingerprint':fp,
    'schema_event_files':n,
  }
  print(json.dumps(result,indent=2)); sys.exit(1 if any(result[k] for k in ['secret_hits','unpinned_action_hits','unsafe_env_hits','sensitive_log_hits','missing_security_test_concepts']) else 0)
if __name__=='__main__': main()
