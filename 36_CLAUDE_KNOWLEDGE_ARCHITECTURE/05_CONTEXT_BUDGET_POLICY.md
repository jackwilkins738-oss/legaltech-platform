# Context budget policy

The repository is intentionally larger than a single useful working context. Retrieval must be progressive.

## Default working set
- 1 bootstrap/current-state file
- 1 decision/authority file when relevant
- 2–5 domain-authority files
- 0–5 evidence files

Typical target: **4–12 files**, not hundreds.

## Never preload
- the full file catalog;
- all competitor research;
- all historical pre-TO packs;
- multiple versions of the same workbook/spec;
- synthetic corpora unless directly needed.

## Escalate context only when
- a material conflict appears;
- source verification is required;
- implementation depends on a detailed contract;
- the user explicitly asks for repository-wide audit.

## End-of-task compression
If a task changes current truth, update the authoritative current-state/decision file so future sessions do not need the whole conversation/history to reconstruct the result.
