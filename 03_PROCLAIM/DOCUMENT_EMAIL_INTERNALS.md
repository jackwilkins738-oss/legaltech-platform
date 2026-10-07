# DOCUMENT & EMAIL INTERNALS

## Proclaim history model evidence
Current Access help describes documents as associated with History Lines.
Users work with history lines through contextual actions including:
- display
- amend
- resend
- history-detail changes
- print
- email/fax

Current help also documents history folders, master/local folders and version-dependent UI.

## Email integration evidence
Current official help:
- 32-bit Outlook required
- New Outlook unsupported
- Cached Exchange Mode can contribute to issues
- Outlook automation errors can affect drag-and-drop
- troubleshooting may include Office/Proclaim reinstall and even workstation rebuild

## Product design requirement
Do not make email/document processing a desktop-client responsibility.

## Proposed inbound architecture
Microsoft Graph / API
→ webhook/event
→ ingestion queue
→ malware/quarantine
→ parser
→ matter matching
→ document classification
→ extraction
→ action detection
→ human approval policy
→ canonical matter event
→ search index
→ audit log

## Document object model
Document should be a first-class object with:
- immutable ID
- tenant
- matter
- source
- original binary
- hash
- MIME
- filename
- classification
- version
- author/uploader
- timestamps
- OCR text
- extracted metadata
- permissions
- privilege/confidentiality markers
- retention
- legal hold
- audit events

## Email object model
- message ID
- internet message ID
- thread/conversation
- sender
- recipients
- sent/received
- tenant
- matter candidate(s)
- attachments
- classifications
- extracted tasks/deadlines
- filing state
- human decision
- audit trail

## Matter matching
Use multiple signals:
- explicit matter reference
- sender/recipient
- thread history
- client
- opponent
- solicitor
- court reference
- attachment text
- prior correspondence
- known domains
- semantic similarity

Never use a single subject-line token as the only confidence basis.

## Sources
https://help-proclaim.theaccessgroup.com/en/articles/12500059-work-with-documents-in-the-history
https://help-proclaim.theaccessgroup.com/en/articles/12500025-set-up-and-view-history-folders
https://help-proclaim.theaccessgroup.com/en/articles/11631610-error-dragging-emails-from-outlook-into-proclaim
https://help-proclaim.theaccessgroup.com/en/articles/12505742-unable-to-send-emails-from-within-proclaim
