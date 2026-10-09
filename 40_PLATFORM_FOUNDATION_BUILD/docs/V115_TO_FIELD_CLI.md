# V115 — Local TO evidence commands

STATUS: CURRENT
DOMAIN: platform_build / evidence_tooling

This is a local command-line entry point to V75, not a customer-facing workflow or a production ingestion service. It runs without network calls and uses an in-memory database that is closed after each command. No persisted customer database is opened.

## Use from 40_PLATFORM_FOUNDATION_BUILD

Requires the project's Node runtime with node:sqlite support (CI uses Node 22). Output directories must already exist. Each command refuses to overwrite an existing file, including the input CSV. Do not redirect console output into the source file.

```powershell
npm run to:field -- template --out "$env:TEMP\to-template.csv"
npm run to:field -- preflight --csv "C:\approved-evidence\cleaned.csv" --out "$env:TEMP\to-preflight.json"
npm run to:field -- report --csv "C:\approved-evidence\cleaned.csv" --out "$env:TEMP\to-report.json" --working-days 220
```

220 is an example, not a validated firm assumption. Report requires an explicit whole-number working-day count from 1 to 366.

- `template`: generate the existing canonical CSV header for field capture.
- `preflight`: report valid/rejected counts and row-number/error-code issues; never output source notes or individual aliases.
- `report`: first require every row to pass; then produce the existing task, dependency, role/task, system and guarded annualisation aggregates. Invalid input never creates a partial report. A header-only file may pass preflight but cannot produce an evidence report.
- Reports include the SHA-256 of decoded UTF-8 input, excluding a leading BOM, and omit ephemeral study IDs so identical input/options produce identical report bytes.
- Exit codes: 0 successful; 2 row validation issues; 1 usage, file, parsing or execution failure. Structural errors do not create output. Operational errors never echo paths or raw CSV cells.
- Input is bounded to 2 MB / 5,000 rows using the existing V75 schema. Invalid UTF-8 is rejected.

## Field discipline

Keep observations blind to product preferences. Use aliases, approved role/task/system codes and process-only notes. Existing pattern rejection is not proof of anonymisation: a person must review notes and codes before using this tool. Do not place actual evidence in git, prompts or fixtures.

Preserve the immutable source under the existing RAW policy, document corrections/anonymisation in CLEANED, and save derived outputs under ANALYSIS in the approved evidence workspace. This command does not certify provenance, decide authorised storage or perform those moves. Analyse a deliberately combined cleaned CSV when comparing several days; independent reports are not a persistent study ledger.

Waiting time is elapsed delay, not staff labour. Targeted observations cannot establish prevalence; baseline annual exposure is not a savings promise. Existing V66 measured-sample, frequency and headcount evidence gates remain in force. No composite opportunity score, workflow recommendation, ROI or product decision is generated.

## Pre-TO stopping point

V115 supplies an executable route into the already built evidence tooling. Continue with the partner's observation work. Under D-018, further pre-TO changes should address observed defects, evidence-tooling gaps or authorised integration tests. No additional version number is required to start the TO. Customer workflows stay behind the existing strategy/evidence gate; live deployment still requires external integration and operational validation.

## Reversal

Revert the V115 PR to remove the CLI and npm entry point. V66/V75 schemas and stored evidence are unchanged.
