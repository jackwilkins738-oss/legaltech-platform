# Claude knowledge architecture

This layer turns a large repository into a routed, authority-aware knowledge system for Claude Code and Claude Projects.

## Human entrypoint
1. `06_CLAUDE_PROJECT_INSTRUCTIONS.md` — paste into Claude Project Instructions if using Claude.ai Projects.
2. Root `CLAUDE.md` — automatic operating instructions for Claude Code.
3. `03_TASK_ROUTER.md` — domain routing map.
4. `AUTHORITATIVE_FILES.json` — curated current authority.
5. `SUPERSESSION_REGISTRY.json` — known old→new mappings.
6. `FILE_CATALOG.csv` — machine/search catalog; do not preload into context.

## Design principles
- progressive disclosure;
- authority separate from retrieval relevance;
- current state/decisions above historical analysis;
- path-scoped rules rather than an enormous root prompt;
- explicit supersession rather than filename folklore;
- machine-checkable navigation.
