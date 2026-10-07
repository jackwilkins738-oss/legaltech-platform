# BRANCH, PR & CODE REVIEW

## Branches
- `main` protected;
- short-lived task branches;
- no direct push to main.

Naming:
`feat/ENG-012-graph-subscription`
`fix/ENG-027-cross-tenant-guard`

## PR size
Prefer <500 changed lines excluding generated files.
Large work splits by domain/vertical slice.

## PR template must include
- task ID;
- problem;
- approach;
- files/domains changed;
- security/privacy impact;
- migrations;
- tests run;
- screenshots where UI;
- rollback;
- remaining risks.

## Required reviewers
Ordinary change:
1 human/qualified reviewer once team exists.

Sensitive change requires domain specialist/human review:
- auth/authz;
- tenancy;
- Graph app permissions;
- Proclaim writes;
- secrets/IAM;
- workflow execution;
- AI tool permissions;
- DB destructive migration;
- retention/deletion;
- high-impact legal rule.

## Claude-generated code
Reviewed to the same standard as human-written code.
Do not merge because “tests pass” alone.
