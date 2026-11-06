import { authenticate } from './auth.mjs';
import { cleanupAccount } from './cleanup.mjs';
import { DeletionLease } from './lease.mjs';
import { ServiceError, safeSegment, timestamp, validateReceipt } from './policy.mjs';

export function createDeletionService({ auth, db, now = Date.now, leaseMs, cleanup = cleanupAccount, checkpoint = async () => {} }) {
  const inFlight = new Map();
  async function deleteSession(session) {
    const lease = new DeletionLease(db, session, { now, leaseMs });
    const phase = await lease.acquire();
    if (phase === 'completed') return { status: 'deleted' };
    const stopHeartbeat = lease.startHeartbeat();
    try {
      if (phase === 'pending') {
        await cleanup(db, session.uid, lease, { checkpoint });
        await lease.markDataDeleted();
      }
      await checkpoint('before-auth-delete');
      // Recheck the fenced lease immediately before the irreversible Auth step.
      await db.runTransaction(async transaction => { await lease.check(transaction); });
      try { await auth.deleteUser(session.uid); }
      catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
      await checkpoint('after-auth-delete');
      await lease.complete();
      return { status: 'deleted' };
    } finally {
      await stopHeartbeat();
      await lease.release();
    }
  }
  async function join(session) {
    const key = `${session.uid}\0${session.authTime}\0${session.provider}`;
    // HTTP disconnect does not cancel the job; a same-session retry joins its result.
    const existing = inFlight.get(key);
    if (existing) return existing;
    const pending = deleteSession(session);
    inFlight.set(key, pending);
    try { return await pending; }
    finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  }
  const deletion = async token => join(await authenticate(auth, token, now()));
  // This entry point is never exposed over HTTP. The trusted Admin-only marker is the authorization.
  deletion.resume = async snapshot => {
    if (snapshot.ref.parent.path !== 'accountDeletionLocks' || !safeSegment(snapshot.id)) throw new ServiceError(503, 'deletion_unavailable');
    const receipt = snapshot.data(); validateReceipt(receipt);
    if (!['pending', 'data-deleted'].includes(receipt.phase) || !timestamp(receipt.createdAt)
        || receipt.sessionAuthTime <= 0 || receipt.sessionAuthTime > Math.floor(now() / 1000)) {
      throw new ServiceError(503, 'deletion_unavailable');
    }
    return join({ uid: snapshot.id, provider: receipt.provider, authTime: receipt.sessionAuthTime,
      authMissing: false, recovery: true });
  };
  deletion.drain = async () => { await Promise.allSettled([...inFlight.values()]); };
  return deletion;
}
