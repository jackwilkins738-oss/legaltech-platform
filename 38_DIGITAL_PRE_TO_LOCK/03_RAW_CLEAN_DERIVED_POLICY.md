# Raw → Clean → Derived policy

STATUS: CURRENT
AUTHORITY: HIGH

## Raw
Immutable copy of exactly what was captured/exported. Never silently edited. Store under `39_POST_TO_EVIDENCE/00_RAW_IMMUTABLE/`.

## Cleaned / normalised
Corrections, standardised labels, anonymisation and explicit exclusions. Every material transformation must be reproducible or described. Store under `01_CLEANED_NORMALISED/`.

## Analysis
Statistics, task-family aggregation, economics, root-cause analysis and charts. Store under `02_ANALYSIS/`.

## Decisions
Only decisions that passed the evidence gate. Store under `03_DECISIONS/` and update the canonical governance decision register when approved.

## Product changes
PRDs, backlog changes and architecture/build consequences after an explicit decision. Store under `04_PRODUCT_CHANGES/`.

Never overwrite raw material to make analysis cleaner.
