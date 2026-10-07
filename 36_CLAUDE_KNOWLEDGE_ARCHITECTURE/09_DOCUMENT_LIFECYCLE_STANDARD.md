# Document lifecycle standard

Every new enduring knowledge artifact should be classifiable by:
- domain;
- lifecycle (`current`, `frozen`, `provisional`, `reference`, `historical`, `superseded`);
- authority (`critical`, `high`, `medium`, `low`);
- evidence class where relevant;
- owner/source;
- review trigger rather than arbitrary review date where possible.

For the existing repository, these fields live in the central catalog/manifest to avoid rewriting hundreds of source files.

## Review triggers
Update current authority when:
- TO/customer evidence changes a thesis;
- a platform/API/law changes materially;
- a security/architecture decision is accepted;
- a pilot produces measured results;
- a current document is replaced.
