# FEATURE FLAGS & CONFIGURATION

## Use flags for
- new workflow;
- auto-action threshold;
- new model/provider;
- new connector behaviour;
- customer beta.

## Rules
- tenant-scoped where relevant;
- server-side evaluation for security-sensitive behaviour;
- owner;
- creation date;
- expiry/removal date;
- default safe/off for risky changes.

## Configuration
Customer config is versioned and auditable.

Do not hide permanent bespoke code behind endless flags.
Retire stale flags.
