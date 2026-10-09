# V102 graceful deployment drain

V102 supplies a reference drain controller for safe deployments and maintenance. Starting a drain immediately refuses new ingress, background and side-effect leases while allowing already-held leases to finish. Readiness is unhealthy throughout DRAINING/DRAINED so load balancers can remove the instance/fleet. Production requires managed shared drain state; the in-memory controller is reference/test-only.
