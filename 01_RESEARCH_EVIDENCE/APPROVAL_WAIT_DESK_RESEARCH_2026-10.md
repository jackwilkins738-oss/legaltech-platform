# Approval wait — desk research and follow-up plan

STATUS: PROVISIONAL
DOMAIN: research evidence / supervision workflow
AUTHORITY: medium
EVIDENCE CLASS: mixed (desk research labelled per claim below); the product idea is a HYPOTHESIS
DATE: 2026-10-10
REVIEW TRIGGER: the partner's approval log arrives; or the SRA supervision guidance changes again
RAW SOURCE: `39_POST_TO_EVIDENCE/00_RAW_IMMUTABLE/2026-10-10_PARTNER_REPORT_APPROVAL_WAIT.md`

This is not a decision. It does not change the wedge ranking or engineering priority. Those go through `38_DIGITAL_PRE_TO_LOCK/02_STRATEGY_CHANGE_GATE.md`.

## Hypothesis

H-APPROVAL-01: in Proclaim-using PI firms, a handler's task often stops at a supervisor approval. The request goes by email and waits hours. A queue that sends each approval to the approver with its context, escalates or reassigns it when the approver is away, and lets a written rule pass routine items with a log entry would:

- cut the wait from sent to decided by an order of magnitude;
- produce the supervision record the SRA now expects.

Proposed metric: median and 90th-percentile approval wait, per approval type.

## Claims found (2026-10-10)

Pages could not be opened from the research session (network policy). The claims below come from search-result summaries of the cited pages. Each needs reading at source before anyone quotes it externally.

