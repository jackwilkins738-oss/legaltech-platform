# OCR / DOCUMENT PROCESSING PROVIDER COMPARISON

## Requirement
OCR service must not become a hidden security/data-residency weakness.

## AWS Textract
Strengths:
- AWS-native IAM/KMS ecosystem
- London region available
- forms/tables/text
- compliance programmes include SOC/ISO/HIPAA scope

Important:
AWS documentation states region/data handling details must be reviewed carefully.
Current FAQ notes service-improvement handling can have specific cross-region implications unless appropriate controls/opt-outs apply.

## Google Document AI
Strengths:
- mature processor ecosystem
- EU multi-region
- London single-region support for some capabilities
- VPC Service Controls
- Access Transparency
- CMEK support for relevant configurations

Important:
Some newer generative processor versions may use global endpoints and may not meet regional-residency expectations.
Provider/model/version must be pinned and reviewed.

## Azure AI Document Intelligence
Natural candidate where customers are Microsoft-centric.

Evaluate:
- UK/EU region support
- private endpoints
- Entra/IAM
- retention
- model capabilities
- document formats

## Selection criteria
- UK/EU processing
- retention
- training
- encryption
- private network capability
- accuracy on:
  - medical records
  - scanned correspondence
  - court forms
  - letters
- tables
- handwriting
- cost/page
- latency
- PDF limits
- audit logs

## Architecture
DocumentProcessor interface:
extractText()
extractLayout()
extractTables()
classify()
health()

Raw file stays in our controlled storage where possible.
Send only necessary content to processor.

## Sources
AWS:
https://docs.aws.amazon.com/textract/latest/dg/data-protection.html
https://docs.aws.amazon.com/general/latest/gr/textract.html

Google:
https://docs.cloud.google.com/document-ai/docs/regions
https://docs.cloud.google.com/document-ai/docs/security
