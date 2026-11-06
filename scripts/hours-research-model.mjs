/** Append-only hours enrichment planning. No credentials, networking or mutations. */
import { decodeCardResearch, CARD_RESEARCH_FIELD_INFO } from '../lib/card-research-model.ts';
import { PROJECT, DATABASE, ROOT, check, stable, sha, id20, encode, dataOf, validDate, validInstant, safeHTTPSURL } from './research-map-model.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/;
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);
const known = value => typeof value === 'string' && value.trim()
  && !/^(?:unknown|hours unknown|not[ -]reported|not available|n\/a)$/i.test(value.trim());
const hourFields = new Set(['hours', 'restroomHours', 'venueHours']);
const collections = new Set(['communityRestrooms', 'restroomAccessDetails', 'restroomResearchProfiles']);

export function checkedHoursPath(path, writable = false) {
  const parts = typeof path === 'string' ? path.split('/') : [];
  check(parts.length === 2 && collections.has(parts[0]) && idPattern.test(parts[1])
    && (!writable || parts[0] === 'restroomResearchProfiles'), 'Unexpected hours operation path.');
  return path;
}
function checkedDocument(document, path) {
  if (document === null) return null;
  check(object(document) && document.name === `${ROOT}/${checkedHoursPath(path)}` && object(document.fields)
    && validInstant(document.updateTime) && validInstant(document.createTime)
    && Date.parse(document.createTime) <= Date.parse(document.updateTime), 'Invalid hours preimage identity or version.');
  return document;
}
function preimageMaps(preimages) {
  check(exact(preimages, ['project', 'databaseID', 'readTime', 'collections']) && preimages.project === PROJECT
    && preimages.databaseID === DATABASE && validInstant(preimages.readTime)
    && exact(preimages.collections, [...collections]), 'Invalid pinned public preimages.');
  const maps = new Map();
  for (const collection of collections) {
    const docs = preimages.collections[collection];
    check(Array.isArray(docs) && docs.length <= 2_000, 'Invalid bounded public preimages.');
    const map = new Map();
    for (const document of docs) {
      check(object(document) && typeof document.name === 'string' && document.name.startsWith(`${ROOT}/${collection}/`), 'Foreign preimage collection.');
      const path = document.name.slice(ROOT.length + 1); checkedDocument(document, path);
      check(!map.has(path), 'Repeated public preimage.'); map.set(path, document);
    }
    maps.set(collection, map);
  }
  return path => maps.get(path.split('/')[0]).get(path) ?? null;
}
function validateInventory(inventory) {
  check(object(inventory) && inventory.schemaVersion === 1 && inventory.project === PROJECT
    && inventory.databaseID === DATABASE && inventory.edition === 'STANDARD' && validInstant(inventory.readTime)
    && Array.isArray(inventory.places) && inventory.places.length > 0 && inventory.places.length <= 2_000
    && inventory.total === inventory.places.length && Number.isSafeInteger(inventory.city) && inventory.city >= 0
    && Number.isSafeInteger(inventory.community) && inventory.community >= 0 && inventory.city + inventory.community === inventory.total
    && Number.isSafeInteger(inventory.profiles) && inventory.profiles >= 0 && inventory.profiles <= inventory.total,
  'Invalid fresh hours inventory.');
  const places = new Map();
  for (const place of inventory.places) {
    check(object(place) && typeof place.id === 'string' && idPattern.test(place.id) && !places.has(place.id)
      && text(place.name, 1000) && (place.address === null || text(place.address, 1000))
      && ['city', 'community'].includes(place.sourceKind) && typeof place.needsHoursResearch === 'boolean'
      && Array.isArray(place.scheduleFacts) && Number.isFinite(place.latitude) && Number.isFinite(place.longitude), 'Invalid exact hours inventory identity.');
    places.set(place.id, place);
  }
  check([...places.values()].filter(place => place.sourceKind === 'community').length === inventory.community, 'Hours inventory is partial or its source counts differ.');
  return places;
}
function validFinding(entry, reviewedAt) {
  const keys = ['placeID', 'name', 'address', 'status', 'field', 'schedule', 'sourceURL', 'sourceTitle',
    'retrievedAt', 'publishedOn', 'sourceExcerpt', 'limitations', 'evidenceURLs'];
  check(object(entry) && Object.keys(entry).every(key => keys.includes(key) || key === 'sourceKind')
    && keys.every(key => Object.hasOwn(entry, key)) && idPattern.test(entry.placeID)
    && text(entry.name, 1000) && (entry.address === null || text(entry.address, 1000))
    && ['found', 'closed', 'not-found', 'ambiguous'].includes(entry.status)
    && (entry.field === null || hourFields.has(entry.field)) && (entry.schedule === null || text(entry.schedule, 3000))
    && safeHTTPSURL(entry.sourceURL) && text(entry.sourceTitle, 300) && validInstant(entry.retrievedAt)
    && Date.parse(entry.retrievedAt) <= Date.parse(reviewedAt)
    && (entry.publishedOn === null || validDate(entry.publishedOn) && entry.publishedOn <= entry.retrievedAt.slice(0, 10))
    && text(entry.sourceExcerpt, 3000, true) && text(entry.limitations, 3000)
    && Array.isArray(entry.evidenceURLs) && entry.evidenceURLs.length <= 20 && entry.evidenceURLs.every(safeHTTPSURL),
  'Invalid reviewed hours finding or source dates.');
  const kind = entry.sourceKind ?? 'official-page';
  check(['official-page', 'official-dataset', 'directory'].includes(kind), 'Unreviewed hours source kind.');
  check(kind !== 'official-dataset' || entry.publishedOn === null, 'Dataset update time is not an individual publication date.');
  return kind;
}
function makeSource(entry, kind) {
  const qualifier = kind === 'directory' ? 'Directory-listed venue hours; restroom hours remain unconfirmed. ' : '';
  const limitations = `${qualifier}${entry.limitations}${entry.sourceExcerpt ? ` Source excerpt: ${entry.sourceExcerpt}` : ''}`
    + ` Source retrieved ${entry.retrievedAt}; retrieval and compilation are not a visit or inspection. Supporting URLs: ${entry.evidenceURLs.join(' ')}`;
  check(limitations.length <= 4000, 'Combined source evidence exceeds the installed-client limit.');
  const label = kind === 'directory' ? 'Directory' : kind === 'official-dataset' ? 'NYC Open Data' : 'Official source';
  const source = { label, title: entry.sourceTitle, url: entry.sourceURL, kind, publishedOn: entry.publishedOn,
    displayedDate: entry.publishedOn ?? 'Publication date not shown', observedOn: null,
    retrievedAt: entry.retrievedAt, limitations };
  return { id: id20(stable(source)), ...source };
}

