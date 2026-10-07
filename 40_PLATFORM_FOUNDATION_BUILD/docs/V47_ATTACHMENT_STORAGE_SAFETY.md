# V47 combined attachment and storage safety batch

Defect-only work on the existing synthetic attachment pipeline, based on V46.
D-018, human review and production/live connector evidence gates remain intact.

## Reproduced behavior and fixes

1. Existing hash-named objects could contain different bytes: get returned corrupt
   content and put reused it, allowing acceptance of an attachment that was never
   correctly stored. Reads and deduplication now check SHA-256 against the canonical
   reference. Corruption fails closed with a bounded storage error; existing files
   are preserved rather than silently overwritten. New files use exclusive create.
2. References with extra segments or coercible objects could read an existing
   object. References now require an exact owned tenant/lowercase-hash string.
   Missing/cross-tenant/malformed references return null. Tenant identifiers require
   the storage's explicit string namespace. Tenant/object/metadata links and
   nonregular object paths are rejected before use. The explicitly configured root
   is resolved once and can intentionally be a link.
3. Filename aliases such as payload.exe. and task.cmd followed by spaces passed
   the existing blocked-extension rule. The safety check tests the suffix after
   trailing dots/spaces; colon/path aliases are quarantined. Recorded names and
   fingerprints are preserved. No additional file types or legal rules are added.
4. Processing relied only on an old SAFE_FOR_PARSER label, so a missing or corrupt
   object could still lead to READY_FOR_APPROVAL. Before classification and again
   before committing its result, the worker verifies owned stored bytes and reruns
   the basic file check. Missing, invalid or changed evidence produces the existing
   bounded INBOUND_PROCESSING_FAILED retry path, with no completion audit/review
   creation/approvable transition. Quarantined attachments keep their existing
   FILE_SAFETY review path and are never loaded into the parser/classifier.

## Limits, compatibility and recovery

The object-store byte ceiling now matches the existing 15 MiB attachment check.
Oversize stored files are rejected from their size before a content read; exact
limit and empty files remain valid. Serialization of new metadata happens before
file creation; existing metadata is retained on deduplication.

Valid historical references keep their format; no schema migration, data reset,
new dependency or automatic repair. Original bytes can be restored by an authorized
operator, then the existing processing/recovery flow retried. Same-key acceptance
still replays its original event; it does not rewrite lost files. Pending historical
records with an unsafe legacy safety label fail closed rather than silently change
policy. Already processed/reviewed events are not retroactively reclassified.

Filesystem and SQLite are not one atomic transaction: storage failures roll back
acceptance rows/jobs/cache/audit, but an earlier unreferenced file can remain if a
later file or database write fails. Link checks and exclusive creation reject
observed redirects/overwrites; they do not claim isolation from a hostile process
concurrently replacing directories. Protect the configured root with OS permissions.
Hash equality proves reference integrity, not malware safety. The basic magic and
extension checks remain a synthetic spike, not a production scanner or parser.

## Evidence and delivery

47 new tests cover corruption/read/deduplication, exact reference ownership/types,
linked directories/blobs/metadata, blocked aliases, processing-time loss/change,
transaction rollback, restoration/retry, zero-length/exact-limit files, oversize
bounds, storage restart and quarantine review. Platform: 293/293; earlier Node
suites, inventory/security checks and catalog/lint also pass. Links are exercised
on Linux; Windows tests explicitly skip a link fixture if the OS disallows creating
it. This is visible in test output, not a claim of Windows link proof.

The repeat-safe installer requires V46 app version 0.10.1 and a matching clean
source patch. It optionally commits/pushes feat/attachment-storage-safety-v47,
without resetting, force-pushing or merging. LF/Windows checkout-ending fixtures
validate application, scoped publication and repeats using local bare remotes.
Native PowerShell/Windows and GitHub CI still need user execution. Human security
review is required before merge; rollback uses a reviewed Git revert and does not
reset SQLite or erase stored objects.
