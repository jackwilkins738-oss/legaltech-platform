# DOCUMENTATION / CHANGELOG STANDARD

## Documentation classes
- user guide;
- admin;
- API;
- security;
- integration;
- release notes;
- operational runbook;
- architecture/ADR.

## Every production feature
Must update:
- user/admin docs if behaviour changes;
- API/schema docs if interface changes;
- security/privacy docs if processing changes;
- runbook if operational impact.

## Release notes
Include:
- date/version;
- new;
- changed;
- fixed;
- deprecated;
- security note where appropriate.

Do not expose exploit detail in public security note before remediation coordination.

## Source of truth
Docs live version-controlled with product where possible.

## Staleness
Every policy/runbook has:
- owner;
- last reviewed;
- next review/event trigger.
