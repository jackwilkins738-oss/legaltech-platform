#!/usr/bin/env python3
from pathlib import Path
import re, json, sys, hashlib
ROOT=Path(__file__).resolve().parents[1]
POLICY=json.loads((Path(__file__).resolve().parent/'security_policy.json').read_text())
SKIP={'.git','node_modules','dist','build','.venv','venv','__pycache__'}
TEXT={'.md','.json','.yaml','.yml','.ts','.js','.mjs','.cjs','.py','.sql','.env','.txt','.toml','.ini','.sh'}
SECRET_PATTERNS=[
('AWS_ACCESS_KEY',re.compile(r'\bAKIA[0-9A-Z]{16}\b')),
('GITHUB_PAT',re.compile(r'\bgh[pousr]_[A-Za-z0-9_]{30,}\b')),
('OPENAI_KEY',re.compile(r'\bsk-[A-Za-z0-9_-]{30,}\b')),
('PRIVATE_KEY',re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'))]
def files():
  for p in ROOT.rglob('*'):
    if p.is_file() and not any(x in SKIP for x in p.parts) and (p.suffix.lower() in TEXT or p.name.startswith('.env')): yield p
def scan_secrets():
  out=[]
  for p in files():
    t=p.read_text(encoding='utf-8',errors='ignore')
    for name,rx in SECRET_PATTERNS:
      for m in rx.finditer(t): out.append({'type':name,'file':str(p.relative_to(ROOT))})
  return out
def scan_unsafe_env():
  out=[]
  for p in files():
    if 'env' not in p.name.lower() and p.suffix.lower() not in {'.yaml','.yml','.json','.toml','.ini','.md'}: continue
    t=p.read_text(encoding='utf-8',errors='ignore')
    for k,v in POLICY['unsafe_env_defaults'].items():
      if re.search(rf'(?im)^\s*{re.escape(k)}\s*[:=]\s*[\"\']?{re.escape(v)}[\"\']?\s*$',t): out.append({'key':k,'file':str(p.relative_to(ROOT))})
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
  fp,n=fingerprint(); result={'secret_hits':scan_secrets(),'unsafe_env_hits':scan_unsafe_env(),'sensitive_log_hits':scan_logs(),'missing_security_test_concepts':missing_tests(),'schema_event_fingerprint':fp,'schema_event_files':n}
  print(json.dumps(result,indent=2)); sys.exit(1 if any(result[k] for k in ['secret_hits','unsafe_env_hits','sensitive_log_hits','missing_security_test_concepts']) else 0)
if __name__=='__main__': main()
