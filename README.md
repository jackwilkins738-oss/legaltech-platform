# LegalTech Master Repository

Consolidated research, validation, architecture and pre-build repository for the UK legal-operations / Proclaim modernisation project.

## Start here
### Before / during the Time-and-Motion study
Read `33_PRE_TO_FINAL_AUDIT_AND_LOCK/00_PRE_TO_COMMAND_CENTRE.md` first.
Use only `25_TO_DAY0_OPERATING_KIT/LegalTech_TO_Day0_Execution_Workbook.xlsx` as the active TO workbook.

### Engineering
Then read `CLAUDE.md` and the task-relevant authoritative files.

## Important
- The first wedge is still a hypothesis until evidence lands.
- The repository does not claim ISO certification or regulatory compliance.
- Security requirements are design/control targets until implementation/testing evidence exists.
- Pre-TO application engineering is now frozen except for defects that would block the TO/evidence workflow.

## Current direction
High-volume PI → measure actual operational work → select evidence-backed wedge → augment Proclaim safely → paid narrow pilot → expand only after measured value.


## Claude knowledge navigation
For Claude Code, start from root `CLAUDE.md`. For Claude Project Knowledge, use `36_CLAUDE_KNOWLEDGE_ARCHITECTURE/06_CLAUDE_PROJECT_INSTRUCTIONS.md` as project instructions. Do not treat retrieval rank or filenames such as FINAL/MASTER as authority; route through the knowledge architecture.

## Canonical GitHub workflow
The repository is now GitHub-ready. Use one permanent local folder and run `CONNECT_GITHUB.ps1` once to create/connect the private canonical repository. After that, stop creating versioned local copies: work through Git branches/PRs and use GitHub Actions as the merge gate. See `GITHUB_SETUP.md`.
