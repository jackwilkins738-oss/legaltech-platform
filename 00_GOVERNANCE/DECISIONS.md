# DECISIONS — AUTHORITATIVE

## D-001 — First wedge
**Status:** PROVISIONAL DECISION
Focus research/build spikes on inbound legal operations rather than full PMS replacement. Final confirmation blocked by TO/customer evidence.

## D-002 — Initial practice-area priority
**Status:** PROVISIONAL DECISION
Personal injury first; clinical negligence later if validated.

## D-003 — Accounting
**Status:** DECISION
Full legal accounting and client-money movement are out of V1. Integrate/read status instead.

## D-004 — AI authority
**Status:** DECISION
AI cannot bypass normal authorisation. High-impact actions require defined human/policy approval.

## D-005 — Deadlines
**Status:** DECISION
V1 extracts deadline candidates; authoritative legal deadlines require confirmation/rule validation.

## D-006 — Matter matching
**Status:** DECISION
Use hybrid deterministic/entity/thread/semantic evidence. Semantic-only matching cannot auto-file.

## D-007 — Graph permissions
**Status:** DECISION
Use least privilege and separate read/write/send identities where practical. Scope application access to approved mailboxes.

## D-008 — Architecture
**Status:** DECISION
Start with a modular monolith, separate workers for heavy/unsafe processing, and explicit integration adapters. Do not prematurely adopt microservices.

## D-009 — Canonical model
**Status:** DECISION
Do not mirror Proclaim's schema. Map Proclaim into our canonical legal-operations model.

## D-010 — Search/RAG security
**Status:** DECISION
Authorisation constrains retrieval before the model sees content.

## D-011 — Migration
**Status:** DECISION
Migration is a product capability: discovery, mapping, rehearsal, reconciliation, delta/cutover, rollback and export.

## D-012 — Customer configuration
**Status:** DECISION
Configuration must be declarative, versioned, testable and rollbackable. No arbitrary code/SQL/network calls in ordinary workflow configuration.

## D-013 — Cloud/tool portability
**Status:** DECISION
Vercel/Supabase may be used early but are not architectural commitments. Preserve portability and enterprise migration path.

## D-014 — Certifications
**Status:** DECISION
Implement controls now; pursue certification after product/customer evidence justifies cost. Planned order: Cyber Essentials → CE Plus → ISO 27001 → ISO 27701 → ISO 42001 when relevant.

## D-015 — Commercial validation
**Status:** DECISION
Use paid pilots with explicit baseline and success gates rather than free bespoke builds.

## D-016 — TO evidence separation
**Status:** DECISION
Direct observation timing, workflow frequency and task population must be recorded as separate evidence types. Annualisation is performed at Task Family × Role only after volume inputs are independently sourced and explicitly validated.

## D-017 — TO sampling
**Status:** DECISION
Begin with calibration and continuous observation where practical before targeted repeats. Targeted samples cannot be treated as workflow prevalence.

## D-018 — Pre-TO engineering freeze
**Status:** DECISION
After completion of the pre-TO reference/security scaffolding, pause speculative application engineering until initial TO evidence is analysed. Only defect fixes, evidence tooling or authorised integration tests may proceed.

## D-019 — GitHub becomes canonical engineering source of truth
**Status:** DECISION

Once the repository is connected using `CONNECT_GITHUB.ps1`, the private GitHub repository on `main` becomes the canonical engineering source of truth. Substantive changes should use feature branches and pull requests, with GitHub Actions as a merge gate. Versioned ZIP folders are distribution/bootstrap artifacts only and must not become competing working copies. Local runtime state, secrets, real customer data and `.env` files must not be committed.

