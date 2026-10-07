# Developer Reproducibility & Contract Verification

This directory is the pre-TO developer control plane.

It does **not** choose the final product wedge and it does not contain customer credentials.

## Purpose
- one-command repository verification;
- validate required contracts are present;
- deterministic reference reset/seed;
- local admin/review surface;
- environment-safety checks;
- explicit blockers for work requiring real evidence.

## Commands
```bash
npm test
npm run verify:contracts
npm run verify:repo
npm run dev:check
npm run reset:reference
npm run seed:reference
npm run serve:admin
```

## Expected order for Claude Code
1. `npm run dev:check`
2. `npm test`
3. read root `CLAUDE.md`
4. read `21_ENGINEERING_OPERATING_SYSTEM/`
5. inspect `22_IMPLEMENTATION_FOUNDATION/`
6. use reference implementation for behavioural expectations
7. do not cross evidence/human-review gates

## Explicit non-goals
- production deployment;
- real Graph credentials;
- real Proclaim credentials;
- customer data;
- final auth provider selection;
- final queue/cloud selection.
