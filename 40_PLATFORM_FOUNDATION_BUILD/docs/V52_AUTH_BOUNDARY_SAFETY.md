# V52 — Authentication boundary safety

Status: current synthetic defect remediation under D-018.

## Reproduced failures and resulting behavior

- A string containing `matter:read` or a custom `includes` object could grant a
  permission. Capability checks now accept bounded ordinary arrays of owned data
  elements and exact string membership only. Malformed privileges deny with 404.
- OIDC claims inherited through prototypes, numeric tenant IDs and object actor
  IDs were accepted/coerced. The mapper now requires an own boolean verification
  marker and own typed data fields on an ordinary or null-prototype record.
- Static configuration exposed its mutable token/session Map. It now keeps a
  private immutable projection, rejects duplicate tokens and drops extra metadata.
- A provider could mutate the session tenant or review actor while an HTTP request
  awaited its body. Every authenticated route now snapshots and freezes the
  provider result before authorization, retrieval, body reads and mutation.
- Malformed bearer header values could throw TypeError. Static authentication now
  returns a bounded 401 and rejects ambiguous aliases/accessors.

## Existing contract and compatibility

Identities (tenant, actor and optional session ID) are nonempty strings up to 200
characters, with no leading/trailing whitespace or ASCII controls. Roles and
capabilities are optional arrays up to 128 entries; entries are ASCII names up to
200 characters using letters, digits, period, underscore, colon and hyphen, starting
with a letter/digit. Present null/malformed fields are rejected; missing arrays
become empty. Duplicate entries collapse without granting new permissions. Array
holes, array subclasses and accessor entries are rejected without invoking getters.

Static local bearer tokens are case sensitive, bounded to 4096 characters and use
ordinary bearer token characters. The scheme is case insensitive with a single
space separator. Static session IDs retain their previous deterministic token hash
when not supplied. The token registry is intentionally no longer public. Recreate
this local synthetic provider to change its configuration; public Map mutation is
not a supported administration mechanism.

OIDC custom aliases remain supported but are private and immutable, distinct and
bounded; aliases for reserved verification/session/prototype names are rejected.
A missing OIDC session ID receives a generated ID. The mapper drops extra claims
and never coerces identity objects or numbers. No real customer/provider contract
has been established; validate authorized provider mappings before integration.

`normalizeSession` validates a trusted authentication provider's result; it cannot
prove the caller authenticated. The OIDC `__verified` field is a trusted server-code
marker, not cryptographic evidence. Signature, issuer, audience, expiry, revocation,
MFA and session lifecycle remain responsibilities of future authorized upstream
middleware. Never map client-supplied JSON as verified claims. No production SSO
implementation or new dependency is added. JavaScript proxies/executable trusted
providers are not a sandbox; ordinary data/accessor validation is the boundary.

## Failure and release boundaries

Invalid returned sessions fail with 401 AUTH_REQUIRED before application calls.
Unexpected provider exceptions retain the existing redacted error boundary. Health
and existing static assets remain available without authentication. Missing exact
permissions remain 404 to preserve resource concealment. No store/schema changes,
backfill, automatic repair, live connector or altered human decision gate occurs.

81 synthetic cases cover malformed identities/arrays/headers, claims provenance,
getters, aliases, bounds, private configuration, immutable output, exact permissions
and actual loopback HTTP tenant/actor substitution during delayed body reads.
All prior platform and reference suites remain required. Installer needs merged
V51 main (0.10.6), protects unrelated work and permits only optional scoped feature
commit/push. Review the auth changes and GitHub checks before merging. Human security
review is required by 21_ENGINEERING_OPERATING_SYSTEM/00_ENGINEERING_START_HERE.md.
Revert the PR through normal review if needed; no database rollback is required.
