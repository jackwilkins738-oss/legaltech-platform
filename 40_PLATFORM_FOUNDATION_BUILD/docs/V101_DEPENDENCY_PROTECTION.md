# V101 dependency outage/backpressure containment

V101 adds tenant+dependency isolated circuit breaking, bounded concurrency, half-open probing and full-jitter retry calculation. A failure in one tenant or dependency does not consume another tenant/dependency circuit budget. Production requires circuit/concurrency state to be managed and shared across instances; the in-memory implementation is a reference/test boundary only.
