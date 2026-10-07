# V1 SECURITY ACCEPTANCE CRITERIA

V1 cannot enter real-client production until all applicable items pass.

## Tenant isolation
- [ ] every tenant-owned table has tenant control
- [ ] cross-tenant ID tests fail safely
- [ ] storage cross-tenant tests
- [ ] search cross-tenant tests
- [ ] cache isolation tests
- [ ] queue jobs carry tenant context

## Authentication
- [ ] MFA for internal privileged access
- [ ] secure session cookies
- [ ] logout/revoke works
- [ ] password reset safe if passwords used
- [ ] brute force/rate controls

## Authorisation
- [ ] server-side object authz
- [ ] matter permission
- [ ] restricted matter test
- [ ] privilege escalation test
- [ ] admin actions logged

## Secrets
- [ ] zero secrets committed
- [ ] secret scanning
- [ ] dedicated secrets manager
- [ ] prod/non-prod separation
- [ ] rotation process

## Database/storage
- [ ] DB not publicly exposed unless explicitly justified
- [ ] encryption
- [ ] private object storage
- [ ] signed URL expiry
- [ ] object authorization before URL

## Uploads
- [ ] MIME/content validation
- [ ] malware scan
- [ ] size limit
- [ ] archive bomb protection
- [ ] parser isolation

## API
- [ ] input validation
- [ ] rate limiting
- [ ] BOLA/IDOR test
- [ ] SSRF test
- [ ] injection test
- [ ] webhook signature/state validation

## Graph
- [ ] least privileged permissions
- [ ] mailbox scope
- [ ] token protected
- [ ] subscription lifecycle
- [ ] webhook replay/dedupe

## AI
- [ ] tenant-aware retrieval
- [ ] prompt injection tests
- [ ] model has no unrestricted DB
- [ ] tool allowlist
- [ ] human approval high-impact action
- [ ] evaluation thresholds met

## Logs
- [ ] structured
- [ ] no secrets
- [ ] sensitive content minimised
- [ ] privileged actions auditable
- [ ] alerting

## Backup
- [ ] PITR
- [ ] document recovery
- [ ] restore tested
- [ ] backup deletion protected
- [ ] emergency recovery

## SDLC
- [ ] code review
- [ ] branch protection
- [ ] SAST
- [ ] dependency scan
- [ ] secret scan
- [ ] security tests CI
- [ ] rollback

## External assurance
Before serious enterprise use:
- [ ] independent pen test
- [ ] critical/high remediation
- [ ] retest
