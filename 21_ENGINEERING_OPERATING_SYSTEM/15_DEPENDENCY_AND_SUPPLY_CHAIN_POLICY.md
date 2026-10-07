# DEPENDENCY & SOFTWARE SUPPLY-CHAIN POLICY

## Before adding dependency
Ask:
- can standard library/current dependency do it?
- maintenance/activity?
- licence?
- vulnerability history?
- package provenance?
- transitive weight?

## CI
- lockfiles;
- dependency vulnerability scan;
- secret scan;
- licence/SBOM generation;
- reproducible build where practical.

## High-risk dependency categories
Human review required for:
- auth;
- crypto;
- file parsing;
- PDF/Office processing;
- database driver/ORM major upgrade;
- workflow sandbox;
- AI tool execution.

## Upgrade
Major version changes are explicit tasks, not incidental refactors.
