# V114 Clock integrity

V114 introduces a reference trusted-time monitor. A verified external sample establishes security time; subsequent time advances from a monotonic source. Excessive skew, stale evidence, trusted-source rollback or monotonic rollback fail closed and can participate in readiness.
