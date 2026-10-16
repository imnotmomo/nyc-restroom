import { values as waitlistValues } from './waitlist.mjs';

export const OUTBOX_TABLE = 'waitlist_confirmation_outbox';
export const CONFIRMATION_HOUR_MS = 3_600_000;
export const CONFIRMATION_LEASE_MS = 60_000;
export const CONFIRMATION_MAX_ATTEMPTS = 3;
const CONFIRMATION_QUOTA_PREDICATE = `? = 0 OR (
  (SELECT COUNT(*) FROM waitlist_confirmation_outbox WHERE created_at > ?) < 60
  AND (SELECT COUNT(*) FROM waitlist_confirmation_outbox WHERE client_key = ? AND created_at > ?) < 5
)`;

export const QUOTA_SQL = `SELECT CASE WHEN ${CONFIRMATION_QUOTA_PREDICATE} THEN 1 ELSE 0 END AS can_queue`;

export const INSERT_WAITLIST_SQL = `
  INSERT INTO waitlist (email, source, created_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
  SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${CONFIRMATION_QUOTA_PREDICATE}
  ON CONFLICT(email) DO NOTHING`;

// Keep this immediately after INSERT_WAITLIST_SQL in the same atomic batch.
// changes() belongs to that preceding insert, so duplicate and historical
// signups can never acquire a confirmation job on a later submission.
export const ENQUEUE_SQL = `
  INSERT INTO waitlist_confirmation_outbox
    (email, status, attempts, available_at, lease_token, lease_until, created_at, client_key, last_reason)
  SELECT ?, 'pending', 0, ?, NULL, NULL, ?, ?, 'queued'
  WHERE changes() = 1 AND ? = 1 AND ? <> ''
  ON CONFLICT(email) DO NOTHING`;

// A send may already have reached the provider before its process disappeared.
// Expired leases are held for operator review, never automatically replayed.
export const EXPIRE_SQL = `
  UPDATE waitlist_confirmation_outbox
  SET status = 'uncertain', lease_token = NULL, lease_until = NULL, last_reason = 'lease-expired'
  WHERE status = 'sending' AND lease_until <= ?`;

export const CLAIM_SQL = `
  UPDATE waitlist_confirmation_outbox
  SET status = 'sending', attempts = attempts + 1,
      lease_token = ?, lease_until = ?, last_reason = 'sending'
  WHERE email = (
    SELECT email FROM waitlist_confirmation_outbox
    WHERE status = 'pending' AND attempts < 3 AND available_at <= ?
    ORDER BY available_at, created_at, email LIMIT 1
  ) AND status = 'pending' AND attempts < 3 AND available_at <= ?
  RETURNING email, status, attempts, available_at, lease_token, lease_until, created_at, client_key, last_reason`;

export const COMPLETE_SQL = `
  UPDATE waitlist_confirmation_outbox
  SET status = ?, available_at = ?, lease_token = NULL, lease_until = NULL, last_reason = ?
  WHERE email = ? AND lease_token = ? AND status = 'sending'
    AND attempts = ? AND lease_until > ?`;

function confirmationNow(now) {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - CONFIRMATION_HOUR_MS) {
    throw new TypeError('Invalid confirmation time');
  }
  return now;
}

export function saveParameters(record, { enqueueConfirmation = false, clientKey = '', now = Date.now() } = {}) {
  const time = confirmationNow(now);
  // Only a server-produced SHA-256 key is persisted; raw addresses/IPs are not.
  const key = typeof clientKey === 'string' && /^[a-f0-9]{64}$/.test(clientKey) ? clientKey : '';
  const enqueue = enqueueConfirmation === true && key !== '' ? 1 : 0;
  const quota = [enqueue, time - CONFIRMATION_HOUR_MS, key, time - CONFIRMATION_HOUR_MS];
  return {
    quota,
    waitlist: [...waitlistValues(record), ...quota],
    outbox: [record.email, time, time, key, enqueue, key],
  };
}

export function claimParameters(now, token) {
  const time = confirmationNow(now);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    throw new TypeError('Invalid confirmation lease');
  }
  return { expire: [time], claim: [token, time + CONFIRMATION_LEASE_MS, time, time] };
}

const CONFIRMATION_SAFE_FAILURES = new Set([
  'invalid-config', 'invalid-recipient', 'invalid-request',
  'permanent-bounce', 'recipient-suppressed', 'not-configured',
]);
const CONFIRMATION_AMBIGUOUS_REASONS = new Set([
  'timeout', 'network', 'invalid-response', 'provider-unavailable',
]);

