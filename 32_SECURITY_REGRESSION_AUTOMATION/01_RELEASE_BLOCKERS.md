# SECURITY RELEASE BLOCKERS

Block customer staging if any of these remain open:
1. Cross-tenant read/write possible.
2. Restricted-matter existence leakage.
3. External side effects not idempotent/reconcilable.
4. Secret committed to repo.
5. Raw confidential content logged by default.
6. AI tools bypass authorization.
7. Hostile files reach trusted parsing path.
8. Production can boot with unsafe defaults.
9. Schema change drops tenant/security constraints.
10. Customer-data subprocessor added without approval.