| ID | Claim | Label | Source | Confidence |
|---|---|---|---|---|
| C-01 | The Court of Appeal (31 Mar 2026) reversed the High Court's *Mazur* ruling. Unauthorised staff may conduct litigation under appropriate supervision of an authorised person, who stays responsible. | VERIFIED FACT, read at second hand | [Legal Cheek](https://www.legalcheek.com/2026/03/court-of-appeal-overturns-ruling-that-threatened-role-of-paralegals-and-trainees-conducting-litigation/), [Taylor Wessing](https://www.taylorwessing.com/en/insights-and-events/insights/2026/04/who-can-do-what-in-litigation), [Law Society](https://www.lawsociety.org.uk/topics/regulation/what-the-mazur-judgment-means-for-you) | High |
| C-02 | The court said routine PI claims may be supervised by "light touch review". | VERIFIED FACT, read at second hand | [Dyne Solicitors](https://www.dynesolicitors.co.uk/mazur-judgment-court-of-appeal-march-2026-and-the-practical-consequences-of-the-ruling/) | Medium |
| C-03 | The SRA revised its "Effective supervision" guidance on 12 Jun 2026, growing it from 9 to 24 pages. It allows delegation through case management systems and workflows, but it requires: (a) clear escalation routes; (b) supervisors who are available; (c) supervisors who review management information on caseloads and on the progress and flow of cases; (d) arrangements set up before work starts; (e) a record of the reasons for the supervision design. | VERIFIED FACT, read at second hand | [SRA guidance](https://www.sra.org.uk/solicitors/guidance/effective-supervision-guidance/), [SRA press](https://www.sra.org.uk/news/news/press/supervision-guidance-updated/), [Legal Futures](https://www.legalfutures.co.uk/latest-news/sra-rewrites-supervision-guidance-after-mazur-ruling), [Infolegal](https://www.infolegal.co.uk/articles/supervision-after-mazur) | Medium. Read the SRA text before relying on it. |
| C-04 | A guidance example: a solicitor with their own caseload who reviewed 10 paralegals' work only every few months was not supervising effectively. A claims firm was fined £30k by the SDT for a part-time supervisor over a 12-person team. | MARKET SIGNAL | [Lawyer Monthly](https://www.lawyer-monthly.com/2026/06/sra-post-mazur-supervision-guidance-2026/) | Medium |
| C-05 | There are very few public Proclaim reviews (G2 has 3, rated 4.2). Complaints: hard to navigate, a long learning curve, occasional crashes. | SINGLE USER REPORT ×3 | [G2](https://www.g2.com/products/eclipse-legal-systems-proclaim/reviews) | Low |
| C-06 | A forum user says reseller support tickets take weeks or months and fixes are charged for. | SINGLE USER REPORT | [Proclaim forum](https://www.proclaimforum.co.uk/viewtopic.php?t=1210) | Low |
| C-07 | Nothing public found on approvals or tasks inside Proclaim specifically. | absence of evidence | — | — |
| C-08 | No UK product found that sells a supervision or approval queue for Proclaim or PI firms. Insight Legal advertises "in-built escalations with compliance checks". Proclaim has a named integrations partner (Zeus Tech). | MARKET SIGNAL | [Insight Legal](https://www.insightlegal.co.uk/solicitors-software/case-management/), [Today's Conveyancer](https://todaysconveyancer.co.uk/another-proclaim-user-firm-selects-virtualsignature-automate-claims-process/) | Low (absence is not proof) |
| C-09 | In vendor and practitioner material, handoffs and waiting, not the review itself, dominate legal cycle time. Example: 11 days elapsed against 2 hours of review. Most firms do not track "waiting" as its own status. | MARKET SIGNAL (vendor) | [Vaquill](https://www.vaquill.ai/blog/contract-turnaround-time), [Miramis](https://miramis.co/content-hub/contract-cycle-time), [Mitratech](https://mitratech.com/?p=32809), [LegalBoards](https://legalboards.com/resources/blog/paralegal-deadline-tracking) | Low |

## Counter-evidence and ways this is wrong

Per the anti-confirmation rule in `EVIDENCE_STANDARD.md`:

- **The wait may be availability, not visibility.** If approvers are in hearings, on leave or overloaded, a queue does not help. The product would then be delegation and escalation rules, or the problem is staffing.
- **It may be configuration, not product.** Proclaim's own task, referral, workflow and escalation features may already do this when configured. Email use may be one firm's habit.
- **The rules may be relaxing.** C-02 lets firms cut routine approvals. Some firms will respond by removing steps rather than buying a faster queue.
- **The pain may be temporary.** If the firm added approval steps after the 2025 High Court ruling, part of the pain may ease since the 2026 reversal.
- **Incumbents could copy it.** CaseMatters Evo, Insight Legal or Proclaim configuration could ship an equivalent.
- **Adoption risk.** A separate dashboard that approvers must visit is likely to be ignored. Approvals must reach the approver in Outlook or Teams.
- **One firm's practice.** This comes from one user at one firm (see `WHY_WE_MIGHT_BE_WRONG.md`: "the partner's branch may be unrepresentative").

## Why this matters if it holds

There are two buyers, not one. Handlers want speed. The COLP and partners need evidence of supervision under C-03, and they hold the budget. Each approval with timestamps and a stated basis is that evidence.

This also connects to existing assumptions: "Matter Command has management value" (supervision and stale-file pain) and the B exception-queue wedge. V130's `domain_review_decisions` (an immutable decision, by an active user, bound to the exact item) is the same primitive. That is a note for later, not a build instruction.

## Actions

| # | Action | Owner | Output |
|---|---|---|---|
| A1 | Log every approval for one week. Columns: sent time, decided time, approval type, why approval was needed, what the handler did while waiting, whether a written rule could have decided it, and what slipped. No client, matter or personal data (`25_TO_DAY0_OPERATING_KIT/02_ANONYMISATION_RULES.md`). | partner | raw log, stored in `39_POST_TO_EVIDENCE/00_RAW_IMMUTABLE/` |
| A2 | Find out why approvals go by email and not through Proclaim tasks, referrals or escalation. | partner | answer recorded against the raw note |
| A3 | Find out whether approval steps were added after *Mazur* (late 2025), and whether any were removed after March 2026. | partner | answer recorded against the raw note |
| A4 | Name who owns supervision compliance (COLP or head of department) and what they use today as evidence of supervision. | partner | answer recorded against the raw note |
| A5 | Read the SRA guidance itself and confirm C-03 and C-04 word for word. | founder | C-03 and C-04 upgraded or corrected |
| A6 | When A1–A3 are in: split the wait into notice, context and availability components; work out cost per handler per week; run the cheapest-fix test (`37_PRE_TO_LAST_MILE_RESEARCH_DESIGN/11_CHEAPEST_FIX_LADDER.md`). | Claude | `39_POST_TO_EVIDENCE/02_ANALYSIS/` |
| A7 | Test with 5 PI handlers or supervisors at other firms: does the approval wait repeat? (pass: 3 or more repeats) | founder | `39_POST_TO_EVIDENCE/05_EXTERNAL_VALIDATION/` |
| A8 | Only if A6 and A7 pass: build a clickable mock with fake data (a flag screen and an approver queue) and watch 2–3 case managers use it. | Claude, after a go decision | — |

Building on the durable path waits for a recorded decision in `39_POST_TO_EVIDENCE/03_DECISIONS/`.
