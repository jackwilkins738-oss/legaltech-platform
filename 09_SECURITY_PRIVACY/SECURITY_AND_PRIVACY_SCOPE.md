# SECURITY AND PRIVACY SCOPE

## Security objective
Assume compromise attempts will happen.
Design so one compromised user/service cannot expose the entire platform.

## Required domains
- threat modelling
- tenant isolation
- authentication
- SSO
- phishing-resistant MFA
- RBAC/ABAC
- matter-level permissions
- information barriers
- privileged access
- joiner/mover/leaver
- session security
- TLS
- at-rest encryption
- KMS/HSM strategy
- secrets management
- private databases
- RLS where appropriate
- object storage security
- short-lived signed URLs
- search isolation
- cache isolation
- API authorization
- WAF/rate limiting
- file quarantine
- malware scanning
- safe OCR/preview workers
- secure email integration
- audit logs
- immutable/security logs
- SIEM/alerting
- vulnerability management
- SAST/DAST/dependency/secret scanning
- SBOM
- environment separation
- backup/restore
- ransomware resilience
- incident response
- BCP/DR
- pen testing
- red team

## Privacy
Likely legal-firm data may include:
- health data
- criminal-offence data
- financial data
- IDs
- privileged legal information
- highly sensitive correspondence

UK GDPR requires lawful processing and additional conditions for special-category data. Large-scale special-category processing can mandate DPIAs.

## Controller/processor
Likely pattern:
law firm = controller
platform = processor
But individual features may create separate-controller questions.
Must be mapped rather than assumed.

## Sources
ICO special-category guidance:
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/special-category-data/what-are-the-rules-on-special-category-data/

ICO DPIA guidance:
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/guide-to-accountability-and-governance/data-protection-impact-assessments/

ICO controllers/processors:
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/controllers-and-processors/controllers-and-processors/

SRA confidentiality:
https://www.sra.org.uk/solicitors/guidance/confidentiality-client-information/
