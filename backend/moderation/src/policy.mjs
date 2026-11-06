import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';

export const PROJECT_ID = 'nye-restroom';
export const ORIGIN = 'https://nyc.imfinethanku.me';
export const DENIAL_REASONS = new Set(['duplicate', 'insufficient_details', 'incorrect_location', 'restricted_access', 'other']);
export const REMOVAL_REASONS = new Set(['personal_information', 'harassment', 'spam', 'misleading', 'other']);
export const KINDS = {
  'public-note': { root: 'restroomPublicNotes', group: 'notes', receipts: 'restroomReadyPublicNoteReceipts', marker: 'publicNotes', text: 'body' },
  'unified-visit': { root: 'restroomUnifiedVisits', group: 'reports', receipts: 'restroomReadyUnifiedVisitReceipts', marker: 'unifiedVisits', text: 'comment' },
};
export class ModerationError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function requireValue(condition, status = 400, code = 'invalid_request') {
  if (!condition) throw new ModerationError(status, code);
}
export function exact(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)));
}
export const communityID = value => typeof value === 'string' && /^community-[A-Za-z0-9]{20}$/u.test(value);
export const recordID = value => typeof value === 'string' && /^[A-Za-z0-9]{20}$/u.test(value);
export const placeID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$/u.test(value)
  && (!value.startsWith('community-') || communityID(value));
export const uidSafe = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f/]/u.test(value);
export const actionID = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
export const timestamp = value => value instanceof Timestamp && Number.isFinite(value.toMillis());
export const sameTime = (a, b) => timestamp(a) && timestamp(b) && a.isEqual(b);
export const compareTime = (a, b) => a.seconds - b.seconds || a.nanoseconds - b.nanoseconds;
export const iso = value => timestamp(value) ? value.toDate().toISOString() : null;
export const revision = value => {
  requireValue(timestamp(value), 503, 'moderation_unavailable');
  return `${value.seconds}:${value.nanoseconds}`;
};
const safeText = (value, max, required = true) => typeof value === 'string' && value.length <= max
  && (!required || value.trim().length > 0) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(value);
