# V99 exact dead-letter recovery

V99 makes operator recovery an exact-target operation rather than a generic retry button.

- Recovery binds to the exact tenant, job, immutable payload snapshot, trace, attempt count and failure state.
- Attempts are preserved; recovery cannot reset the retry budget.
- A changed/replaced job invalidates the recovery approval.
- Risk classification fails closed. High-risk jobs require a different approver before execution.
- Recovery evidence carries bounded reason/evidence hashes and hashed actor/trace references rather than job payloads.
- Only a dead job can be requeued, and the store uses compare-and-swap semantics for the exact snapshot.

The reference layer does not decide which firm-specific jobs are high risk; production classification must be server-owned and reviewed.
