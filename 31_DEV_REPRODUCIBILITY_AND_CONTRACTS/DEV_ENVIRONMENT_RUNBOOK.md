# Local Developer Environment Runbook

## Minimum
- Node 22+
- Git
- optional Docker/Postgres for the production-shape migration experiment

## First command
`npm run dev:check`

It checks:
- expected repository contracts exist;
- Proclaim evidence-gated tasks remain blocked;
- OpenAPI reference endpoints remain present;
- JSON schemas parse;
- no obvious customer/prod `.env` has been placed in the production-shape directory.

## Local data
Use only synthetic fixtures supplied in the repository.

## Postgres
If Docker/Postgres is available later:
1. start `30_PRODUCTION_SHAPE_SCAFFOLD/compose.yaml`;
2. apply migrations in numeric order;
3. run RLS tenant-crossing tests;
4. record results in the repository.

Until that execution occurs, the SQL remains a design/prototype artefact, not production-proven database security.