function completionState(job, result, now) {
  if (!result || typeof result !== 'object' || typeof result.ambiguous !== 'boolean') {
    return { status: 'uncertain', availableAt: now, reason: 'invalid-response' };
  }
  if (result.ambiguous) {
    return { status: 'uncertain', availableAt: now,
      reason: CONFIRMATION_AMBIGUOUS_REASONS.has(result.reason) ? result.reason : 'ambiguous' };
  }
  if (result.outcome === 'accepted') {
    return { status: 'accepted', availableAt: now,
      reason: ['delivered', 'queued'].includes(result.reason) ? result.reason : 'accepted' };
  }
  if (result.outcome === 'retry' && ['rate-limited', 'provider-unavailable'].includes(result.reason)) {
    if (job.attempts >= CONFIRMATION_MAX_ATTEMPTS) {
      return { status: 'failed', availableAt: now, reason: 'attempts-exhausted' };
    }
    return { status: 'pending', availableAt: now + (job.attempts === 1 ? 60_000 : 300_000), reason: result.reason };
  }
  if (result.outcome === 'failed' || result.outcome === 'unconfigured') {
    return { status: 'failed', availableAt: now,
      reason: result.outcome === 'unconfigured' ? 'not-configured'
        : CONFIRMATION_SAFE_FAILURES.has(result.reason) ? result.reason : 'permanent-failure' };
  }
  // Unknown results cannot establish that the provider rejected a message.
  return { status: 'uncertain', availableAt: now, reason: 'invalid-response' };
}

export function completionParameters(job, result, now = Date.now()) {
  const time = confirmationNow(now);
  if (!job || typeof job.email !== 'string' || typeof job.lease_token !== 'string'
    || !Number.isInteger(job.attempts) || job.attempts < 1 || job.attempts > CONFIRMATION_MAX_ATTEMPTS) {
    throw new TypeError('Invalid confirmation job');
  }
  const state = completionState(job, result, time);
  return [state.status, state.availableAt, state.reason, job.email, job.lease_token, job.attempts, time];
}

/**
 * DB must expose D1 prepare(sql).bind(...params) and atomic batch(statements).
 * Batch results contain meta.changes and, for RETURNING, a results array.
 * Signup saving never sends email; dispatch happens after durable commit.
 */
export function createD1ConfirmationStore(DB) {
  if (!DB || typeof DB.prepare !== 'function' || typeof DB.batch !== 'function') {
    throw new TypeError('A durable confirmation database is required');
  }
  return {
    async save(record, options = {}) {
      const parameters = saveParameters(record, options);
      const results = await DB.batch([
        DB.prepare(QUOTA_SQL).bind(...parameters.quota),
        DB.prepare(INSERT_WAITLIST_SQL).bind(...parameters.waitlist),
        DB.prepare(ENQUEUE_SQL).bind(...parameters.outbox),
      ]);
      // Apply the same limit even to duplicate requests, so this response cannot
      // disclose whether an address was already on the list. The conditional
      // insert made no changes when this atomic quota snapshot was exhausted.
      if (Number(results[0]?.results?.[0]?.can_queue) === 0) {
        const error = new Error('Too many signups. Please try again later.');
        error.code = 'WAITLIST_CONFIRMATION_RATE_LIMIT';
        throw error;
      }
      if (Number(results[0]?.results?.[0]?.can_queue) !== 1) throw new Error('Confirmation quota result unavailable');
      return { inserted: Number(results[1]?.meta?.changes) === 1, queued: Number(results[2]?.meta?.changes) === 1 };
    },
    async claim(now = Date.now()) {
      const parameters = claimParameters(now, crypto.randomUUID());
      const results = await DB.batch([
        DB.prepare(EXPIRE_SQL).bind(...parameters.expire),
        DB.prepare(CLAIM_SQL).bind(...parameters.claim),
      ]);
      return results[1]?.results?.[0] ?? null;
    },
    async complete(job, result, now = Date.now()) {
      const parameters = completionParameters(job, result, now);
      const results = await DB.batch([
        DB.prepare(EXPIRE_SQL).bind(confirmationNow(now)),
        DB.prepare(COMPLETE_SQL).bind(...parameters),
      ]);
      return Number(results[1]?.meta?.changes) === 1;
    },
  };
}
