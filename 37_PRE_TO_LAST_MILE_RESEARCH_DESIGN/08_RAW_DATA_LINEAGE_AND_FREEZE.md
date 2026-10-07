# Raw data lineage, freeze and amendment

## Three layers
1. **RAW** — exactly what the observer captured.
2. **CLEANED** — classification corrections and exclusions with reasons.
3. **DERIVED** — summaries, timing statistics, economics and scores.

Never silently rewrite RAW to make it fit the analysis.

## After each session
- save/export a dated session copy;
- record Session ID;
- freeze the raw rows;
- store corrections in the amendment log;
- record who changed what and why.

## Provenance
Every derived metric should be traceable to:
- source observation rows;
- volume source;
- cost source;
- exclusion rules.

## Memory reconstruction
If a timing was missed, do not reconstruct it from memory and label it MEASURED. Mark it REPORTED/UNKNOWN.
