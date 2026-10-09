# V66 production-shape TO evidence

Migration `011_to_evidence.sql` adds tenant-scoped TO studies, observations and estimate evidence.

Production-shaped controls include forced RLS, tenant-composite study references, pseudonymous alias constraints, evidence-source/timing constraints, append-only observation and estimate rows, and an immutable locked-study boundary. Historical corrections are represented as new observations that supersede older evidence.

This schema is for de-identified process research. It is not a second matter database and deliberately has no link from a TO alias to a real client/matter record.
