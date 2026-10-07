#!/usr/bin/env python3
from pathlib import Path
import json, csv, sys
from repository_files import repository_files
ROOT=Path(__file__).resolve().parents[2]
NAV=ROOT/'36_CLAUDE_KNOWLEDGE_ARCHITECTURE'
errors=[]; warnings=[]

def need(path,label):
    if not (ROOT/path).exists(): errors.append(f'MISSING {label}: {path}')

# Root instruction budget
claude=ROOT/'CLAUDE.md'; need(Path('CLAUDE.md'),'root instructions')
if claude.exists():
    lines=len(claude.read_text(encoding='utf-8').splitlines())
    if lines>200: errors.append(f'CLAUDE.md is {lines} lines (>200)')

# Required architecture files
for p in ['00_SESSION_BOOTSTRAP.md','01_AUTHORITY_MODEL.md','03_TASK_ROUTER.md','AUTHORITATIVE_FILES.json','DOMAIN_ROUTES.json','SUPERSESSION_REGISTRY.json','FILE_CATALOG.csv','06_CLAUDE_PROJECT_INSTRUCTIONS.md']:
    need(Path('36_CLAUDE_KNOWLEDGE_ARCHITECTURE')/p,'knowledge architecture')

# Authority refs
manifest=json.loads((NAV/'AUTHORITATIVE_FILES.json').read_text())
seen=set()
for e in manifest['files']:
    p=e['path']
    if p in seen: errors.append(f'DUPLICATE authority path: {p}')
    seen.add(p); need(Path(p),'authoritative file')
    if e['status']=='superseded': errors.append(f'Authoritative manifest marks superseded: {p}')

# Route refs
routes=json.loads((NAV/'DOMAIN_ROUTES.json').read_text())
for name,r in routes.items():
    for p in r['required']: need(Path(p),f'route {name}')
    for p in r['evidence_roots']:
        if not (ROOT/p).is_dir(): errors.append(f'MISSING route root {name}: {p}')

# Supersession refs and loop check
sup=json.loads((NAV/'SUPERSESSION_REGISTRY.json').read_text())['mappings']
edge={}
for m in sup:
    need(Path(m['old']),'superseded source'); need(Path(m['new']),'superseding target')
    edge[m['old']]=m['new']
for start in edge:
    seen2=set(); cur=start
    while cur in edge:
        if cur in seen2: errors.append(f'SUPERSESSION LOOP from {start}'); break
        seen2.add(cur); cur=edge[cur]

# Catalog coverage (exclude catalog itself because it cannot catalog its own final bytes deterministically)
with (NAV/'FILE_CATALOG.csv').open(encoding='utf-8') as f:
    cat={r['path'] for r in csv.DictReader(f)}
actual={p.relative_to(ROOT).as_posix() for p in repository_files(ROOT) if p.relative_to(ROOT).as_posix()!='36_CLAUDE_KNOWLEDGE_ARCHITECTURE/FILE_CATALOG.csv'}
missing=actual-cat; extra=cat-actual
if missing: warnings.append(f'CATALOG missing {len(missing)} files; regenerate catalog')
if extra: warnings.append(f'CATALOG references {len(extra)} absent files')

print(f'Knowledge lint: {len(errors)} errors, {len(warnings)} warnings')
for x in errors: print('ERROR',x)
for x in warnings: print('WARN ',x)
sys.exit(1 if errors else 0)
