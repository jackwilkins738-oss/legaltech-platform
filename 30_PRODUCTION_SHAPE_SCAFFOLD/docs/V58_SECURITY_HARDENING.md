# V58 production-shape security hardening

This scaffold now models database-enforced tenant integrity, restricted-matter membership, security-zone barriers, document overrides, matter-bound break-glass, append-only audit behaviour and fail-closed production configuration.

Production remains blocked from real client data until external evidence exists for OIDC/session revocation and step-up, managed secrets/KMS and private infrastructure, distributed rate limiting/session storage, central audit/monitoring, malware scanning/parser isolation, live Microsoft Graph and Proclaim validation, encrypted backup/restore, and an independent penetration test.

The environment gate is an interlock, not proof. Runtime production roles must not be PostgreSQL owners/superusers/BYPASSRLS roles, and privileged grant/revoke paths must use separately controlled administrative identities with audit evidence.
