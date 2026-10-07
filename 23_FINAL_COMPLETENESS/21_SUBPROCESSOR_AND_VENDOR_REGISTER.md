# SUBPROCESSOR / VENDOR REGISTER

## Fields
- vendor;
- service;
- owner;
- tier;
- data categories;
- special-category?;
- customer data?;
- controller/processor role;
- region;
- transfer;
- contract/DPA;
- security evidence;
- incident terms;
- deletion;
- renewal;
- exit;
- concentration risk.

## Initial likely vendors
- cloud hosting;
- database;
- object storage;
- email/identity;
- OpenAI/other model provider;
- OCR;
- monitoring;
- error tracking;
- customer support;
- CRM;
- e-sign.

## Tier
Critical:
production/confidential customer data or auth.

High:
material business/system access.

Medium/Low:
limited/no customer content.

## Review
Critical annually and on material service/security change.

## Subprocessor change
Follow DPA notice/objection process.
Never add customer-data vendor informally because a developer wants a new API.
