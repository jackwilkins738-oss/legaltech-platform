# V96 — Synthetic regression certification for tenant configuration

V96 binds an exact V94 tenant configuration bundle hash to an exact synthetic scenario-suite hash and a successful bounded runner result. A failed or unavailable suite cannot create certification evidence. Certification stores only counts, hashes and runner version; scenario payloads are not persisted.

V94 activation now requires an injected certification authority. Production is expected to use V95 isolated synthetic simulation (or an equivalently controlled runner) and durable V96 certification evidence before V83 change approval can be consumed.

This is release safety, not legal validation: passing synthetic scenarios proves expected software behavior for those scenarios only.
