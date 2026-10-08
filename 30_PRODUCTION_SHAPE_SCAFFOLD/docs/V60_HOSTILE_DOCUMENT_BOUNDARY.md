# V60 hostile-document production boundary

Real-client-data mode now requires both `QUARANTINE_STORAGE_MODE=isolated` and `DOCUMENT_SECURITY_PIPELINE_STATUS=PASS` in addition to the existing managed malware-scan and isolated-parser gates.

These variables are fail-closed release interlocks only. They do not prove that quarantine storage, a scanner or an isolated parser actually exists. Reviewed operational evidence is still required before enabling real customer data.
