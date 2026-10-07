# Security Regression Test Results

Repository scanner exit: 0
- secret-pattern hits: 0
- unsafe defaults: 0
- sensitive log hits: 0
- missing security-test concepts: 0
- schema/event files fingerprinted: 19
- fingerprint: `7b1ad32ff0d2761d1d9de84d68d5368b57d66f0453b1ae066f133782fe4abe98`

Policy tests:
```
PASS test_cross_tenant_required
PASS test_manifest_has_blockers
PASS test_no_external_send_default
PASS test_sensitive_tokens_present
4/4 passed
```

Overall: PASS

These checks validate repository content only, not production security.
