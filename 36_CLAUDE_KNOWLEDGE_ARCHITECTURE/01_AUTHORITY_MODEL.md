# Authority model

Authority is determined by **source class + lifecycle + specificity + evidence**, not filename recency or retrieval rank.

## Precedence
1. Root `CLAUDE.md` — operating instructions only.
2. `00_GOVERNANCE/CURRENT_STATE.md` — current state/phase.
3. `00_GOVERNANCE/DECISIONS.md` — deliberate product/company decisions.
4. Security matters: `09_SECURITY_PRIVACY/SECURITY_MASTER_SPEC.md` plus current release gates.
5. Current phase command centre / accepted specification for the task.
6. Current authoritative domain documents listed in `AUTHORITATIVE_FILES.json`.
7. Supporting/reference research.
8. Historical or superseded material.

## Conflict rules
- More recent does **not** automatically beat more authoritative.
- A measured result beats a hypothesis even if the hypothesis lives in a higher-level strategy file; update the strategy file afterwards.
- A task-specific accepted contract can refine a general rule but cannot silently weaken security/legal gates.
- When two current/high-authority files materially conflict, stop and identify the conflict. Do not blend them.

## Lifecycle vocabulary
- `current`: can drive decisions now.
- `frozen`: current but intentionally not changed without a gate/event.
- `provisional`: usable only with stated assumptions.
- `reference`: supporting detail/evidence; cannot override current authority.
- `historical`: retained for provenance; do not use as current truth.
- `superseded`: replaced; use only to understand evolution.

## Evidence vocabulary
VERIFIED FACT; OBSERVED WORKFLOW; MEASURED RESULT; REPEATED USER REPORT; SINGLE USER REPORT; MARKET SIGNAL; HYPOTHESIS; ASSUMPTION; DECISION.
