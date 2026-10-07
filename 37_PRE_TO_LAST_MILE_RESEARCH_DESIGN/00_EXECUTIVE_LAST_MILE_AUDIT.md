# Pre-TO last-mile audit

STATUS: CURRENT  
AUTHORITY: HIGH  
PHASE: PRE-TO

The previous deep audit covered product scope, Proclaim maturity, root cause, privacy, shadow systems, system-data requests, work patterns and economics. This final pass found a smaller set of **research-design and data-integrity gaps** that can still materially change the TO result.

## Material additions

1. **Observer-blind protocol** — the live observer should not work from the product thesis or wedge hypotheses.
2. **Two-pass capture** — live capture must stay lightweight; enrichment happens immediately after the event/session.
3. **Second-level timing** — short tasks cannot be rounded to whole minutes.
4. **Observer reliability** — task naming, boundaries, duration and sequence need calibration/review.
5. **Continuous-session denominator** — event counts without observed-time denominators cannot estimate prevalence.
6. **Work-sampling fallback** — use a predefined interval method if continuous observation becomes impractical.
7. **Robust statistics** — median/percentiles and normal-vs-exception distributions, not mean alone.
8. **Process-mining readiness** — request event-log fields so TO can later be triangulated with system traces.
9. **Raw/derived data separation** — freeze raw sessions; corrections must not silently overwrite original observations.
10. **Metadata-quality audit** — test whether the data required for automation is actually present and structured.
11. **Workflow FMEA** — rare/high-impact failure modes need a separate risk lens.
12. **Queue/WIP/flow analysis** — a five-minute task can still sit inside a thirty-day bottleneck.
13. **Cheapest-fix ladder** — training/configuration/process/rules/API/RPA before AI/new product.
14. **Process ownership** — identify who owns, configures and can approve change.
15. **Direct quote vs observer inference** — keep evidence and interpretation separate.
16. **Dry run** — run the capture method before using it on live staff.

## Core principle

The TO is not an employee productivity study and is not a search for evidence that the product thesis is correct.

The unit of interest is the **workflow**, its state transitions, queues, dependencies, exceptions, controls, data and consequences.
