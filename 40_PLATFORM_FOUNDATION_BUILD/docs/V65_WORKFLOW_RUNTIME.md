# V65 — Versioned Workflow Runtime, Feature Flags and Notification Intents

V65 provides a bounded runtime that can turn post-TO workflow definitions into executable internal orchestration without granting the workflow engine direct Graph or Proclaim write authority.

Definitions are versioned and validated as finite acyclic graphs. Supported generic steps are `CREATE_WORK`, `WAIT_FOR_SIGNAL`, `DELAY`, `BRANCH`, `NOTIFY` and `COMPLETE`. Published definitions are pinned by version/hash for every running instance. Existing instances therefore cannot silently change when a new workflow version is published.

The runtime is bounded by per-tick and per-instance step limits. Signals and workflow starts are idempotent. Delays require explicit resumption after their wake time. `CREATE_WORK` calls the V64 orchestration boundary; notification steps create deduplicated notification intents only. They do not perform external sends.

Feature flags support tenant-level enablement and deterministic percentage rollout for pilot cohorts. Notification intents support in-app and Teams delivery surfaces, bounded retries and deduplication, while leaving actual connector delivery outside this runtime.

TO evidence must still define the workflows. V65 only makes those later decisions fast to configure, version, pilot and roll back.
