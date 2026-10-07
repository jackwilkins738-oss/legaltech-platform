# MICROSOFT ENTRA SSO / SCIM SPEC

## SSO
Support:
- OpenID Connect primary
- SAML where enterprise customer requires it

## Tenant onboarding
Customer admin configures:
- tenant ID
- application
- allowed domains
- group/claim mappings

## Provisioning
Expose SCIM 2.0 endpoint so Entra can:
- create users
- update attributes
- disable/deprovision
- provision groups
- update group membership

Microsoft Entra operates as the SCIM client and can automatically provision and deprovision users/groups in SaaS applications exposing SCIM endpoints.

## SCIM resources
/Users
/Groups

## Mapping
Customer Entra group:
"PI Solicitors"
→ platform team/role mapping

## Security
- SCIM bearer/token or supported auth protected
- token rotation
- tenant-specific endpoint/credentials
- rate limiting
- audit every provisioning action

## Deprovision
Disable quickly:
- revoke sessions
- remove ordinary access
- preserve audit/history attribution

Do not delete historical actor identity from audit records.

## JIT
Optional JIT user creation via SSO may exist for smaller firms.
Enterprise default should favour controlled provisioning.

## Source
https://learn.microsoft.com/en-us/entra/identity/app-provisioning/scim-support-in-entra-id
https://learn.microsoft.com/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups
