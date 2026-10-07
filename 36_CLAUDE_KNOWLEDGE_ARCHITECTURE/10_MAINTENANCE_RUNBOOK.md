# Knowledge architecture maintenance

## After material work
- Update `CURRENT_STATE.md` if state changed.
- Update `DECISIONS.md` for a deliberate decision.
- Update `AUTHORITATIVE_FILES.json` only when authority/lifecycle changes.
- Update `SUPERSESSION_REGISTRY.json` when replacing artifacts.
- Regenerate `FILE_CATALOG.csv` after adding/removing files.
- Run `scripts/knowledge_lint.py`.

## Monthly / major phase gate
- remove duplicate route entries;
- verify current-authority files still exist;
- review provisional assumptions that have acquired evidence;
- identify historical packs still being cited by current documents;
- keep root CLAUDE.md under 200 lines;
- review `.claude/rules/` for contradictory instructions.

## Phase transition
When moving from PRE-TO to POST-TO, update in this order:
1. measured evidence;
2. decisions;
3. current state;
4. authoritative manifest/routes;
5. product/engineering plan.
