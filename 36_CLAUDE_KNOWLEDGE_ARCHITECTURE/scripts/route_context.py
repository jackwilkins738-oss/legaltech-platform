#!/usr/bin/env python3
from pathlib import Path
import json, re, sys
ROOT=Path(__file__).resolve().parents[2]
routes=json.loads((ROOT/'36_CLAUDE_KNOWLEDGE_ARCHITECTURE/DOMAIN_ROUTES.json').read_text())
q=' '.join(sys.argv[1:]).lower()
if not q:
    print('Usage: python route_context.py <task description>'); raise SystemExit(2)
q_tokens=set(re.findall(r'[a-z0-9]+',q))
def match_term(term):
    tl=term.lower(); toks=re.findall(r'[a-z0-9]+',tl)
    if len(toks)==1:
        return toks[0] in q_tokens
    return tl in q
def route_score(r):
    s=0.0
    for a in r.get('anchors',[]):
        if match_term(a): s+=4.0
    for k in r['keywords']:
        if match_term(k): s+=2.0
        for token in re.findall(r'[a-z0-9]+',k.lower()):
            if len(token)>=4 and token in q_tokens: s+=0.25
    return s
scores=[(route_score(r),name,r) for name,r in routes.items()]
for score,name,r in sorted(scores,reverse=True)[:3]:
    if score<=0: continue
    print(f'ROUTE {name} score={score:.2f}')
    print(' required:')
    for pth in r['required']: print('  -',pth)
    print(' search roots:',', '.join(r['evidence_roots']))
