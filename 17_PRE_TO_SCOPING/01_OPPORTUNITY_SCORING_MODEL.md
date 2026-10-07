# OPPORTUNITY SCORING MODEL

## Objective
Rank workflows using economic value, technical feasibility, safety and strategic expansion—not founder preference.

## Step 1 — Economic burden

For each workflow:

**Annual Events**
= People Performing Task × Events per Person per Day × Working Days

**Annual Human Hours**
= Annual Events × Average Handling Minutes / 60

**Annual Capacity Cost**
= Annual Human Hours × Loaded Hourly Cost

Also record:
- rework %
- supervisor/review minutes
- waiting time
- backlog
- error incidents

Do not confuse waiting time with labour time, but use it for client/cycle-time value.

---

# Step 2 — Automation ceiling

Rate 0–5.

## 5 — highly deterministic
Repeated inputs, standard output, minimal professional judgement.

## 4
Mostly deterministic with a small exception queue.

## 3
Meaningful exceptions or contextual judgement.

## 2
Frequent legal/professional judgement.

## 1
Mostly judgement; AI can only assist.

## 0
Should not be automated.

---

# Step 3 — Score dimensions

Each score is 0–5.

## A. Annual Capacity Cost — 20%
0 < £5k
1 £5k–£15k
2 £15k–£30k
3 £30k–£60k
4 £60k–£120k
5 £120k+

Adjust thresholds if actual target-firm economics differ.

## B. Frequency — 10%
0 rare
5 continuous daily workflow across team

## C. Standardisation — 10%
0 unique each time
5 highly repeated structure

## D. Automation Ceiling — 15%
As above.

## E. Technical Feasibility — 10%
Consider:
- Graph/API access
- Proclaim read/write
- document parsability
- integration stability

## F. Error Safety — 10%
5 = errors easily detected/reversible
0 = a single error can create severe irreversible harm

Note: this score is intentionally inverse-risk.

## G. Pilot Simplicity — 10%
5 = one team/mailbox/workflow
0 = requires firm-wide migration/accounting changes

## H. Buyer Pain / Willingness to Delegate — 5%
Requires customer evidence.
Until then mark UNKNOWN.

## I. ACV Potential — 5%
How much value can realistically be captured?

## J. Expansion Value — 5%
Does winning this workflow deepen matter context or unlock adjacent modules?

---

# Weighted Opportunity Score

Weighted Score =
A×20 +
B×10 +
C×10 +
D×15 +
E×10 +
F×10 +
G×10 +
H×5 +
I×5 +
J×5

Divide by 5 to get score /100.

## Data completeness penalty
Do not rank an opportunity as "confirmed" when >25% of weighted inputs are assumptions.

Classify:
- **Observed**
- **Customer-validated**
- **Measured**
- **Assumption**

---

# Strategic overlay

A high numeric score can still be rejected if:
- it requires legal accounting in V1;
- customer will not grant access;
- Proclaim API cannot safely support it;
- competitor already solves it extremely well at low switching cost;
- it creates no reusable platform capability.

---

# Initial candidate workflows to score tomorrow

1. Email/document filing
2. Matter matching
3. Task creation from inbound correspondence
4. Third-party chasing
5. Medical-record request / chase
6. Client status updates
7. Missing evidence detection
8. Court/deadline extraction
9. Document naming/classification
10. Data entry / field updates
11. Standard correspondence drafting
12. Supervisor case-health review
13. Intake/re-keying
14. Expert coordination
15. Bundle/pack assembly

Do not assume #1 wins.
