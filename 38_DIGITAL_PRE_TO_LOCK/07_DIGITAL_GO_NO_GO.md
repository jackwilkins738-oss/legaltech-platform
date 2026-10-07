# Digital GO / NO-GO

STATUS: CURRENT
AUTHORITY: HIGH

## GO when
- authoritative repo/workbooks are confirmed;
- knowledge lint passes;
- secret scan passes;
- current reference/security/dev-control tests pass;
- live-capture workbook is available;
- raw-evidence storage path exists;
- Claude strategy-change gate is active;
- no real customer secrets/data are in repo/knowledge.

## NO-GO when
- old workbook is being used as active source;
- product hypotheses are visible to/priming the live observer where avoidable;
- real secrets are committed;
- raw/cleaned data locations are mixed;
- Claude is allowed to update strategy from raw notes;
- observation timestamps/IDs cannot be reconstructed reliably.
