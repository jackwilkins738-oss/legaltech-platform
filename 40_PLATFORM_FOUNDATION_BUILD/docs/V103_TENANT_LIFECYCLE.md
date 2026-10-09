# V103 Tenant lifecycle and offboarding safety

V103 adds a workflow-agnostic tenant lifecycle: PROVISIONING, ACTIVE, SUSPENDED, OFFBOARDING and OFFBOARDED. Suspension/offboarding fail closed for new ingress/background/side-effect work while preserving bounded read/support during transition and audit/recovery evidence. Completion of offboarding requires external export/retention readiness evidence. No retention period, deletion worker or customer-specific offboarding rule is introduced.