/** Preserve the entire old profile; only append source-bound hours to unknown places. */
export function buildHoursTargets(packet, inventory, preimages, inventorySHA256, packetSHA256) {
  check(exact(packet, ['schemaVersion', 'inventorySHA256', 'reviewedAt', 'entries']) && packet.schemaVersion === 1
    && /^[a-f0-9]{64}$/.test(inventorySHA256) && packet.inventorySHA256 === inventorySHA256
    && /^[a-f0-9]{64}$/.test(packetSHA256) && validInstant(packet.reviewedAt)
    && Array.isArray(packet.entries) && packet.entries.length <= 2_000, 'Reviewed packet must bind the exact fresh inventory.');
  const places = validateInventory(inventory), original = preimageMaps(preimages);
  check(inventory.readTime === preimages.readTime
    && preimages.collections.communityRestrooms.length === inventory.community
    && preimages.collections.restroomResearchProfiles.length === inventory.profiles,
  'Pinned preimages are partial or from a different inventory snapshot.');
  check(Date.parse(inventory.readTime) <= Date.parse(packet.reviewedAt)
    && Date.parse(preimages.readTime) <= Date.parse(packet.reviewedAt), 'Review cannot precede inventory or preimages.');
  const grouped = new Map(), skipped = [], seen = new Set();
  for (const entry of packet.entries) {
    const kind = validFinding(entry, packet.reviewedAt), place = places.get(entry.placeID);
    check(place && place.name === entry.name && place.address === entry.address, 'Finding name/address does not match the exact inventory location.');
    const entryID = sha(stable(entry)); check(!seen.has(entryID), 'Duplicate reviewed hours finding.'); seen.add(entryID);
    if (!['found', 'closed'].includes(entry.status) || entry.schedule === null || entry.field === null) {
      skipped.push({ placeID: entry.placeID, reason: 'no-reviewed-schedule' }); continue;
    }
    check(place.needsHoursResearch && !known(place.directHours)
      && !place.scheduleFacts.some(fact => hourFields.has(fact.field) && known(fact.value)), 'Known or ineligible inventory hours cannot be overridden.');
    check(known(entry.schedule), 'A placeholder cannot become published hours.');
    check(kind !== 'directory' || entry.field === 'venueHours', 'Directory hours require explicit venue-only scope.');
    const values = grouped.get(entry.placeID) ?? []; values.push({ entry, kind }); grouped.set(entry.placeID, values);
  }
  const targets = [];
  for (const [placeID, values] of [...grouped].sort(([left], [right]) => left.localeCompare(right))) {
    const place = places.get(placeID), path = checkedHoursPath(`restroomResearchProfiles/${placeID}`, true);
    const before = original(path), accessPath = checkedHoursPath(`restroomAccessDetails/${placeID}`);
    const access = original(accessPath), guards = [{ path: accessPath, document: access }];
    check(!access || !known(dataOf(access).restroomHours), 'An existing direct restroom schedule cannot be overridden.');
    if (place.sourceKind === 'community') {
      const communityPath = checkedHoursPath(`communityRestrooms/${placeID}`), document = original(communityPath);
      const identity = document && dataOf(document);
      check(identity && ['name', 'address', 'latitude', 'longitude'].every(key => identity[key] === place[key]), 'Pinned community venue identity differs.');
      guards.push({ path: communityPath, document });
    }
    const old = before ? dataOf(before) : null;
    if (old) {
      check(stable(decodeCardResearch(placeID, old)) === stable(old), 'Original profile cannot be preserved through strict decoding.');
      check(!old.facts.some(fact => hourFields.has(fact.field) && known(fact.value)), 'Existing known profile hours cannot be overridden.');
    }
    const payload = old ? structuredClone(old) : { schemaVersion: 1, placeID, sources: [], facts: [], comments: [], coveredCommentIDs: [] };
    for (const { entry, kind } of values) {
      const source = makeSource(entry, kind);
      const oldSource = payload.sources.find(value => value.id === source.id);
      check(!oldSource || stable(oldSource) === stable(source), 'Source ID collision.');
      if (!oldSource) payload.sources.push(source);
      const fact = { field: entry.field, label: CARD_RESEARCH_FIELD_INFO[entry.field].label, value: entry.schedule,
        scope: entry.field === 'venueHours' ? 'venue' : 'restroom', sourceID: source.id, section: 'hours', context: '' };
      const complete = { id: id20(stable(fact)), ...fact };
      const oldFact = payload.facts.find(value => value.id === complete.id);
      check(!oldFact || stable(oldFact) === stable(complete), 'Fact ID collision.');
      if (!oldFact) payload.facts.push(complete);
    }
    payload.manifestSHA256 = packetSHA256; payload.generatedAt = packet.reviewedAt;
    check(stable(decodeCardResearch(placeID, payload)) === stable(payload)
      && Buffer.byteLength(JSON.stringify(payload)) <= 131_072, 'Appended profile exceeds a client or document bound.');
    if (old) check(stable(payload.comments) === stable(old.comments) && stable(payload.coveredCommentIDs) === stable(old.coveredCommentIDs)
      && stable(payload.sources.slice(0, old.sources.length)) === stable(old.sources)
      && stable(payload.facts.slice(0, old.facts.length)) === stable(old.facts), 'Append-only preservation failed.');
    targets.push({ path, payload, before, guards });
  }
  return { targets, skipped };
}

