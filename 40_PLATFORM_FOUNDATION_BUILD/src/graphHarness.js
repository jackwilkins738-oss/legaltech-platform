import crypto from 'node:crypto';
import {appError} from './errors.js';

const clone = (x) => structuredClone(x);
const invalid = () => appError('invalid integration request', {code: 'INVALID_REQUEST'});
const unavailable = () => appError('resource unavailable', {status: 404, code: 'NOT_FOUND'});
const conflict = () => appError('integration state does not permit this action', {status: 409, code: 'INVALID_INTEGRATION_STATE'});

function text(value, max = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid();
  return value;
}

// Synthetic reliability model only; these are not validated live Graph semantics.
export class MockGraphHarness {
  constructor({registry, tenantId = 'tenant-demo', maxDeliveryAttempts = 3, now = () => Date.now()} = {}) {
    if (!Number.isInteger(maxDeliveryAttempts) || maxDeliveryAttempts < 1 || maxDeliveryAttempts > 100) throw invalid();
    Object.assign(this, {registry, tenantId, maxDeliveryAttempts, now});
    this.subscriptions = new Map();
    this.delta = new Map();
    this.deliveries = new Map();
    this.deliveryFingerprints = new Map();
  }
  #timestamp() { return new Date(this.now()).toISOString(); }
  #requireMailbox(mailboxId) {
    text(mailboxId);
    const config = this.registry.get(this.tenantId, 'MICROSOFT_GRAPH');
    if (!config?.capabilities.includes('MAIL_READ') || !config.metadata.mailboxes.includes(mailboxId)) throw unavailable();
  }
  #subscription(id, {active = false} = {}) {
    text(id);
    const item = this.subscriptions.get(id);
    if (!item) throw unavailable();
    this.#requireMailbox(item.mailboxId);
    if (active && (item.status !== 'ACTIVE' || Date.parse(item.expiration) <= this.now())) throw conflict();
    return item;
  }
  #delivery(id) {
    text(id);
    const item = this.deliveries.get(id);
    if (!item) throw unavailable();
    this.#subscription(item.subscriptionId, {active: true});
    return item;
  }
  configure({mailboxes = ['shared-inbox@example.invalid'], reader = true, writer = false, sender = false} = {}) {
    if (!Array.isArray(mailboxes) || mailboxes.length > 100 || [reader, writer, sender].some(x => typeof x !== 'boolean')) throw invalid();
    mailboxes.forEach(x => text(x));
    const caps = [reader && 'MAIL_READ', writer && 'MAIL_WRITE', sender && 'MAIL_SEND'].filter(Boolean);
    return this.registry.upsert({tenantId: this.tenantId, kind: 'MICROSOFT_GRAPH', mode: 'MOCK', status: 'READY_FOR_VALIDATION', capabilities: caps, metadata: {mailboxes: [...new Set(mailboxes)], credentialMode: 'MOCK_CERT_REF', permissionModel: 'SEPARATED_IDENTITIES'}, health: {state: 'HEALTHY', lastCheck: this.#timestamp()}});
  }
  createMailboxSubscription(mailboxId, folder = 'Inbox') {
    this.#requireMailbox(mailboxId);
    text(folder, 128);
    const item = {id: `sub_${crypto.randomUUID()}`, tenantId: this.tenantId, mailboxId, folder, status: 'ACTIVE', expiration: new Date(this.now() + 55 * 60 * 1000).toISOString(), clientStateRef: 'secretref://mock/client-state', createdAt: this.#timestamp()};
    this.subscriptions.set(item.id, item);
    return clone(item);
  }
  renewSubscription(id) {
    const item = this.#subscription(id);
    // Renewal cannot silently restore removed subscriptions or revoked authorization.
    if (!['ACTIVE', 'MISSED'].includes(item.status)) throw conflict();
    item.expiration = new Date(this.now() + 55 * 60 * 1000).toISOString();
    item.status = 'ACTIVE';
    item.renewedAt = this.#timestamp();
    return clone(item);
  }
  lifecycle(id, status) {
    if (!['ACTIVE', 'MISSED', 'REMOVED', 'AUTHORIZATION_REQUIRED'].includes(status)) throw invalid();
    const item = this.#subscription(id);
    // Reauthorization/replacement must be explicit, not a lifecycle flag flip.
    if (status !== item.status && ['REMOVED', 'AUTHORIZATION_REQUIRED'].includes(item.status)) throw conflict();
    item.status = status;
    item.lifecycleAt = this.#timestamp();
    return clone(item);
  }
  setDelta(mailboxId, token) {
    this.#requireMailbox(mailboxId);
    text(token, 2048);
    this.delta.set(mailboxId, token);
    return {mailboxId, deltaCheckpoint: token, updatedAt: this.#timestamp()};
  }
  receiveNotification({subscriptionId, notificationId = null, resourceId = 'synthetic-resource', changeType = 'updated', clientStateValid = true} = {}) {
    const sub = this.#subscription(subscriptionId, {active: true});
    if (notificationId !== null) text(notificationId);
    text(resourceId);
    if (!['created', 'updated', 'deleted'].includes(changeType) || typeof clientStateValid !== 'boolean') throw invalid();
    // Do not suppress successive updates to one resource without an explicit synthetic identity.
    const fingerprint = notificationId === null ? null : crypto.createHash('sha256').update(JSON.stringify([this.tenantId, subscriptionId, notificationId, resourceId, changeType])).digest('hex');
    // Validate before consulting or changing accepted-delivery deduplication state.
    if (clientStateValid && fingerprint && this.deliveryFingerprints.has(fingerprint)) {
      const existing = this.deliveries.get(this.deliveryFingerprints.get(fingerprint));
      existing.duplicateCount += 1;
      existing.lastDuplicateAt = this.#timestamp();
      return {...clone(existing), duplicate: true};
    }
    const now = this.#timestamp();
    const item = {id: `del_${crypto.randomUUID()}`, tenantId: this.tenantId, subscriptionId, mailboxId: sub.mailboxId, notificationId, resourceId, changeType, fingerprint, status: clientStateValid ? 'ACCEPTED' : 'REJECTED_CLIENT_STATE', attempts: 0, totalAttempts: 0, recoveryCount: 0, duplicateCount: 0, receivedAt: now, updatedAt: now, lastError: null};
    this.deliveries.set(item.id, item);
    if (clientStateValid && fingerprint) this.deliveryFingerprints.set(fingerprint, item.id);
    return {...clone(item), duplicate: false};
  }
  failDelivery(id, error = 'synthetic delivery failure') {
    text(error, 240);
    const item = this.#delivery(id);
    if (item.status !== 'ACCEPTED') throw conflict();
    item.attempts += 1;
    item.totalAttempts += 1;
    // Do not retain arbitrary caller-supplied error text in connector snapshots.
    item.lastError = 'SYNTHETIC_DELIVERY_FAILURE';
    item.updatedAt = this.#timestamp();
    item.status = item.attempts >= this.maxDeliveryAttempts ? 'DEAD_LETTER' : 'RETRY_SCHEDULED';
    return clone(item);
  }
  retryDelivery(id) {
    const item = this.#delivery(id);
    if (!['RETRY_SCHEDULED', 'DEAD_LETTER'].includes(item.status)) throw conflict();
    if (item.status === 'DEAD_LETTER') {
      item.attempts = 0;
      item.recoveryCount += 1;
    }
    item.status = 'ACCEPTED';
    item.lastError = null;
    item.updatedAt = this.#timestamp();
    item.retriedAt = item.updatedAt;
    return clone(item);
  }
  #visibleSubscription(item) {
    const config = this.registry.get(this.tenantId, 'MICROSOFT_GRAPH');
    const status = !config?.capabilities.includes('MAIL_READ') || !config.metadata.mailboxes.includes(item.mailboxId) ? 'OUT_OF_SCOPE'
      : item.status === 'ACTIVE' && Date.parse(item.expiration) <= this.now() ? 'EXPIRED' : item.status;
    return {...clone(item), status};
  }
  healthCheck() {
    const all = [...this.subscriptions.values()].map(x => this.#visibleSubscription(x));
    const deliveries = [...this.deliveries.values()];
    const dead = deliveries.filter(x => x.status === 'DEAD_LETTER').length;
    const retry = deliveries.filter(x => x.status === 'RETRY_SCHEDULED').length;
    const rejected = deliveries.filter(x => x.status === 'REJECTED_CLIENT_STATE').length;
    const lifecycle = all.filter(x => x.status !== 'ACTIVE').length;
    return {state: dead || retry || lifecycle ? 'DEGRADED' : 'HEALTHY', mode: 'MOCK', subscriptions: all.filter(x => x.status === 'ACTIVE').length, totalSubscriptions: all.length, deltaCheckpoints: this.delta.size, deliveries: deliveries.length, retryScheduled: retry, deadLetters: dead, rejected, lifecycleAttention: lifecycle, lastCheck: this.#timestamp()};
  }
  snapshot() {
    return {subscriptions: [...this.subscriptions.values()].map(x => this.#visibleSubscription(x)), deltaCheckpoints: [...this.delta.entries()].map(([mailboxId, token]) => ({mailboxId, token})), deliveries: [...this.deliveries.values()].map(clone).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)), health: this.healthCheck()};
  }
}
