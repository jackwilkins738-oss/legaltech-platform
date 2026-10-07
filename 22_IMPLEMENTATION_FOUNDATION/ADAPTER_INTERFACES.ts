// Reference interfaces only. Production implementation must follow repository security and test gates.

export type HealthState = "HEALTHY" | "DEGRADED" | "DOWN";

export interface ProclaimAdapter {
  healthCheck(): Promise<{ state: HealthState; detail?: string }>;
  getMatterByExternalId(externalId: string): Promise<unknown | null>;
  searchMatters(query: Record<string, string>): Promise<unknown[]>;
  getHistory(externalMatterId: string): Promise<unknown[]>;
  createHistory(input: {
    externalMatterId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<{ externalWriteId: string; verified: boolean }>;
  uploadDocument(input: {
    externalMatterId: string;
    idempotencyKey: string;
    documentRef: string;
    metadata: Record<string, unknown>;
  }): Promise<{ externalWriteId: string; verified: boolean }>;
  fileEmail(input: {
    externalMatterId: string;
    idempotencyKey: string;
    communicationRef: string;
  }): Promise<{ externalWriteId: string; verified: boolean }>;
  createTask?(input: {
    externalMatterId: string;
    idempotencyKey: string;
    task: Record<string, unknown>;
  }): Promise<{ externalWriteId: string; verified: boolean }>;
  updateSafeFields?(input: {
    externalMatterId: string;
    idempotencyKey: string;
    fields: Record<string, unknown>;
  }): Promise<{ externalWriteId: string; verified: boolean }>;
}

export interface GraphMailAdapter {
  healthCheck(): Promise<{ state: HealthState; detail?: string }>;
  createSubscription(mailboxId: string): Promise<{ subscriptionId: string; expiresAt: string }>;
  renewSubscription(subscriptionId: string): Promise<{ expiresAt: string }>;
  getMessage(mailboxId: string, messageId: string): Promise<unknown>;
  getAttachments(mailboxId: string, messageId: string): Promise<unknown[]>;
  getDelta(mailboxId: string, cursor?: string): Promise<{ items: unknown[]; cursor: string }>;
  createDraft?(mailboxId: string, payload: Record<string, unknown>): Promise<{ draftId: string }>;
}