export function hoursTargetMatches(target, document) {
  checkedHoursPath(target.path, true);
  if (!document) return false;
  checkedDocument(document, target.path);
  return stable(dataOf(document)) === stable(target.payload);
}

export async function planHoursImport(targets, packetSHA256, preimagesSHA256, store) {
  const refs = new Map();
  for (const target of targets) {
    checkedHoursPath(target.path, true); refs.set(target.path, null);
    for (const guard of target.guards) { checkedHoursPath(guard.path); refs.set(guard.path, null); }
  }
  const paths = [...refs.keys()].sort(), snapshots = [];
  for (let offset = 0; offset < paths.length; offset += 12) {
    const batch = await Promise.all(paths.slice(offset, offset + 12).map(async path => ({ path, document: checkedDocument(await store.get(path), path) })));
    for (const row of batch) { refs.set(row.path, row.document); snapshots.push(row); }
  }
  const writes = [];
  for (const target of targets) {
    for (const guard of target.guards) check(stable(refs.get(guard.path)) === stable(guard.document), 'A venue identity or direct-hours preimage changed; review again.');
    const document = refs.get(target.path);
    if (hoursTargetMatches(target, document)) continue;
    check(stable(document) === stable(target.before), 'A research profile preimage changed; stop rather than overwrite it.');
    const changed = target.before ? ['sources', 'facts', 'generatedAt', 'manifestSHA256'] : Object.keys(target.payload);
    const write = { update: { name: `${ROOT}/${target.path}`, fields: Object.fromEntries(changed.map(key => [key, encode(target.payload[key])])) },
      currentDocument: target.before ? { updateTime: target.before.updateTime } : { exists: false } };
    if (target.before) write.updateMask = { fieldPaths: changed };
    writes.push(write);
  }
  return { snapshots, writes, planSHA256: sha(stable({ packetSHA256, preimagesSHA256, snapshots, writes })) };
}
