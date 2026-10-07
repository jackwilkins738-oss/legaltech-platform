# Flow, WIP and queue analysis

Task handling time is only one source of delay.

Capture or request, where available:
- work-in-progress count;
- queue/backlog age;
- arrival rate;
- completion rate;
- reopen/rework rate;
- stage throughput;
- elapsed cycle time;
- external wait;
- internal handoff wait.

## Critical-path question
For each material task/dependency ask:
**Does this block the next meaningful matter state?**

A two-minute action that blocks a matter for fourteen days may be more valuable than a ten-minute admin task that is not on the critical path.

## Sanity check
Where WIP, throughput and cycle time are measured consistently, use Little's Law as a reasonableness check—not as a substitute for the underlying data.
