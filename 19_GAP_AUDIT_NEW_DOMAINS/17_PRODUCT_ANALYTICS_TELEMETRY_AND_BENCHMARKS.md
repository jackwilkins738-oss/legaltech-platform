# PRODUCT ANALYTICS, TELEMETRY & BENCHMARKING

## Product analytics needed
Per tenant:
- events processed;
- automation rate;
- review rate;
- correction rate;
- processing latency;
- exception age;
- active users;
- feature adoption;
- time saved estimate.

## Privacy
Default telemetry should avoid raw legal content.

Prefer:
- event type;
- timings;
- counts;
- error codes;
- model/version;
- tenant pseudonymous operational IDs.

## Benchmark opportunity
Long-term:
"Your PI inbound handling is 35% slower than anonymised cohort."

This could be a moat.

## But
Cross-customer benchmarking requires:
- contract rights;
- privacy analysis;
- anonymisation/aggregation;
- minimum cohort size;
- re-identification testing;
- customer transparency.

Do not assume processor data can be repurposed for commercial benchmarking.

## Model improvement
Separate:
1. customer-specific correction/configuration;
2. anonymised aggregate product telemetry;
3. training data.

Each needs explicit governance.
