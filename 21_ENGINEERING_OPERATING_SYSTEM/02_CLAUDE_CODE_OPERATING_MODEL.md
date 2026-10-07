# CLAUDE CODE OPERATING MODEL

## Roles
Claude Code is an **implementation agent**, not the authority for:
- product scope;
- legal correctness;
- security acceptance;
- production access;
- customer commitments.

## Task lifecycle
1. Read task ticket.
2. Read authority docs named by task.
3. State implementation plan in task/PR notes.
4. Change only permitted files/domains.
5. Add/update tests first or with implementation.
6. Run required checks.
7. Self-review diff.
8. Update docs if behaviour changed.
9. Open PR / produce review summary.
10. Stop at human-review gate.

## Claude must stop and escalate when
- requirement conflicts with `CLAUDE.md`;
- security rule must be weakened;
- real customer data is required;
- production secret/access is required;
- legal deadline/financial rule is ambiguous;
- Proclaim behaviour differs from documented/tested contract;
- destructive DB migration is needed;
- a task requires unrestricted external network/tool access;
- a supposedly local change crosses more than two domain boundaries unexpectedly.

## Prohibited behaviour
- inventing API behaviour;
- bypassing failing tests;
- weakening auth to make demo work;
- hardcoding production credentials;
- logging legal document bodies by default;
- direct DB access from UI;
- autonomous production deploy;
- broad refactor unrelated to task;
- silently changing architecture.

## Context discipline
Claude should load the smallest relevant set of documents.
Do not feed the full 200+ file research repository into every coding task.
