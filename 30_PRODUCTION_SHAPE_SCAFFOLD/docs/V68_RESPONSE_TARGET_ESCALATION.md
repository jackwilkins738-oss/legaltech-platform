# V68 production-shape response targets and escalation intents

Migration `013_work_response_escalation.sql` adds tenant-scoped versioned response policies, deduplicated escalation intents and append-only escalation events.

Published policy definitions are immutable. Escalation intents bind to the exact source work and optional matter through tenant-composite foreign keys. Intent transitions are limited to OPEN -> ACKNOWLEDGED. The schema contains no automatic owner-update path.
