# Process-mining event-log specification

The TO should be designed so it can later be triangulated with system event data.

## Minimum event log
At minimum:
- `case_id` — pseudonymous process/matter identifier;
- `activity` — business-readable event;
- `timestamp`.

Useful additions:
- `event_id`;
- lifecycle (`start`, `complete`, `suspend`, etc.);
- role/resource;
- source system;
- case type/practice;
- matter stage;
- status/outcome;
- object type/id (email, document, task, expert instruction, offer);
- predecessor/related event where available.

## Sources to investigate
- Proclaim history;
- diary/task actions;
- audit/reporting data;
- Outlook/M365 message metadata;
- integration logs.

## Privacy
Prefer role/pseudonym over named employee where names are not needed. Do not export email bodies or privileged documents merely to obtain event metadata.

## Why this matters
System event traces can reveal:
- real process variants;
- loops/rework;
- sequence;
- queue delay;
- stage ageing;
- differences between documented and actual process.

TO observation and event-log analysis should triangulate each other.
