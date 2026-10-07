# Supersession policy

## Rule
A new document does not become authoritative because it is newer or named FINAL. Authority changes only when the current authoritative document/manifest/decision is updated.

## Required lifecycle actions
When replacing an artifact:
1. mark the replacement `current` in `AUTHORITATIVE_FILES.json`;
2. add the old→new mapping to `SUPERSESSION_REGISTRY.json`;
3. update any router that points at the old artifact;
4. leave the old artifact for provenance unless deletion is clearly safe;
5. run `knowledge_lint.py`.

## Filename discipline
Avoid new names containing `FINAL`, `MASTER`, `LATEST`, `V2`, `V3` for living documents. Prefer stable semantic names and version control/history. Existing historical names may remain.

## Historical references
A superseded file may be read only for provenance, migration or conflict analysis. It cannot establish current state, requirements or product decisions.
