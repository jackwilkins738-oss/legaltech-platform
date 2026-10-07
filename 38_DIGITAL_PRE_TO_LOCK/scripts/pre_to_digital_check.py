from pathlib import Path
import hashlib, json, subprocess, sys
ROOT=Path(__file__).resolve().parents[2]
manifest=json.loads((ROOT/'38_DIGITAL_PRE_TO_LOCK/PRE_TO_FREEZE_MANIFEST.json').read_text())
fail=[]
for f in manifest['files']:
    p=ROOT/f['path']
    if not p.exists():
        fail.append(f"missing: {f['path']}")
        continue
    h=hashlib.sha256(p.read_bytes()).hexdigest()
    if h != f['sha256']:
        fail.append(f"changed since freeze: {f['path']}")
required=[
    ROOT/'39_POST_TO_EVIDENCE/00_RAW_IMMUTABLE/README.md',
    ROOT/'39_POST_TO_EVIDENCE/01_CLEANED_NORMALISED/README.md',
    ROOT/'39_POST_TO_EVIDENCE/02_ANALYSIS/README.md',
    ROOT/'39_POST_TO_EVIDENCE/03_DECISIONS/README.md',
    ROOT/'39_POST_TO_EVIDENCE/04_PRODUCT_CHANGES/README.md',
]
for p in required:
    if not p.exists(): fail.append(f"missing evidence stage: {p.relative_to(ROOT)}")
text=(ROOT/'CLAUDE.md').read_text()
if 'STRATEGY_CHANGE_GATE' not in text: fail.append('root CLAUDE missing strategy gate')
rule=(ROOT/'.claude/rules/10-to-evidence.md').read_text()
if 'RAW → CLEANED → ANALYSIS → DECISION → PRODUCT CHANGE' not in rule:
    fail.append('TO rule missing evidence-stage separation')
if fail:
    print('\n'.join('FAIL '+x for x in fail)); sys.exit(1)
print('PASS digital freeze integrity')
print(f"PASS {len(manifest['files'])} frozen authority files match SHA-256 manifest")
print('PASS post-TO evidence stages exist')
print('PASS strategy-change gate is active')
