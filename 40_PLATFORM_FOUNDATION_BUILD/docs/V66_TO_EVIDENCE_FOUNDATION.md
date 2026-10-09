# V66 — Time-and-Motion Evidence Foundation

V66 turns the pre-TO measurement rules into a bounded evidence model without encoding a firm's workflow conclusions before observation.

## What it adds

- tenant-bound TO studies with explicit open/locked states;
- anonymised participant aliases (`P-###`) and optional matter aliases (`MAT-###`) instead of client/matter identifiers;
- direct observation, interview and system-log evidence sources;
- explicit `MEASURED` versus `ESTIMATED` timing;
- separate active, waiting, context-retrieval and reactivation durations;
- separate internal versus external waits;
- structured dependency/request evidence for question, decision, review, approval, handoff and escalation events;
- chase, rework, system-switch, judgement and Proclaim-capability observations;
- immutable observation/estimate evidence with correction-by-supersession rather than history rewriting;
- task-family analysis for active work, waiting, blocked-matter time, context retrieval, reactivation, chase rate, escalation rate and rework rate;
- guarded annualisation that refuses to extrapolate until a task family has at least five measured timing samples plus high-confidence independently sourced frequency and staff-count evidence.

## Evidence discipline

Interview timing cannot be labelled measured. An internal wait is not silently merged with external waiting. Annualisation does not accept interview-only frequency/headcount estimates as validated evidence. `WORKFLOW_LOG`, `SYSTEM_REPORT` or `DIRECT_COUNT` evidence is required for high-confidence frequency; `ROSTER` or `SYSTEM_REPORT` evidence is required for high-confidence headcount.

The output is a baseline exposure estimate, not a claimed saving. Automation percentage, value and ROI remain separate decisions after the observed workflow is understood.

## Privacy boundary

The V66 model is intentionally process-centric. It requires pseudonymous participant and matter aliases and does not need client names, email addresses, DOBs, diagnoses, document contents or actual matter references. Free-form process notes are small and reject several obvious PII-shaped inputs, but operational procedure must still prohibit client data from TO collection.

## Deliberately deferred

V66 does not decide which Co-op workflow should be automated, which roles should route to which managers, what SLA should apply, or whether any observed process is a product opportunity. Those are TO conclusions.
