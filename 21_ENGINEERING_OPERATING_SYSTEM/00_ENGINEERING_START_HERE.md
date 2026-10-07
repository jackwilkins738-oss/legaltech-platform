# ENGINEERING START HERE

## Status
This repository is now **engineering-ready for technical spikes and the first bounded V1 build**, subject to the existing evidence gates.

It is not permission to build the entire long-term platform immediately.

## Read order for any engineering task
1. `/CLAUDE.md`
2. `00_GOVERNANCE/CURRENT_STATE.md`
3. `00_GOVERNANCE/DECISIONS.md`
4. `21_ENGINEERING_OPERATING_SYSTEM/04_ARCHITECTURE_GUARDRAILS.md`
5. `21_ENGINEERING_OPERATING_SYSTEM/10_TEST_STRATEGY.md`
6. `21_ENGINEERING_OPERATING_SYSTEM/11_SECURITY_RELEASE_GATES.md`
7. task-specific product/integration docs

## Engineering objective
Build the smallest secure system that can prove:

**approved Outlook email → durable ingest → safe attachment processing → matter candidate(s) → human-reviewed decision → controlled Proclaim action → read-back reconciliation → audit.**

Do not expand scope until this path is proven.

## Non-negotiable operating model
- Humans decide architecture, scope, legal rules, risk boundaries and production access.
- Claude Code performs bounded implementation tasks.
- No direct production development.
- No task is complete without tests and documentation of any changed behaviour.
- Security-sensitive areas require human review even if all tests pass.
- One task/PR should be small enough to understand and revert.

## Current build state
Allowed now:
- repo scaffolding;
- local/dev environments;
- synthetic-data domain model;
- auth/tenant foundations;
- Graph spike;
- hostile-file pipeline spike;
- mock Proclaim adapter;
- authorised Proclaim test spike;
- audit/event infrastructure;
- eval harness;
- basic review UI.

Blocked pending evidence:
- broad PMS;
- accounting/client money;
- autonomous high-impact actions;
- large platform expansion;
- production legal deadline automation without confirmation;
- customer-data model training.


## Current implementation pointer
For new application work, inspect `40_PLATFORM_FOUNDATION_BUILD/` after the mandatory engineering read order. It is the current runnable implementation; older starter/reference layers remain evidence and regression assets rather than the primary application codebase.
