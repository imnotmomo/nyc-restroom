import { randomUUID } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { COMPLETED_RETENTION_MS, DELETION_POLICY_VERSION, LEASE_MS, ServiceError, checkLease, deletionPolicyVersion, requireRecentSession, sameSession, timestamp, validateReceipt } from './policy.mjs';

export class DeletionLease {
  constructor(db, session, { now = Date.now, leaseMs = LEASE_MS } = {}) {
    this.db = db; this.session = session; this.now = now; this.leaseMs = leaseMs;
    this.owner = randomUUID();
    this.ref = db.collection('accountDeletionLocks').doc(session.uid);
    this.heartbeatFailure = null;
  }

  async acquire() {
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(this.ref);
      const receipt = snapshot.data();
      const now = this.now();
      if (snapshot.exists) {
        validateReceipt(receipt);
        if (this.session.authTime > receipt.sessionAuthTime) requireRecentSession(this.session, now);
        if (receipt.phase === 'completed') {
          if (!sameSession(receipt, this.session)) throw new ServiceError(401, 'recent_sign_in_required');
          if (!this.session.authMissing) throw new ServiceError(409, 'deletion_unavailable');
          return 'completed';
        }
        if (this.session.authMissing) {
          if (receipt.phase !== 'data-deleted' || !sameSession(receipt, this.session)) {
            throw new ServiceError(401, 'authentication_required');
          }
        } else if (this.session.authTime < receipt.sessionAuthTime) {
          throw new ServiceError(401, 'recent_sign_in_required');
        }
        if (typeof receipt.leaseExpiresAt?.toMillis !== 'function') throw new ServiceError(503, 'deletion_unavailable');
        if (receipt.leaseExpiresAt.toMillis() > now) throw new ServiceError(409, 'deletion_in_progress');
      } else {
        if (this.session.recovery) throw new ServiceError(503, 'deletion_unavailable');
        if (this.session.authMissing) throw new ServiceError(401, 'authentication_required');
        requireRecentSession(this.session, now);
      }
      transaction.set(this.ref, {
        phase: receipt?.phase ?? 'pending', sessionAuthTime: this.session.authTime,
        // Pending work adopts the current preservation and public-note cleanup policy.
        // Legacy data-deleted work must never replay cleanup or reconstruct old erasures.
        policyVersion: !receipt || receipt.phase === 'pending' ? DELETION_POLICY_VERSION : deletionPolicyVersion(receipt),
        provider: this.session.provider, leaseOwner: this.owner,
        leaseExpiresAt: Timestamp.fromMillis(now + this.leaseMs),
        updatedAt: FieldValue.serverTimestamp(),
        ...(!snapshot.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
      return receipt?.phase ?? 'pending';
    });
  }

  async check(transaction) {
    if (this.heartbeatFailure) throw this.heartbeatFailure;
    const snapshot = await transaction.get(this.ref);
    checkLease(snapshot.data(), this, this.now());
    return snapshot.data();
  }

  async renew() {
    await this.db.runTransaction(async transaction => {
      await this.check(transaction);
      transaction.update(this.ref, { leaseExpiresAt: Timestamp.fromMillis(this.now() + this.leaseMs), updatedAt: FieldValue.serverTimestamp() });
    });
  }

  startHeartbeat() {
    let pending = Promise.resolve();
    let running = false;
    const timer = setInterval(() => {
      if (running || this.heartbeatFailure) return;
      running = true;
      pending = this.renew().catch(error => { this.heartbeatFailure = error; }).finally(() => { running = false; });
    }, Math.max(10, Math.floor(this.leaseMs / 3)));
    timer.unref();
    return async () => { clearInterval(timer); await pending; };
  }

  async markDataDeleted() {
    await this.db.runTransaction(async transaction => {
      const receipt = await this.check(transaction);
      if (receipt.phase !== 'pending' || deletionPolicyVersion(receipt) !== DELETION_POLICY_VERSION) {
        throw new ServiceError(503, 'deletion_unavailable');
      }
      transaction.update(this.ref, { phase: 'data-deleted', updatedAt: FieldValue.serverTimestamp() });
    });
  }

  async complete() {
    await this.db.runTransaction(async transaction => {
      const receipt = await this.check(transaction);
      if (receipt.phase !== 'data-deleted') throw new ServiceError(503, 'deletion_unavailable');
      transaction.update(this.ref, {
        phase: 'completed', completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(this.now() + COMPLETED_RETENTION_MS),
        leaseOwner: FieldValue.delete(), leaseExpiresAt: FieldValue.delete(),
      });
    });
  }

  async release() {
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(this.ref);
      if (snapshot.exists && snapshot.data().leaseOwner === this.owner && snapshot.data().phase !== 'completed') {
        transaction.update(this.ref, { leaseExpiresAt: Timestamp.fromMillis(0), updatedAt: FieldValue.serverTimestamp() });
      }
    });
  }
}

// Retention cleanup is explicit and only considers completed receipts. Never set TTL on pending work.
export async function pruneCompletedReceipts(db, now = Date.now()) {
  const expired = await db.collection('accountDeletionLocks')
    .where('expiresAt', '<=', Timestamp.fromMillis(now)).limit(100).get();
  let removed = 0;
  for (const candidate of expired.docs) {
    const deleted = await db.runTransaction(async transaction => {
      const current = await transaction.get(candidate.ref);
      const receipt = current.data();
      // A newer policy may define different retention. Preserve its marker while
      // continuing to prune compatible legacy/current candidates.
      try { deletionPolicyVersion(receipt); }
      catch { return false; }
      if (receipt?.phase === 'completed' && timestamp(receipt.completedAt)
          && receipt.completedAt.toMillis() + COMPLETED_RETENTION_MS <= now
          && receipt.expiresAt?.toMillis() <= now) {
        transaction.delete(candidate.ref); return true;
      }
      return false;
    });
    if (deleted) removed++;
  }
  return removed;
}