export function validListing(value) {
  exact(value, ['name', 'address', 'latitude', 'longitude', 'locationType', 'entryRule', 'stepFreeAccess', 'passcodeRequired', 'notes', 'observedOn', 'submittedAt']);
  requireValue(safeText(value.name, 120) && safeText(value.address, 240) && safeText(value.notes, 1000, false)
    && typeof value.latitude === 'number' && Number.isFinite(value.latitude) && value.latitude >= 40.49 && value.latitude <= 40.93
    && typeof value.longitude === 'number' && Number.isFinite(value.longitude) && value.longitude >= -74.26 && value.longitude <= -73.68
    && ['park', 'library', 'cafe', 'restaurant', 'store', 'other'].includes(value.locationType)
    && ['public', 'customers', 'unknown'].includes(value.entryRule)
    && ['yes', 'no', 'unknown'].includes(value.stepFreeAccess)
    && ['yes', 'no', 'unknown'].includes(value.passcodeRequired)
    && timestamp(value.submittedAt) && value.submittedAt.toMillis() >= Date.UTC(2000, 0, 1)
    && (value.observedOn === null || timestamp(value.observedOn)
      && value.observedOn.toMillis() >= Date.UTC(2000, 0, 1)
      && value.observedOn.nanoseconds === 0 && value.observedOn.seconds % 86400 === 0
      && compareTime(value.observedOn, value.submittedAt) <= 0));
  return value;
}
export function validCodeDraft(value) {
  if (value === null) return null;
  exact(value, ['code', 'visibility']);
  requireValue(typeof value.code === 'string' && value.code.length > 0 && value.code.length <= 40
    && value.code.trim() === value.code && !/[^\x20-\x7e]/u.test(value.code)
    && ['private', 'public'].includes(value.visibility));
  return value;
}
export function codeFingerprint(value) {
  if (value === null) return null;
  validCodeDraft(value);
  return createHash('sha256').update(`rr-request-code-v1\0${value.visibility}\0${value.code}`, 'utf8').digest('hex');
}
export function requestDTO(id, data) {
  requireValue(communityID(id), 503, 'moderation_unavailable');
  const pending = data?.status === 'pending';
  exact(data, pending
    ? ['schemaVersion', 'status', 'revision', 'submittedAt', 'listing', 'codeDraft']
    : ['schemaVersion', 'status', 'revision', 'submittedAt', 'listing', 'codeDraft', 'reviewedAt', 'reason', 'codeFingerprint']);
  requireValue(data.schemaVersion === 1 && ['pending', 'approved', 'denied'].includes(data.status)
    && data.revision === (pending ? 1 : 2) && sameTime(data.submittedAt, data.listing?.submittedAt), 503, 'moderation_unavailable');
  validListing(data.listing);
  if (pending) validCodeDraft(data.codeDraft);
  else requireValue(data.codeDraft === null && timestamp(data.reviewedAt) && compareTime(data.reviewedAt, data.submittedAt) >= 0
    && (data.codeFingerprint === null || typeof data.codeFingerprint === 'string' && /^[a-f0-9]{64}$/u.test(data.codeFingerprint))
    && (data.status === 'approved' ? data.reason === '' : DENIAL_REASONS.has(data.reason)), 503, 'moderation_unavailable');
  const v = data.listing;
  // Construct every public-shaped field explicitly. Never spread a private request.
  return { id, status: data.status, revision: data.revision, submittedAt: iso(data.submittedAt),
    reviewedAt: pending ? null : iso(data.reviewedAt), reason: pending ? null : data.reason,
    hasCodeDraft: pending ? data.codeDraft !== null : data.codeFingerprint !== null,
    listing: { name: v.name, address: v.address, latitude: v.latitude, longitude: v.longitude,
      locationType: v.locationType, entryRule: v.entryRule, stepFreeAccess: v.stepFreeAccess,
      passcodeRequired: v.passcodeRequired, notes: v.notes, observedOn: iso(v.observedOn), submittedAt: iso(v.submittedAt) } };
}
export function validateDecision(value) {
  exact(value, ['decision', 'revision', 'reason', 'actionId']);
  requireValue(['approve', 'deny'].includes(value.decision) && Number.isSafeInteger(value.revision) && value.revision > 0
    && actionID(value.actionId) && (value.decision === 'approve' ? value.reason === '' : DENIAL_REASONS.has(value.reason)));
  return value;
}
export function validateRemoval(value) {
  exact(value, ['revision', 'reason', 'actionId']);
  requireValue(typeof value.revision === 'string' && /^-?\d{1,12}:\d{1,9}$/u.test(value.revision)
    && REMOVAL_REASONS.has(value.reason) && actionID(value.actionId));
  return value;
}
export function structuredKeys(kind) {
  return kind === 'public-note' ? ['condition', 'soap', 'toiletPaper', 'stairs']
    : ['entryRule', 'purchaseRequired', 'codeRequired', 'stairs', 'soap', 'toiletPaper', 'floor', 'condition', 'elevatorPresent', 'automaticDoorPresent'];
}
export function hasStructuredFacts(kind, data) {
  return structuredKeys(kind).some(key => {
    const allowed = key === 'condition' ? ['usable', 'needs-attention']
      : key === 'entryRule' ? ['public', 'customers'] : key === 'floor' ? ['entrance', 'below', 'above'] : ['yes', 'no'];
    return allowed.includes(data[key]);
  });
}
export function commentDTO(kind, snapshot, venueName = 'Restroom', allowEmptyText = false) {
  const config = KINDS[kind];
  if (!config) return null;
  const parts = snapshot.ref.path.split('/');
  if (parts.length !== 4 || parts[0] !== config.root || parts[2] !== config.group || !placeID(parts[1]) || !recordID(parts[3])) return null;
  const d = snapshot.data();
  if (!d || d.schemaVersion !== 1 || d.placeID !== parts[1] || !timestamp(d.submittedAt) || !timestamp(d.observedAt)
    || compareTime(d.observedAt, d.submittedAt) > 0 || !safeText(d[config.text], 1000, !allowEmptyText) || !timestamp(snapshot.updateTime)) return null;
  const common = ['schemaVersion', 'placeID', 'observedAt', 'submittedAt', 'condition', 'soap', 'toiletPaper', 'stairs'];
  const required = kind === 'public-note' ? [...common, 'body']
    : [...common, 'entryRule', 'purchaseRequired', 'codeRequired', 'floor', 'comment', 'anonymous', 'authorName'];
  const optional = kind === 'public-note' ? [] : ['elevatorPresent', 'automaticDoorPresent'];
  if (!required.every(k => Object.hasOwn(d, k)) || Object.keys(d).some(k => !required.includes(k) && !optional.includes(k))
    || !['not-reported', 'usable', 'needs-attention'].includes(d.condition)
    || ['soap', 'toiletPaper', 'stairs'].some(k => !['not-reported', 'yes', 'no'].includes(d[k]))) return null;
  if (kind === 'unified-visit' && (!['not-reported', 'public', 'customers'].includes(d.entryRule)
    || !['not-reported', 'entrance', 'below', 'above'].includes(d.floor)
    || ['purchaseRequired', 'codeRequired', ...optional.filter(k => Object.hasOwn(d, k))].some(k => !['not-reported', 'yes', 'no'].includes(d[k]))
    || typeof d.anonymous !== 'boolean' || (d.anonymous ? d.authorName !== null : !safeText(d.authorName, 120)))) return null;
  const authorLabel = kind === 'unified-visit' && d.anonymous === false && safeText(d.authorName, 120) ? d.authorName : 'Anonymous';
  return { kind, id: parts[3], placeID: parts[1], venueName, text: d[config.text], authorLabel,
    submittedAt: iso(d.submittedAt), observedAt: iso(d.observedAt), revision: revision(snapshot.updateTime) };
}
