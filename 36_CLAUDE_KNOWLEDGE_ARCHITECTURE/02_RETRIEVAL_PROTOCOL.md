# Progressive retrieval protocol

## Goal
Retrieve the **smallest authoritative context set** that can answer or execute the task correctly.

## Pass 0 — classify
Identify: domain, task type, whether current facts are required, whether the task can change product/security/architecture, and whether evidence is blocked by TO/customer access.

## Pass 1 — authority
Read:
- root `CLAUDE.md` (automatic in Claude Code);
- `CURRENT_STATE.md`;
- route-specific required files from `03_TASK_ROUTER.md`.
Target: 3–8 files.

## Pass 2 — evidence
Only if Pass 1 is insufficient, search the route's evidence roots. Prefer exact filenames/terms and source registers. Target: another 3–10 files.

## Pass 3 — contradiction check
Before a consequential conclusion, search for the strongest opposing evidence, supersession entry, and relevant decision. Explicitly preserve unresolved conflicts.

## Pass 4 — implementation
For code/change tasks, load accepted contracts, tests and security gates. Do not load broad market research unless it materially changes the implementation.

## Context budget
- Avoid loading `FILE_CATALOG.csv/json` wholesale.
- Avoid full-repo grep dumps in context; grep narrowly and open the matched files.
- Prefer summaries/indexes first, detailed evidence second.
- Do not open multiple generations of the same artifact unless auditing evolution/conflicts.

## Search pattern
Use filenames/directories first, then targeted `rg`/search phrases. A useful order is:
`current state → router → authoritative docs → targeted grep → evidence source`.
