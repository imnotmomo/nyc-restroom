/** Strict administrator import model. Native screenshots and transcripts stay private. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// Load the app's actual pure validators on every supported Node version, without a TS runtime dependency.
const loadModel = async relative => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(await readFile(new URL(relative, import.meta.url), 'utf8'))).toString('base64')}`);
const { normalizeCommunityRestroomInput } = await loadModel('../lib/community-restroom-model.ts');
const { normalizePasscodeInput } = await loadModel('../lib/passcode-model.ts');

export const PROJECT = 'nye-restroom';
export const DATABASE = '(default)';
export const CUTOFF = '2026-10-21';
export const OWNER = 'system-xhs-import';
export const ROOT = `projects/${PROJECT}/databases/${DATABASE}/documents`;
export class XHSImportError extends Error {}
export const check = (condition, message) => { if (!condition) throw new XHSImportError(message); };
export const sha = value => createHash('sha256').update(value).digest('hex');
export const id20 = value => sha(value).slice(0, 20);
export const stable = value => JSON.stringify(value, (_, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const canonical = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const venueIdentity = value => `${canonical(value.name)}|${canonical(value.address)}`;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, maximum = 2000, empty = false) => typeof value === 'string' && value.length <= maximum
  && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(value);
const fields = new Set(['entryRule', 'passcodeRequired', 'purchaseRequired', 'restroomFloor', 'stairsToRestroom',
  'elevatorAccess', 'stepFreeAccess', 'staffAssistance', 'restroomLocation', 'buildingAccessibility',
  'restroomAccessibility', 'hours', 'venueHours', 'closure', 'genderDesignation', 'restroomType',
  'changingStations', 'soap', 'toiletPaper', 'cleanliness']);
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > CUTOFF) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function validInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || Date.parse(value) < Date.UTC(2000, 0, 1)) return false;
  return new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
export function safeURL(value) {
  try {
    if (!text(value, 4096) || /\s|\\/.test(value) || !value.startsWith('https://')) return false;
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
      || !host.includes('.') || /^[\d.]+$/.test(host) || /[:\[\]]/.test(host)
      || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return false;
    return [...url.searchParams.keys()].every(key => !/(?:token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy)/i.test(key));
  } catch { return false; }
}
const codeFree = value => !/\b(?:passcode|password|(?:door|bathroom|restroom|access|entry|keypad)\s+code|code)\s*(?:is|was|:|=|-)?\s*[#*]?\d{3,12}(?:[#*]|\b)/i.test(value)
  && !/\b(?:enter|press|type|use)\s+(?=[A-Za-z0-9#*]{3,40}\b)(?=[A-Za-z0-9#*]*[0-9#*])[A-Za-z0-9#*]{3,40}(?:\b|$)/i.test(value)
  && !/\b(?:code|passcode|password|PIN)\s*(?:(?:is|was)\s*|[:=]\s*)(?=[A-Za-z0-9#*]{3,40}\b)(?=[A-Za-z0-9#*]*[0-9#*])[A-Za-z0-9#*]{3,40}/i.test(value)
  && !/^[#*]?\d{3,12}[#*]?$/.test(value.trim());
export function sourceEligible(source, policy) {
  return policy === 'all-source-dates' || (source.publishedOn?.startsWith('2026-') && ['explicit-year', 'resolved-relative'].includes(source.dateStatus));
}

export function validateManifest(manifest) {
  check(exact(manifest, ['schemaVersion', 'project', 'database', 'batchID', 'cutoff', 'eligibilityPolicy', 'sources', 'venues', 'codes', 'reports', 'comments'])
    && manifest.schemaVersion === 1 && manifest.project === PROJECT && manifest.database === DATABASE
    && /^xhs-[a-z0-9][a-z0-9-]{0,74}$/.test(manifest.batchID) && manifest.cutoff === CUTOFF
    && ['confirmed-2026-only', 'all-source-dates'].includes(manifest.eligibilityPolicy), 'Invalid manifest identity or source eligibility policy.');
  for (const key of ['sources', 'venues', 'codes', 'reports', 'comments']) check(Array.isArray(manifest[key]) && manifest[key].length <= 5000, 'Invalid or oversized manifest collection.');
  check(manifest.sources.length > 0, 'At least one native source is required.');
  const sources = new Map(), venues = new Map(), codes = new Map(), reports = new Map(), comments = new Map();
  const privateCodes = manifest.codes.map(code => code?.code).filter(code => typeof code === 'string' && code.length);
  const publicText = value => codeFree(value) && !/\p{Script=Han}/u.test(value) && privateCodes.every(code => {
    const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(value);
  });
  for (const source of manifest.sources) {
    check(exact(source, ['id', 'nativeID', 'kind', 'parentSourceID', 'title', 'author', 'url', 'displayedDate', 'publishedOn', 'dateStatus', 'dateEvidence', 'capturedAt', 'captures', 'transcript', 'limitations'])
      && identifier(source.id) && !sources.has(source.id) && (source.nativeID === null || text(source.nativeID, 200))
      && ['post', 'comment'].includes(source.kind) && (source.parentSourceID === null || identifier(source.parentSourceID))
      && text(source.title, 2000) && (source.author === null || text(source.author, 500))
      && (source.url === null || safeURL(source.url)) && text(source.displayedDate, 500, true)
      && ['explicit-year', 'resolved-relative', 'unknown-year', 'unknown'].includes(source.dateStatus)
      && text(source.dateEvidence, 2000) && validInstant(source.capturedAt) && Date.parse(source.capturedAt) <= Date.now()
      && text(source.transcript, 100000) && text(source.limitations, 4000, true), 'Invalid native source provenance.');
    check(['unknown-year', 'unknown'].includes(source.dateStatus) ? source.publishedOn === null : validDate(source.publishedOn), 'Source date status and resolved date disagree.');
    check(source.publishedOn === null || source.publishedOn <= source.capturedAt.slice(0, 10), 'Source publication date follows its capture.');
    check(Array.isArray(source.captures) && source.captures.length > 0 && source.captures.length <= 100, 'Native screenshot evidence is required.');
    const captures = new Set();
    for (const capture of source.captures) {
      check(exact(capture, ['file', 'sha256']) && text(capture.file, 500) && !capture.file.startsWith('/')
        && !capture.file.split(/[\\/]/).some(part => !part || part === '.' || part === '..')
        && !capture.file.includes('\\') && /\.(?:png|jpe?g|webp)$/i.test(capture.file)
        && /^[a-f0-9]{64}$/.test(capture.sha256) && !captures.has(capture.file), 'Invalid or repeated capture reference.');
      captures.add(capture.file);
    }
    sources.set(source.id, source);
  }
  for (const source of sources.values()) {
    check(source.kind === 'comment' ? source.parentSourceID !== null && sources.get(source.parentSourceID)?.kind === 'post' : source.parentSourceID === null,
      'Comments need their captured parent post; posts cannot have a parent source.');
  }
  const requireSources = sourceIDs => {
    check(Array.isArray(sourceIDs) && sourceIDs.length > 0 && new Set(sourceIDs).size === sourceIDs.length
      && sourceIDs.every(id => sources.has(id) && sourceEligible(sources.get(id), manifest.eligibilityPolicy)), 'Public target cites missing or ineligible source evidence.');
    return sourceIDs.map(id => sources.get(id));
  };
  const caveat = (value, sourceIDs) => {
    check(text(value, 4000) && value.includes('Not independently verified'), 'Public imported facts require a verification caveat.');
    if (sourceIDs.some(id => sources.get(id).publishedOn === null)) check(value.includes('Source year not established'), 'Unknown-year public evidence requires an explicit source-year caveat.');
  };
  for (const venue of manifest.venues) {
    check(exact(venue, ['id', 'canonicalIdentity', 'payload', 'sourceIDs', 'identityEvidence', 'restroomEvidence'])
      && /^community-[a-f0-9]{20}$/.test(venue.id) && !venues.has(venue.id)
      && text(venue.identityEvidence, 4000) && text(venue.restroomEvidence, 4000), 'Invalid new venue or identity evidence.');
    requireSources(venue.sourceIDs);
    let payload;
    try { payload = normalizeCommunityRestroomInput(venue.payload); } catch { throw new XHSImportError('Invalid public community venue payload.'); }
    check(stable(payload) === stable(venue.payload) && payload.observedOn === null && payload.stepFreeAccess === 'unknown'
      && !/\p{Script=Han}/u.test(payload.name + payload.address) && codeFree(payload.name) && codeFree(payload.address) && publicText(payload.notes), 'Venue payload must be normalized English text, code-free, with no inferred observation or route.');
    check(venue.canonicalIdentity === venueIdentity(payload) && venue.id === `community-${id20(venue.canonicalIdentity)}`, 'New venue identity hash does not match.');
    caveat(payload.notes, venue.sourceIDs); venues.set(venue.id, venue);
  }
  for (const code of manifest.codes) {
    check(exact(code, ['placeID', 'reportID', 'code', 'sourceIDs', 'doorType', 'restroomLabel', 'scopeEvidence', 'limitations'])
      && identifier(code.placeID) && code.reportID === id20(`${code.placeID}|${code.code}`)
      && !codes.has(code.reportID) && code.doorType === 'restroom'
      && text(code.restroomLabel, 300) && text(code.scopeEvidence, 4000), 'Code must identify an exact restroom door, never a staff or security entrance.');
    requireSources(code.sourceIDs); caveat(code.limitations, code.sourceIDs);
    try { check(normalizePasscodeInput({ code: code.code, visibility: 'public' }).code === code.code, 'Code must be normalized without losing symbols or leading zeroes.'); }
    catch { throw new XHSImportError('Invalid code string.'); }
    codes.set(code.reportID, code);
  }
  for (const report of manifest.reports) {
    check(exact(report, ['id', 'placeID', 'sourceID', 'venueLabel', 'reportedOn', 'observedOn', 'facts', 'limitations'])
      && identifier(report.placeID) && sources.has(report.sourceID) && !reports.has(report.id)
      && text(report.venueLabel, 240) && publicText(report.venueLabel) && report.observedOn === null
      && report.reportedOn === sources.get(report.sourceID).publishedOn
      && Array.isArray(report.facts) && report.facts.length > 0 && report.facts.length <= 32, 'Invalid source report, date, or venue scope.');
    requireSources([report.sourceID]); caveat(report.limitations, [report.sourceID]);
    check(publicText(report.limitations), 'Public report limitations must be code-free English text.');
    const facts = new Set();
    for (const fact of report.facts) {
      check(exact(fact, ['field', 'value']) && fields.has(fact.field) && text(fact.value, 1000)
        && publicText(fact.value) && !facts.has(stable(fact)), 'Invalid, duplicate, or code-bearing public source fact.');
      facts.add(stable(fact));
    }
    check(report.id === id20(`${report.sourceID}|${report.placeID}|${stable(report.facts)}`), 'Source report identity hash does not match.');
    reports.set(report.id, report);
  }
  for (const comment of manifest.comments) {
    check(exact(comment, ['id', 'placeID', 'sourceID', 'sourceKind', 'text', 'displayName', 'publishedOn', 'observedOn', 'verified', 'limitations', 'scopeEvidence', 'sourceTitle', 'sourceURL'])
      && identifier(comment.placeID) && ['post', 'comment'].includes(comment.sourceKind)
      && sources.get(comment.sourceID)?.kind === comment.sourceKind && !comments.has(comment.id)
      && text(comment.text, 1000) && publicText(comment.text) && text(comment.sourceTitle, 300) && publicText(comment.sourceTitle)
      && publicText(sources.get(comment.sourceID).displayedDate)
      && (comment.sourceURL === null || comment.sourceURL === sources.get(comment.sourceID).url && safeURL(comment.sourceURL) && publicText(comment.sourceURL))
      && comment.displayName === 'Anonymous user' && comment.publishedOn === sources.get(comment.sourceID).publishedOn
      && comment.observedOn === null && comment.verified === false && text(comment.scopeEvidence, 4000)
      && comment.id === id20(`${comment.sourceID}|${comment.placeID}|${comment.text}`), 'Invalid anonymous source comment, source date or branch scope.');
    requireSources([comment.sourceID]); caveat(comment.limitations, [comment.sourceID]);
    check(publicText(comment.limitations), 'Public source comment limitations must be code-free English text.');
    comments.set(comment.id, comment);
  }
  return { sources, venues, codes, reports, comments };
}

export function decode(value) {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) { const number = Number(value.integerValue); check(Number.isSafeInteger(number), 'Unsafe stored integer.'); return number; }
  if ('doubleValue' in value) { check(Number.isFinite(value.doubleValue), 'Unsafe stored number.'); return value.doubleValue; }
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]));
  throw new XHSImportError('Unsupported stored field.');
}
export const dataOf = document => Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)]));
export function encode(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } };
  check(object(value), 'Unsupported import field.');
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)])) } };
}
export function createWrite(target) {
  const update = { name: `${ROOT}/${target.path}`, fields: Object.fromEntries(Object.entries(target.payload).map(([key, value]) => [key, encode(value)])) };
  check(Buffer.byteLength(JSON.stringify(update)) < 900000, 'Import document exceeds safe size.');
  return { update, currentDocument: { exists: false }, updateTransforms: target.timeFields.map(fieldPath => ({ fieldPath, setToServerValue: 'REQUEST_TIME' })) };
}
const timestamp = (document, key) => document.fields?.[key]?.timestampValue && validInstant(document.fields[key].timestampValue);
export function validateCodeDocument(document, placeID) {
  const data = dataOf(document);
  check(exact(data, ['placeID', 'code', 'codeUpdatedAt', 'lastVerifiedAt']) && data.placeID === placeID
    && /^[A-Za-z0-9]{20}$/.test(document.name.split('/').at(-1)) && timestamp(document, 'codeUpdatedAt')
    && (data.lastVerifiedAt === null || timestamp(document, 'lastVerifiedAt') && Date.parse(data.lastVerifiedAt) >= Date.parse(data.codeUpdatedAt)), 'Existing public code has an invalid schema or timestamp.');
  try { check(normalizePasscodeInput({ code: data.code, visibility: 'public' }).code === data.code, 'Existing public code is not normalized.'); }
  catch { throw new XHSImportError('Existing public code is malformed.'); }
  return data;
}
function validSummary(document) {
  if (!document) return false;
  const data = dataOf(document);
  return exact(data, ['ratingCount', 'ratingSum', 'updatedAt']) && Number.isInteger(data.ratingCount) && data.ratingCount >= 0 && data.ratingCount <= 1000000
    && Number.isFinite(data.ratingSum) && data.ratingSum * 2 === Math.round(data.ratingSum * 2)
    && data.ratingSum >= data.ratingCount && data.ratingSum <= 5 * data.ratingCount && timestamp(document, 'updatedAt');
}

/** Reads every public code variant, not just the app's latest-ten window. Never overwrites a document. */
export async function buildPlan(manifest, manifestHash, captureDigest, store, city) {
  const validated = validateManifest(manifest), reads = new Map(), groups = [], desired = [], codeTargets = [];
  const read = async path => { if (!reads.has(path)) reads.set(path, await store.get(path)); return reads.get(path); };
  const community = await store.list('communityRestrooms');
  for (const document of community) reads.set(document.name.slice(ROOT.length + 1), document);
  const known = new Set([...city.map(place => place.id), ...community.map(document => document.name.split('/').at(-1))]);
  const existingIdentity = new Map([...city.filter(place => typeof place.address === 'string' && place.address).map(place => [venueIdentity(place), place.id]),
    ...community.map(document => [venueIdentity(dataOf(document)), document.name.split('/').at(-1)])]);
  const addGroup = async targets => {
    const existing = await Promise.all(targets.map(async target => ({ target, document: await read(target.path) })));
    const present = existing.filter(item => item.document);
    check(present.length === 0 || present.length === targets.length, 'A partially present atomic target group requires review.');
    if (present.length) {
      for (const { target, document } of present) {
        const stored = dataOf(document);
        for (const field of target.timeFields) { check(timestamp(document, field), 'Existing import is missing a server timestamp.'); delete stored[field]; }
        check(stable(stored) === stable(target.payload), 'An immutable import target differs from this manifest.');
      }
    } else groups.push(targets.map(createWrite));
    desired.push(...targets); return present.length > 0;
  };
  for (const venue of manifest.venues) {
    const collision = existingIdentity.get(venue.canonicalIdentity);
    check(!collision || collision === venue.id, 'An existing city or community venue matches this new venue; reuse its ID.');
    const listingPath = `communityRestrooms/${venue.id}`, receiptPath = `restroomSubmissions/${venue.id}`, summaryPath = `restroomRatingSummaries/${venue.id}`;
    const listing = await read(listingPath), receipt = await read(receiptPath), summary = await read(summaryPath);
    if (listing) {
      const stored = dataOf(listing); delete stored.submittedAt;
      check(timestamp(listing, 'submittedAt') && stable(stored) === stable(venue.payload), 'Existing imported venue differs from this manifest.');
      check(receipt && exact(dataOf(receipt), ['ownerUID', 'submittedAt']) && dataOf(receipt).ownerUID === OWNER
        && timestamp(receipt, 'submittedAt') && receipt.fields.submittedAt.timestampValue === listing.fields.submittedAt.timestampValue && validSummary(summary), 'Existing imported venue ownership or rating summary is inconsistent.');
    } else {
      check(!receipt && !summary, 'New venue metadata exists without its listing.');
      const targets = [{ path: listingPath, payload: venue.payload, timeFields: ['submittedAt'] },
        { path: receiptPath, payload: { ownerUID: OWNER }, timeFields: ['submittedAt'] },
        { path: summaryPath, payload: { ratingCount: 0, ratingSum: 0 }, timeFields: ['updatedAt'] }];
      groups.push(targets.map(createWrite)); desired.push(...targets);
    }
    known.add(venue.id);
  }
  const reportsByPlace = new Map(), plannedPerPlace = new Map();
  for (const code of manifest.codes) {
    check(known.has(code.placeID), 'A code targets an unknown public place.');
    if (!reportsByPlace.has(code.placeID)) {
      const documents = await store.list(`restroomPasscodeReports/${code.placeID}/reports`);
      for (const document of documents) { validateCodeDocument(document, code.placeID); reads.set(document.name.slice(ROOT.length + 1), document); }
      reportsByPlace.set(code.placeID, documents);
      if (!validated.venues.has(code.placeID) || await read(`communityRestrooms/${code.placeID}`)) check(validSummary(await read(`restroomRatingSummaries/${code.placeID}`)), 'Existing code target has no valid initialized rating summary.');
    }
    const documents = reportsByPlace.get(code.placeID);
    const deterministic = documents.find(document => document.name.split('/').at(-1) === code.reportID);
    check(!deterministic || dataOf(deterministic).code === code.code, 'The deterministic code ID contains a different code; stop for review.');
    const same = documents.filter(document => dataOf(document).code === code.code).sort((a, b) => a.name.localeCompare(b.name));
    if (same.length) {
      const actualReportID = same[0].name.split('/').at(-1), reservation = await read(`restroomPasscodeOwners/${actualReportID}`);
      check(reservation && exact(dataOf(reservation), ['ownerUID', 'placeID', 'createdAt'])
        && text(dataOf(reservation).ownerUID, 128) && dataOf(reservation).placeID === code.placeID && timestamp(reservation, 'createdAt'), 'Existing matching code has no valid ownership reservation.');
      codeTargets.push({ placeID: code.placeID, desiredReportID: code.reportID, actualReportID, action: 'preserve-existing' }); continue;
    }
    check(documents.length + (plannedPerPlace.get(code.placeID) ?? 0) < 10, 'A new code would exceed the public latest-ten feed; review code visibility before importing.');
    const path = `restroomPasscodeReports/${code.placeID}/reports/${code.reportID}`, ownerPath = `restroomPasscodeOwners/${code.reportID}`;
    check(!await read(path) && !await read(ownerPath), 'A code ID or ownership reservation already exists; never overwrite it.');
    const targets = [{ path, payload: { placeID: code.placeID, code: code.code, lastVerifiedAt: null }, timeFields: ['codeUpdatedAt'] },
      { path: ownerPath, payload: { ownerUID: OWNER, placeID: code.placeID }, timeFields: ['createdAt'] }];
    groups.push(targets.map(createWrite)); desired.push(...targets); plannedPerPlace.set(code.placeID, (plannedPerPlace.get(code.placeID) ?? 0) + 1);
    codeTargets.push({ placeID: code.placeID, desiredReportID: code.reportID, actualReportID: code.reportID, action: 'create-unverified' });
  }
  for (const report of manifest.reports) check(known.has(report.placeID), 'A source report targets an unknown public place.');
  for (const comment of manifest.comments) {
    check(known.has(comment.placeID), 'A source comment targets an unknown public place.');
    const source = validated.sources.get(comment.sourceID);
    await addGroup([{ path: `restroomSourceComments/${comment.placeID}/comments/${comment.id}`, payload: {
      // Private extraction IDs may contain a source author's handle. Project only an opaque reference.
      placeID: comment.placeID, sourceID: id20(comment.sourceID), sourceKind: comment.sourceKind, text: comment.text, displayName: 'Anonymous user',
      publishedOn: comment.publishedOn, displayedDate: source.displayedDate, dateStatus: source.dateStatus,
      sourceURL: comment.sourceURL, sourceTitle: comment.sourceTitle, capturedAt: source.capturedAt,
      observedOn: null, verified: false, limitations: comment.limitations,
    }, timeFields: ['submittedAt'] }]);
  }
  const archiveRoot = `restroomResearch/${manifest.batchID}`;
  const archive = [{ path: archiveRoot, payload: { schemaVersion: 1, batchID: manifest.batchID, cutoff: CUTOFF,
    eligibilityPolicy: manifest.eligibilityPolicy, manifestHash, captureDigest, systemOwner: OWNER,
    counts: Object.fromEntries(['sources', 'venues', 'codes', 'reports', 'comments'].map(key => [key, manifest[key].length])) } }];
  for (const [collection, items] of [['sources', manifest.sources], ['venues', manifest.venues], ['codes', manifest.codes], ['reports', manifest.reports], ['comments', manifest.comments]]) {
    for (const item of items) archive.push({ path: `${archiveRoot}/${collection}/${id20(collection === 'sources' ? item.id : collection === 'codes' ? item.reportID : item.id)}`, payload: { manifestHash, record: item } });
    const existing = await store.list(`${archiveRoot}/${collection}`), paths = new Set(archive.map(target => `${ROOT}/${target.path}`));
    check(existing.every(document => paths.has(document.name)), 'The immutable archive contains records absent from this manifest.');
    for (const document of existing) reads.set(document.name.slice(ROOT.length + 1), document);
  }
  // Prefetch independent archive target states without changing deterministic group order.
  for (let offset = 0; offset < archive.length; offset += 12) await Promise.all(archive.slice(offset, offset + 12).map(target => read(target.path)));
  for (const target of archive) await addGroup([{ ...target, timeFields: ['importedAt'] }]);
  const targetSnapshot = [...reads].map(([path, document]) => ({ path, document })).sort((a, b) => a.path.localeCompare(b.path));
  const queryInventory = { communityPaths: community.map(document => document.name).sort(), codePaths: [...reportsByPlace].map(([placeID, documents]) => ({ placeID, paths: documents.map(document => document.name).sort() })).sort((a, b) => a.placeID.localeCompare(b.placeID)) };
  const targetDigest = sha(stable({ manifestHash, captureDigest, cityDigest: sha(stable(city)), targetSnapshot, queryInventory, groups }));
  return { targetDigest, targetSnapshot, queryInventory, groups, desired, codeTargets,
    counts: { sources: manifest.sources.length, venues: manifest.venues.length, codes: manifest.codes.length, reports: manifest.reports.length, comments: manifest.comments.length,
      writes: groups.flat().length, newVenues: groups.filter(group => group.some(write => write.update.name.includes('/communityRestrooms/'))).length,
      newCodes: codeTargets.filter(target => target.action === 'create-unverified').length, preservedCodes: codeTargets.filter(target => target.action === 'preserve-existing').length } };
}
