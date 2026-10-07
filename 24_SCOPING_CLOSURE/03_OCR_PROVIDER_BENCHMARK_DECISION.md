# OCR / DOCUMENT PROCESSING BENCHMARK

## Candidates
1. Azure Document Intelligence
2. Google Document AI
3. AWS Textract

## Current public price signals
Google currently publishes Enterprise Document OCR at roughly $1.50 per 1,000 pages and higher prices for layout/custom extraction.

Azure Document Intelligence is page-billed and provides a free test tier; exact displayed UK prices depend on region/agreement and should be obtained from the Azure calculator.

AWS Textract is usage-based with no minimum fee; price depends on API/function.

Sources:
- Google: https://cloud.google.com/document-ai
- Azure: https://azure.microsoft.com/en-gb/pricing/details/document-intelligence/
- AWS: https://aws.amazon.com/textract/pricing/

## Benchmark corpus
At least 500 pages:
- clean born-digital PDF;
- scan;
- rotated/skewed;
- handwriting where relevant;
- tables;
- medical notes;
- court order;
- insurer correspondence;
- mixed bundle.

## Score
- character/text accuracy: 25%
- layout/table retention: 15%
- source coordinates/provenance: 15%
- difficult scans: 15%
- security/UK/EU deployment: 15%
- latency: 5%
- cost: 10%

## Provisional architecture
`DocumentProcessor` interface must make provider replaceable.

## Recommendation
For Microsoft-heavy UK law firms, Azure deserves first benchmark because operational alignment may matter even if another provider is marginally cheaper.

Do not decide from price alone.
