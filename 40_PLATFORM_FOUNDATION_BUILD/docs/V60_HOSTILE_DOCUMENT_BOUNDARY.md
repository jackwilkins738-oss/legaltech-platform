# V60 — Hostile document containment boundary

## Scope
V60 hardens the attachment path against hostile or malformed documents without adding legal workflow scope, live customer content or production scanner credentials.

## Implemented
- Explicit MIME/signature checks for supported PDF, OOXML/ZIP, PNG, JPEG and text-family inputs when a concrete content type is supplied.
- Legacy compound Office containers and macro-enabled Office extensions are quarantined rather than parsed in the application process.
- ZIP central-directory inspection is bounded and does not decompress attacker-controlled data.
- Archive path traversal, symlink entries, encrypted archives, unsupported compression, nested archives, embedded VBA payloads, ZIP64 ambiguity and decompression-bomb metadata are quarantined.
- Accepted documents are labelled only `SCAN_REQUIRED`; basic ingestion never claims parser safety.
- Managed malware-scan results must be bound to the exact tenant-owned object reference, SHA-256 and size before parsing can proceed.
- Parser evidence must prove an isolated parser, exact scan binding and bounded extracted-output evidence.
- Scanner and parser adapter interfaces receive immutable descriptors only; raw attachment bytes are not passed across the adapter boundary.
- Production document mode fails closed before AI classification until clean isolated evidence is recorded.
- Infected or invalid document evidence routes to FILE_SAFETY review and cannot be approved into Proclaim.
- Real-client-data mode additionally requires isolated quarantine storage and reviewed document-security pipeline evidence.

## Deliberately not claimed
- No live antivirus/malware product is connected.
- No production parser/sandbox/container runtime is connected.
- No real quarantine bucket/account, CDR service or customer document has been used.
- Environment status values remain interlocks, not proof that external controls exist.

## Security invariants
1. File extension or declared MIME type never establishes trust on its own.
2. Archive safety inspection is metadata-bounded and never recursively expands hostile content in the privileged application process.
3. A scanner result for one object cannot authorize parsing or writeback for another object.
4. Parser execution must be represented as isolated evidence bound to the clean scan result.
5. Missing, infected, forged or non-isolated evidence cannot reach AI or Proclaim in production document mode.
