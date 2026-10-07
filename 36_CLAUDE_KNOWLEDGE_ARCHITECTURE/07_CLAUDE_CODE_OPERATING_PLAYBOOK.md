# Claude Code operating playbook

## Start
1. Run Claude Code from repository root.
2. Use `/memory` if needed to verify which instruction files are active.
3. For consequential work, begin in plan mode and identify the route/authority set before editing.

## Plan
State internally/briefly:
- primary route;
- current authoritative files;
- evidence/unknowns;
- gates that block execution;
- tests/validation required.

## Execute
- Search narrowly inside route roots.
- Reuse existing contracts and types before inventing new ones.
- Keep security/authorization checks server-side.
- Do not weaken tests or gates to complete a task.

## Finish
- run route-specific tests;
- run knowledge lint when docs/authority/navigation change;
- update current state/decisions if truth changed;
- do not create duplicate summary files without a clear lifecycle purpose.

## Parallel agents
Use subagents for bounded independent work (e.g. security review, integration analysis, test review). The lead agent owns synthesis and conflict resolution. Agents must cite the authoritative files they used; parallelism must not create parallel truths.
