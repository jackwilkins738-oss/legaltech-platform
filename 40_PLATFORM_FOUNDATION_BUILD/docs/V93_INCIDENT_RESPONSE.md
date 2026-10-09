# V93 — Incident response evidence and containment lifecycle

V93 adds a generic tenant-scoped incident authority around the existing V82 emergency interlocks. Incidents record bounded severity/category/reason metadata and hash references to source/evidence material; raw client, log or forensic payloads do not belong in the incident registry.

Containment uses the existing fail-closed security interlock controls. Recovery records hash-bound evidence and closure requires a different actor from the opener plus all tenant interlocks released. Evidence and incident events are append-only in the production shape.

This is a platform control plane, not a replacement for a managed SIEM/SOAR, forensic repository, incident communications process or external counsel/regulatory procedure. Those remain external operational dependencies.
