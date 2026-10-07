# Conflict resolution protocol

When files disagree:
1. classify each file lifecycle and authority;
2. identify whether disagreement is fact, hypothesis, decision, architecture or implementation state;
3. check current state + decisions + supersession registry;
4. prefer measured/observed evidence over hypothesis;
5. for external facts, verify current authoritative source when material;
6. for security/legal obligations, do not “average” conflicting requirements—escalate to the stricter current requirement until resolved;
7. record unresolved material conflicts in `00_GOVERNANCE/OPEN_QUESTIONS.md`.

Never silently merge two incompatible specifications.
