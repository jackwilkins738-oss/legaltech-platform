# SECURITY RELEASE GATES

## Block release if any
- known cross-tenant data path;
- authorization test failure;
- secret committed to repo;
- unrestricted support/developer production access;
- hostile file reaches trusted parser without controls;
- AI can access unauthorized matter content;
- privileged workflow action lacks audit;
- unknown Proclaim write can duplicate silently;
- critical dependency vulnerability without accepted mitigation.

## V1 pilot minimum
- MFA/SSO appropriate to pilot;
- tenant isolation tests;
- server-side authz;
- encryption in transit/at rest through platform controls;
- secrets manager;
- audit for material actions;
- backups + restore test;
- incident contact/process;
- vulnerability scanning;
- logging/alerting;
- file quarantine;
- scoped Graph permission.

## Human review required
Claude cannot approve security exceptions.
All accepted risks are recorded with owner/expiry.
