# V62 production monitoring contract

The production-shaped scaffold now requires managed monitoring and a managed security-alert sink. New audit rows are chained by a server-side PostgreSQL trigger, and `security_alerts` is tenant-scoped, RLS-protected and append-only. Real-client-data mode remains blocked until reviewed monitoring/detection/retention evidence is PASS.

This migration is a contract/reference shape. It does not claim a deployed SIEM, SOC, WORM archive or customer production environment.
