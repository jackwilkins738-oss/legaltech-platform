#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import argparse, csv, sys

ROOT = Path(__file__).resolve().parents[2]
NAV = ROOT / '36_CLAUDE_KNOWLEDGE_ARCHITECTURE'
CATALOG = NAV / 'FILE_CATALOG.csv'
SELF = '36_CLAUDE_KNOWLEDGE_ARCHITECTURE/FILE_CATALOG.csv'
FIELDS = ['path','domain','status','authority','type','bytes']
IGNORE_PARTS = {'.git','node_modules','.venv','venv','__pycache__','.pytest_cache','.mypy_cache','.next','dist','coverage','.dev-data'}

DOMAIN_BY_ROOT = {
    '.claude': 'claude_config', '.github': 'github_governance',
    '00_GOVERNANCE': 'governance', '09_SECURITY_PRIVACY': 'security_privacy',
    '13_OPERATIONS_RELIABILITY': 'operations_reliability',
    '17_PRE_TO_SCOPING': 'pre_to_scoping', '18_PRE_TO_EXECUTION': 'pre_to_execution',
    '19_GAP_AUDIT_NEW_DOMAINS': 'gap_audit', '20_PI_ECONOMICS_AND_ECOSYSTEM': 'pi_economics_ecosystem',
    '21_ENGINEERING_OPERATING_SYSTEM': 'engineering_operating_system',
    '22_IMPLEMENTATION_FOUNDATION': 'implementation_foundation', '23_FINAL_COMPLETENESS': 'final_completeness',
    '24_SCOPING_CLOSURE': 'scoping_closure', '25_TO_DAY0_OPERATING_KIT': 'to_day0',
    '26_EXTERNAL_VALIDATION_EXECUTION': 'external_validation', '27_PRE_TO_TECHNICAL_STARTER': 'technical_starter',
    '29_PRE_TO_REFERENCE_IMPLEMENTATION': 'reference_implementation', '30_PRODUCTION_SHAPE_SCAFFOLD': 'production_shape',
    '31_DEV_REPRODUCIBILITY_AND_CONTRACTS': 'dev_reproducibility', '32_SECURITY_REGRESSION_AUTOMATION': 'security_regression',
    '33_PRE_TO_FINAL_AUDIT_AND_LOCK': 'pre_to_lock', '34_FUTURE_COMPETITOR_THREAT_MAP': 'competition',
    '35_PRE_TO_DEEP_AUDIT': 'deep_audit', '36_CLAUDE_KNOWLEDGE_ARCHITECTURE': 'claude_knowledge',
    '37_LAST_MILE_RESEARCH_DESIGN': 'last_mile_research', '40_PLATFORM_FOUNDATION_BUILD': 'platform_build',
}

def classify(path: str) -> tuple[str,str,str,str]:
    p = Path(path)
    root = p.parts[0] if p.parts else ''
    domain = DOMAIN_BY_ROOT.get(root, 'repository_root' if len(p.parts) == 1 else root.lower())
    ext = p.suffix.lower().lstrip('.') or 'file'
    ftype = {'md':'md','json':'json','csv':'csv','py':'py','js':'js','mjs':'js','cjs':'js','ps1':'ps1','yml':'yaml','yaml':'yaml','html':'html','css':'css','sql':'sql','txt':'txt'}.get(ext, ext)
    status = 'current' if root in {'.github','00_GOVERNANCE','36_CLAUDE_KNOWLEDGE_ARCHITECTURE','40_PLATFORM_FOUNDATION_BUILD'} or len(p.parts)==1 else 'reference'
    authority = 'high' if path in {'CLAUDE.md','README.md','SECURITY.md','GITHUB_SETUP.md'} or root in {'00_GOVERNANCE','36_CLAUDE_KNOWLEDGE_ARCHITECTURE'} else ('medium' if root in {'.github','40_PLATFORM_FOUNDATION_BUILD','09_SECURITY_PRIVACY','32_SECURITY_REGRESSION_AUTOMATION'} else 'low')
    return domain,status,authority,ftype

def read_existing() -> dict[str,dict[str,str]]:
    if not CATALOG.exists(): return {}
    with CATALOG.open(encoding='utf-8', newline='') as f:
        return {r['path']: r for r in csv.DictReader(f)}

def build_rows() -> list[dict[str,str]]:
    old = read_existing()
    rows=[]
    candidates=(p for p in ROOT.rglob('*') if p.is_file() and not any(part in IGNORE_PARTS for part in p.relative_to(ROOT).parts))
    for f in sorted(candidates, key=lambda p:p.relative_to(ROOT).as_posix().lower()):
        rel=f.relative_to(ROOT).as_posix()
        if rel == SELF: continue
        if rel in old:
            row=dict(old[rel])
            row['bytes']=str(f.stat().st_size)
        else:
            domain,status,authority,ftype=classify(rel)
            row={'path':rel,'domain':domain,'status':status,'authority':authority,'type':ftype,'bytes':str(f.stat().st_size)}
        rows.append({k:row.get(k,'') for k in FIELDS})
    return rows

def render(rows:list[dict[str,str]]) -> str:
    from io import StringIO
    s=StringIO(newline='')
    w=csv.DictWriter(s,fieldnames=FIELDS,lineterminator='\n')
    w.writeheader(); w.writerows(rows)
    return s.getvalue()

def main() -> int:
    ap=argparse.ArgumentParser(description='Regenerate deterministic Claude FILE_CATALOG.csv')
    ap.add_argument('--check',action='store_true',help='fail if the catalog is stale')
    args=ap.parse_args()
    expected=render(build_rows())
    current=CATALOG.read_text(encoding='utf-8') if CATALOG.exists() else ''
    if args.check:
        if current != expected:
            print('FILE_CATALOG.csv is stale. Run regenerate_catalog.py without --check.')
            return 1
        print('FILE_CATALOG.csv is current.')
        return 0
    CATALOG.write_text(expected,encoding='utf-8',newline='')
    print(f'Regenerated {CATALOG.relative_to(ROOT).as_posix()} with {len(expected.splitlines())-1} entries.')
    return 0

if __name__=='__main__':
    raise SystemExit(main())
