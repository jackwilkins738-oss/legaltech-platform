# V75 Validation Results

Version: `0.10.30`

- Platform suite: **1376/1376 passed**
- Focused V75 field-intake suite: **13/13 passed**
- V66 evidence + V75 intake combined: **31/31 passed**
- Production-shape suite: **44/44 passed**
- Security policy suite: **11/11 passed**
- Security regression scan: **clean**
- Knowledge lint: **0 errors / 0 warnings** after catalog regeneration
- Demo: **RECONCILED / verified true**

## Proven V75 boundary

- Canonical TO CSV intake is capped at 2 MB and 5,000 evidence rows.
- Preflight validates without persistence.
- PII-like process notes, invalid aliases, measured interview timing and inconsistent dependency fields fail before persistence.
- Import failures return row number plus bounded error code only; raw rejected field content is not echoed.
- Valid rows can import independently from unrelated bad rows.
- Batch + row identity makes accepted evidence idempotent; changed replay cannot silently rewrite an accepted row.
- Field reporting separates task burden, dependency-role wait/context/reactivation, role×task evidence, system usage and Proclaim-capability evidence.
- Annualisation continues to require V66 sample/frequency/headcount gates.
- No composite automation/opportunity score is generated.

## Deliberately not claimed

V75 does not infer Co-op workflows, savings percentages, ROI, staffing requirements or automation recommendations. It prepares and reports the field evidence only.
