# V75 — TO field intake and evidence report

V75 turns the V66 evidence model into a practical intake/report boundary for the partner TO week while preserving the rule that observation must drive the product rather than product assumptions driving observation.

## Canonical field intake

- `docs/TO_FIELD_IMPORT_TEMPLATE.csv` defines the exact anonymised import header.
- Imports are capped at 2 MB and 5,000 evidence rows per file. This is the **TO field import bounded** boundary.
- `preflight` validates rows without persistence.
- Participant aliases remain `P-xx`; matter aliases remain `MAT-xxx`; raw names/matter references are not part of the schema.
- V66 validators remain authoritative for measured-vs-estimated timing, dependency consistency, aliases and safe notes. PII-like process notes are rejected before persistence. This is the **TO import PII rejection** boundary.
- Import failures return row number plus bounded error code only; raw failing field content is not echoed.
- Valid rows may still import when a separate row is invalid, preventing one field-entry error from discarding the rest of a day's evidence.
- Every accepted row is idempotent by batch key + row number. Replaying the same batch returns the same evidence; changing an already accepted row under the same batch key is rejected instead of silently rewriting evidence. This is the **TO import idempotency** boundary.

## Field report

The report exposes evidence dimensions separately:

- current/measured/direct-observation sample quality;
- existing V66 task-family burden ranking;
- dependency waiting/context/reactivation by dependency role;
- role × task-family active/wait/blocked evidence;
- system usage;
- Proclaim-capability observations;
- guarded annualisation results.

There is deliberately no composite automation/opportunity score. Frequency and headcount annualisation remain blocked until V66's independently validated evidence gates are satisfied.

## Deliberately not included

No Co-op-specific task family, role ladder, assumed labour saving, workflow recommendation, ROI claim or product requirement is produced by the importer. Those decisions remain downstream of the actual field evidence.
