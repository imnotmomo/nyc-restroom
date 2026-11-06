/** Offline evidence validation/projection. No credentials, SDK initialization or network access. */
import { createHash } from 'node:crypto';

export const PROJECT = 'nye-restroom';
export const DATABASE = '(default)';
export const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
export const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const sha = value => createHash('sha256').update(value).digest('hex');
export const id20 = value => sha(value).slice(0, 20);
export class ResearchError extends Error {}
export const check = (condition, message) => { if (!condition) throw new ResearchError(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const safeText = (value, max, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const publicText = (value, max, empty = false) => safeText(value, max, empty) && !/\p{Script=Han}/u.test(value);
const validID = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(value);
const evidenceTypes = new Set(['official-page', 'official-dataset', 'review', 'social-post', 'social-comment', 'inspection', 'news', 'directory', 'guide']);
const scopes = new Set(['restroom', 'venue', 'building', 'route']);
const fields = new Set(['restroomHours', 'venueHours', 'entranceLocation', 'entranceStepFree', 'stairFreeRoute',
  'elevatorToRestroom', 'elevatorNote', 'restroomFloor', 'stairsAfterEntry', 'entryRule', 'purchaseRequired', 'codeRequired',
  'passcode', 'condition', 'cleanliness', 'soap', 'toiletPaper', 'changingStations', 'restroomType', 'genderDesignation',
  'restroomLocation', 'buildingAccessibility', 'restroomAccessibility', 'closure', 'staffAssistance', 'inspectionDate', 'inspectionRating',
  'identity', 'venueLevel', 'hours', 'elevatorAccess', 'passcodeRequired', 'publishedStatus', 'seasonality', 'facilityAccessibility', 'accessNotes', 'sourceRating',
  'elevatorOutage', 'accessRestriction']);
const routeAnswers = new Set(['entranceStepFree', 'stairFreeRoute', 'elevatorToRestroom']);
const sidecarText = { restroomHours: 160, entranceLocation: 500, elevatorNote: 300, restroomFloor: 80 };

export function safeHTTPSURL(value) {
  if (!safeText(value, 4096) || !value.startsWith('https://') || /\s|\\/.test(value)) return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')
      && host.includes('.') && !/^[\d.]+$/.test(host) && !/[:\[\]]/.test(host)
      && !/(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
      && ![...url.searchParams.keys()].some(key => /(?:token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy)/i.test(key));
  } catch { return false; }
}
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01') return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validInstant(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value)
    && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
export function validateInventory(inventory) {
  check(object(inventory) && inventory.schemaVersion === 1 && Array.isArray(inventory.places) && inventory.places.length > 0,
    'Invalid current-map inventory.');
  const places = new Map();
  for (const place of inventory.places) {
    check(object(place) && validID(place.id) && !places.has(place.id) && safeText(place.name, 1000)
      && ['city', 'community'].includes(place.sourceKind), 'Invalid or duplicated exact map identity.');
    places.set(place.id, place);
  }
  return places;
}
export function validateFindings(findings, inventory, inventorySHA256) {
  const places = validateInventory(inventory);
  check(exact(findings, ['schemaVersion', 'batchID', 'inventorySHA256', 'entries']) && findings.schemaVersion === 1
    && /^research-map-\d{4}-\d{2}-\d{2}$/.test(findings.batchID) && validDate(findings.batchID.slice(13))
    && /^[a-f0-9]{64}$/.test(inventorySHA256) && findings.inventorySHA256 === inventorySHA256
    && Array.isArray(findings.entries) && findings.entries.length <= 20_000, 'Findings must bind the exact fresh inventory and dated batch.');
  const seen = new Set();
  return findings.entries.map(entry => {
    const keys = ['placeID', 'sourceURL', 'sourceTitle', 'retrievedAt', 'evidenceType', 'scope', 'identityEvidence',
      'publishedOn', 'originalTimestamp', 'dateEvidence', 'paraphrase', 'facts', 'limitations'];
    check(exact(entry, keys) && places.has(entry.placeID) && safeHTTPSURL(entry.sourceURL) && publicText(entry.sourceTitle, 300)
      && validInstant(entry.retrievedAt) && evidenceTypes.has(entry.evidenceType) && scopes.has(entry.scope)
      && safeText(entry.identityEvidence, 2000) && safeText(entry.dateEvidence, 2000) && publicText(entry.paraphrase, 1000)
      && publicText(entry.limitations, 3000) && Array.isArray(entry.facts) && entry.facts.length <= 50,
    'Invalid source evidence or unresolved exact place identity.');
    check(entry.publishedOn === null || validDate(entry.publishedOn) && entry.publishedOn <= entry.retrievedAt.slice(0, 10),
      'Publication date must be real and no later than retrieval.');
    check(entry.originalTimestamp === null || publicText(entry.originalTimestamp, 500), 'Invalid original displayed timestamp.');
    check(entry.publishedOn === null || entry.originalTimestamp !== null,
      'A dated publication requires its original displayed timestamp and date evidence; retrieval is not publication.');
    check(entry.publishedOn === null || new RegExp(`\\b${entry.publishedOn.slice(0, 4)}\\b`).test(entry.originalTimestamp),
      'Publication year must be explicit in the original source timestamp; do not invent it from retrieval or relative text.');
    // An inspection or dataset refresh date is not a publication date for an individual restroom.
    check(!['inspection', 'official-dataset'].includes(entry.evidenceType) || entry.publishedOn === null,
      'Inspection/dataset dates must remain separately labeled, not individual publication dates.');
    const facts = entry.facts.map(fact => {
      check(object(fact) && Object.keys(fact).every(key => ['field', 'value', 'evidence', 'scope', 'sourceURL'].includes(key))
        && ['field', 'value', 'evidence'].every(key => Object.hasOwn(fact, key)) && fields.has(fact.field)
        && (typeof fact.value === 'string' && publicText(fact.value, 2000) || typeof fact.value === 'number' && Number.isFinite(fact.value)
          || typeof fact.value === 'boolean') && publicText(fact.evidence, 2000)
        && (!Object.hasOwn(fact, 'scope') || scopes.has(fact.scope))
        && (!Object.hasOwn(fact, 'sourceURL') || safeHTTPSURL(fact.sourceURL)), 'Invalid fact-level evidence.');
      if (fact.field === 'passcode') check(typeof fact.value === 'string' && fact.value === fact.value.trim()
        && fact.value.length > 0 && fact.value.length <= 40 && !/[^\x20-\x7e]/.test(fact.value), 'Invalid source code evidence.');
      if (fact.field === 'sourceRating') check(typeof fact.value === 'string' && ['venue', 'restroom'].includes(fact.scope),
        'A source score must retain its displayed text and explicit venue/restroom scope, never an app vote.');
      return { ...fact, scope: fact.scope ?? entry.scope, sourceURL: fact.sourceURL ?? entry.sourceURL };
    });
    const normalized = { ...entry, facts }, id = id20(stable(normalized));
    check(!seen.has(id), 'Duplicate evidence entry; deduplicate before publication.'); seen.add(id);
    return { id, ...normalized };
  });
}

/** Every exact map place is represented, including places that have not yet been researched. */
export function coverageLedger(inventory, entries, auditedPlaceIDs = []) {
  const places = validateInventory(inventory), audited = new Set(auditedPlaceIDs);
  check(audited.size === auditedPlaceIDs.length && [...audited].every(id => places.has(id)), 'Invalid coverage audit identities.');
  return [...places.values()].map(place => {
    const matched = entries.filter(entry => entry.placeID === place.id);
    const hasAdditionalEvidence = matched.some(entry => entry.evidenceType !== 'official-dataset'
      || entry.facts.some(fact => fact.field === 'inspectionDate'));
    return { placeID: place.id, name: place.name, sourceKind: place.sourceKind,
      status: hasAdditionalEvidence ? 'reviewed-with-findings' : matched.length ? 'official-record-rechecked'
        : audited.has(place.id) ? 'source-checked-no-new-facts' : 'pending',
      evidenceIDs: matched.map(entry => entry.id), sourceURLs: [...new Set(matched.flatMap(entry => [entry.sourceURL, ...entry.facts.map(fact => fact.sourceURL)]))] };
  });
}

function accessProjection(entry, reviewedAt, omissions) {
  const payload = { schemaVersion: 1, placeID: entry.placeID, restroomHours: null, entranceLocation: null,
    entranceStepFree: 'unknown', stairFreeRoute: 'unknown', elevatorToRestroom: 'unknown', elevatorNote: null,
    restroomFloor: null, stairsAfterEntry: null };
  let count = 0;
  for (const fact of entry.facts) {
    if (!['restroom', 'route'].includes(fact.scope) || fact.sourceURL !== entry.sourceURL) continue;
    if (Object.hasOwn(sidecarText, fact.field)) {
      if (typeof fact.value !== 'string' || fact.value.length > sidecarText[fact.field]
        || /[\u0000-\u001f\u007f-\u009f]/.test(fact.value)) {
        omissions.push({ entryID: entry.id, field: fact.field, reason: 'preserved-in-source-note; exceeds-installed-access-schema' }); continue;
      }
      check(payload[fact.field] === null || payload[fact.field] === fact.value, 'Conflicting same-source access facts.');
      payload[fact.field] = fact.value; count++;
    } else if (routeAnswers.has(fact.field)) {
      check(['yes', 'no', 'unknown'].includes(fact.value), 'Access answers must be explicit yes/no/unknown.');
      check(payload[fact.field] === 'unknown' || payload[fact.field] === fact.value, 'Conflicting access answers.');
      payload[fact.field] = fact.value; count++;
    } else if (fact.field === 'stairsAfterEntry') {
      check(Number.isInteger(fact.value) && fact.value >= 0 && fact.value <= 200, 'Stairs require an explicit bounded integer.');
      check(payload.stairsAfterEntry === null || payload.stairsAfterEntry === fact.value, 'Conflicting stair counts.');
      payload.stairsAfterEntry = fact.value; count++;
    }
  }
  if (!count) return null;
  check(payload.stairFreeRoute !== 'yes' || payload.entranceStepFree !== 'no' && !(payload.stairsAfterEntry > 0),
    'Contradictory full-route evidence must not qualify Stair Free.');
  const sourceTitle = `Research: ${entry.sourceTitle}${entry.publishedOn ? '' : ' (publication date not shown)'}`;
  check(sourceTitle.length <= 160, 'Access source title exceeds installed-client limits.');
  const limitations = `Compiled ${reviewedAt}; source retrieved ${entry.retrievedAt}. ${entry.publishedOn
    ? `Source publication: ${entry.publishedOn}.` : 'Source publication date not shown.'} Retrieval/compilation are not a visit or inspection date. ${entry.limitations} Source: ${entry.sourceURL}`;
  check(limitations.length <= 1000, 'Access limitations exceed installed-client limits.');
  return { ...payload, sourceTitle, reportedAt: reviewedAt, observedOn: null, updatedAt: reviewedAt, limitations };
}

/** Only new sidecars are proposed. Existing direct reports and all legacy listing fields are preserved. */
export function makeManifest(findings, inventory, inventorySHA256, reviewedAt, auditedPlaceIDs = []) {
  check(validInstant(reviewedAt), 'Review compilation time is required.');
  const entries = validateFindings(findings, inventory, inventorySHA256), places = validateInventory(inventory);
  check(entries.every(entry => Date.parse(entry.retrievedAt) <= Date.parse(reviewedAt)), 'Compilation cannot precede evidence retrieval.');
  const ledger = coverageLedger(inventory, entries, auditedPlaceIDs), accessCandidates = new Map(), preservedSidecars = new Set(), preservedBaselineRoutes = new Set(), accessProjectionOmissions = [];
  for (const entry of entries) {
    const projection = accessProjection(entry, reviewedAt, accessProjectionOmissions), place = places.get(entry.placeID);
    if (!projection) continue;
    if (place.accessDetails) { preservedSidecars.add(entry.placeID); continue; }
    if (place.baseRecord?.stepFreeAccess === 'yes' && projection.stairFreeRoute !== 'yes') {
      preservedBaselineRoutes.add(entry.placeID); continue;
    }
    // Do not duplicate an unchanged city schedule as a new supplemental report.
    const changed = Object.entries(projection).some(([field, value]) => {
      if (field === 'restroomHours') return value !== null && value !== place.baseRecord?.hours;
      return ['entranceLocation', 'elevatorNote', 'restroomFloor', 'stairsAfterEntry'].includes(field) ? value !== null
        : routeAnswers.has(field) && value !== 'unknown';
    });
    if (!changed) continue;
    if (accessCandidates.has(entry.placeID)) {
      // Multiple independent sources need a human-selected coherent report, not a timestamp-flattening merge.
      accessCandidates.set(entry.placeID, null);
    } else accessCandidates.set(entry.placeID, { entryID: entry.id, payload: projection });
  }
  return { schemaVersion: 1, project: PROJECT, database: DATABASE, batchID: findings.batchID, inventorySHA256,
    reviewedAt, entries, coverage: ledger, access: [...accessCandidates].filter(([, value]) => value !== null)
      .map(([placeID, value]) => ({ placeID, ...value })),
    accessReviewRequired: [...accessCandidates].filter(([, value]) => value === null).map(([placeID]) => placeID),
    preservedSidecars: [...preservedSidecars], preservedBaselineRoutes: [...preservedBaselineRoutes], accessProjectionOmissions, sourceRatingsPolicy: 'archive-only; never writes user rating aggregates',
    codesPolicy: 'archive-only; no imported verification or automatic public-code projection' };
}

export function desiredTargets(manifest) {
  const root = `restroomResearch/${manifest.batchID}`;
  const targets = [{ path: root, payload: { schemaVersion: 1, batchID: manifest.batchID, inventorySHA256: manifest.inventorySHA256,
    sourceRatingsPolicy: manifest.sourceRatingsPolicy, codesPolicy: manifest.codesPolicy }, timestampFields: [], serverFields: ['importedAt'] }];
  const manifestDigest = sha(stable(manifest));
  targets.push({ path: `${root}/manifests/${manifestDigest.slice(0, 20)}`, payload: { manifestDigest,
    reviewedAt: manifest.reviewedAt, evidenceCount: manifest.entries.length, placeCount: manifest.coverage.length,
    coverage: manifest.coverage, accessEntryIDs: manifest.access.map(item => item.entryID) }, timestampFields: [], serverFields: ['importedAt'] });
  for (const entry of manifest.entries) {
    targets.push({ path: `${root}/entries/${entry.id}`, payload: entry, timestampFields: [], serverFields: ['importedAt'] });
    // Unchanged city dataset rows are coverage checks, not repetitive imported comments.
    if (entry.evidenceType === 'official-dataset' && !entry.facts.some(fact => fact.field === 'inspectionDate')
      || entry.facts.length > 0 && entry.facts.every(fact => ['identity', 'venueLevel'].includes(fact.field))) continue;
    targets.push({ path: `restroomSourceComments/${entry.placeID}/comments/${entry.id}`, payload: {
      placeID: entry.placeID, sourceID: id20(entry.sourceURL), sourceKind: entry.evidenceType === 'social-comment' ? 'comment' : 'post',
      text: entry.paraphrase, displayName: 'Anonymous user', publishedOn: entry.publishedOn,
      displayedDate: entry.originalTimestamp ?? 'Publication date not shown', dateStatus: entry.publishedOn ? 'explicit-year' : 'unknown',
      sourceURL: entry.sourceURL, sourceTitle: entry.sourceTitle, capturedAt: entry.retrievedAt,
      observedOn: null, verified: false, limitations: entry.limitations,
    }, timestampFields: [], serverFields: ['submittedAt'] });
  }
  for (const item of manifest.access) targets.push({ path: `restroomAccessDetails/${item.placeID}`, payload: item.payload,
    timestampFields: ['reportedAt', 'updatedAt'], serverFields: [] });
  check(targets.length <= 50_000 && new Set(targets.map(target => target.path)).size === targets.length, 'Repeated or excessive target paths.');
  return targets;
}

export function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  check(object(value), 'Unsupported archive field.');
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) } };
}
export function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('timestampValue' in value) return value.timestampValue;
  if ('integerValue' in value) { const result = Number(value.integerValue); check(Number.isSafeInteger(result), 'Unsafe stored integer.'); return result; }
  if ('doubleValue' in value) { check(Number.isFinite(value.doubleValue), 'Unsafe stored number.'); return value.doubleValue; }
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]));
  throw new ResearchError('Unsupported stored field.');
}
export const dataOf = document => Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)]));
export function createWrite(target) {
  const fields = Object.fromEntries(Object.entries(target.payload).map(([key, value]) => [key,
    target.timestampFields.includes(key) ? { timestampValue: value } : encode(value)]));
  const write = { update: { name: `${ROOT}/${target.path}`, fields }, currentDocument: { exists: false } };
  if (target.serverFields.length) write.updateTransforms = target.serverFields.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' }));
  check(Buffer.byteLength(JSON.stringify(write)) < 900_000, 'Target exceeds safe document size.');
  return write;
}
export function targetMatches(target, document) {
  if (!document) return false;
  const stored = dataOf(document);
  for (const field of [...target.timestampFields, ...target.serverFields]) if (!document.fields?.[field]?.timestampValue
    || !validInstant(stored[field])) return false;
  for (const field of target.serverFields) delete stored[field];
  const expected = { ...target.payload };
  // Protobuf JSON may omit a zero fraction or choose 3/6/9 fractional digits.
  const key = value => `${value.slice(0, 19)}.${(value.match(/\.(\d+)Z$/)?.[1] ?? '').padEnd(9, '0')}Z`;
  for (const field of target.timestampFields) { stored[field] = key(stored[field]); expected[field] = key(expected[field]); }
  return stable(stored) === stable(expected);
}
