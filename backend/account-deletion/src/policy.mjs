export const PROJECT_ID = 'nye-restroom';
export const ALLOWED_ORIGIN = 'https://nyc.imfinethanku.me';
export const REAUTH_SECONDS = 300;
export const LEASE_MS = 90_000;
export const COMPLETED_RETENTION_MS = 2 * 60 * 60 * 1000;
export const DELETION_POLICY_VERSION = 5;

export class ServiceError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export const safeSegment = (value, max = 128) => typeof value === 'string'
  && value.length > 0 && value.length <= max && !/[\/\x00-\x1f\x7f]/u.test(value)
  && value !== '.' && value !== '..';

export function requestToken(headers) {
  if (headers.origin !== undefined && headers.origin !== ALLOWED_ORIGIN) {
    throw new ServiceError(403, 'origin_not_allowed');
  }
  const authorization = headers.authorization;
  if (typeof authorization !== 'string' || authorization.length > 8192
      || !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(authorization)) {
    throw new ServiceError(401, 'authentication_required');
  }
  return authorization.slice(7);
}

export function validateBody(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 0) throw new ServiceError(400, 'invalid_request');
}

export function validateClaims(claims, now = Date.now()) {
  const provider = claims?.firebase?.sign_in_provider;
  const seconds = Math.floor(now / 1000);
  if (!safeSegment(claims?.uid) || claims.sub !== claims.uid
      || !['google.com', 'apple.com'].includes(provider)) {
    throw new ServiceError(401, 'authentication_required');
  }
  if (!Number.isInteger(claims.auth_time) || claims.auth_time <= 0 || claims.auth_time > seconds) {
    throw new ServiceError(401, 'recent_sign_in_required');
  }
  return { uid: claims.uid, provider, authTime: claims.auth_time };
}

export function requireRecentSession(session, now) {
  const seconds = Math.floor(now / 1000);
  if (!Number.isInteger(session.authTime) || session.authTime <= 0 || session.authTime > seconds
      || seconds - session.authTime > REAUTH_SECONDS) {
    throw new ServiceError(401, 'recent_sign_in_required');
  }
}

export const sameSession = (receipt, session) => session.authTime >= receipt.sessionAuthTime
  && receipt.provider === session.provider;

export function deletionPolicyVersion(receipt) {
  // Untagged receipts were created by the original destructive cleanup policy.
  const version = receipt?.policyVersion === undefined ? 1 : receipt.policyVersion;
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== DELETION_POLICY_VERSION) {
    throw new ServiceError(503, 'deletion_unavailable');
  }
  return version;
}

export function validateReceipt(receipt) {
  if (!receipt || !['pending', 'data-deleted', 'completed'].includes(receipt.phase)
      || !Number.isInteger(receipt.sessionAuthTime)
      || receipt.sessionAuthTime <= 0
      || !['google.com', 'apple.com'].includes(receipt.provider)) {
    throw new ServiceError(503, 'deletion_unavailable');
  }
  deletionPolicyVersion(receipt);
}

export function checkLease(receipt, lease, now) {
  validateReceipt(receipt);
  if (receipt.phase === 'completed' || receipt.leaseOwner !== lease.owner
      || typeof receipt.leaseExpiresAt?.toMillis !== 'function'
      || receipt.leaseExpiresAt.toMillis() <= now) {
    throw new ServiceError(409, 'deletion_in_progress');
  }
}

export function responseFor(error) {
  if (error instanceof ServiceError) return { status: error.status, body: { error: error.code } };
  return { status: 503, body: { error: 'deletion_unavailable' } };
}

export const validStars = stars => Number.isFinite(stars) && stars >= 1 && stars <= 5
  && Number.isInteger(stars * 2);
export const timestamp = value => value && typeof value.toMillis === 'function'
  && typeof value.isEqual === 'function';
export const sameTimestamp = (left, right) => Boolean(timestamp(left) && timestamp(right) && left.isEqual(right));
export const validVote = value => value && Object.keys(value).length === 2
  && validStars(value.stars) && timestamp(value.updatedAt);
