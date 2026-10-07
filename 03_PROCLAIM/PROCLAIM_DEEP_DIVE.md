# PROCLAIM DEEP DIVE

## Verified commercial baseline
Published G-Cloud pricing (2024) for Proclaim:
- 5–20 users: £79/user/month
- 21–50 users: £76/user/month
- 51–100 users: £73/user/month
- 100+: bespoke
- Prices exclude VAT and hosting.
- Two modules are included in the core package.

Published add-ons include:
- Accounts module: £500/month
- Additional practice-area module: £150/month
- Numerous integrations in the ~£95–£490/month range depending on type.

Published Proclaim hosting pricing is separate. The G-Cloud hosting document lists approximately £43–£54/user/month for many cohorts in the 50–100 user range.

### Implication
A 100-user firm can plausibly incur:
- ~£7,300/month core licence
- potentially ~£4,300/month hosting at 91–100-user published band
- additional modules/integrations/support
before VAT.

Do not state that every firm pays this. Contracting may differ. But the public benchmark shows that total Proclaim platform TCO can materially exceed the licence-only figure.

## Verified technical constraints
Access' July 2026 Proclaim v4 prerequisites specify:
- Windows client
- OpenEdge 32-bit client
- 32-bit Microsoft Office
- 64-bit Office unsupported
- 32-bit WebView2
- Outlook add-in dependency
- Classic Outlook requirements appear in current troubleshooting documentation

Access' August 2026 Outlook troubleshooting documentation says:
- Proclaim requires 32-bit Microsoft 365/Office
- New Outlook is not supported
- users may need to exit/re-enter Proclaim to clear some drag/drop errors
- repair/reinstall Office/Proclaim may be required
- in persistent workstation cases, rebuilding the machine is listed as a possible remediation

## Product strengths
Do not understate these:
- highly configurable case-management model
- workflows and task automation
- document generation
- history/document storage
- mature installed base
- legal-sector-specific integrations
- accounts support
- years of accumulated practice-area configuration
- switching costs and organisational familiarity

## Structural weaknesses / opportunities
### Legacy desktop dependency
Creates:
- desktop compatibility burden
- Office architecture constraints
- IT support burden
- slower adoption of modern Microsoft client changes
- remote-working complexity

### Configuration power versus accessibility
Proclaim's flexibility can also create specialist dependency.
The strategic opportunity is not simply "more configurable":
it is "configuration that ordinary authorised operations staff can understand, test and deploy safely."

### History/document UX
Current documentation reflects a history-line/folder interaction model with right-click actions and version-specific behaviour.
A modern system should treat documents, correspondence, tasks, deadlines and decisions as linked first-class objects with strong search and timeline semantics.

### Email workflow
Current support documentation confirms desktop Outlook integration fragility.
The modern architecture should be Graph/API-led rather than desktop automation-led.

## CaseMatters Evo threat
Access is already attempting to modernise:
- browser
- AI
- performance
- automation
Therefore "cloud/browser/AI" is not a durable differentiator by itself.

## Source register
- Access Legal Proclaim G-Cloud pricing, 2024:
  https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/documents/579935/764763454722568-pricing-document-2024-05-07-1217.pdf
- Access Proclaim Hosting G-Cloud pricing:
  https://assets.applytosupply.digitalmarketplace.service.gov.uk/g-cloud-14/documents/579935/240622392298408-pricing-document-2024-05-07-1120.pdf
- Proclaim v4 prerequisites:
  https://help-proclaim.theaccessgroup.com/en/articles/12528879-pre-requisites-for-software-release-v4
- Outlook drag/drop troubleshooting:
  https://help-proclaim.theaccessgroup.com/en/articles/11631610-error-dragging-emails-from-outlook-into-proclaim
- Email sending troubleshooting:
  https://help-proclaim.theaccessgroup.com/en/articles/12505742-unable-to-send-emails-from-within-proclaim
- Document history:
  https://help-proclaim.theaccessgroup.com/en/articles/12500059-work-with-documents-in-the-history
