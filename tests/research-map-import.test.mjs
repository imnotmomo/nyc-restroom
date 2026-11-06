import assert from 'node:assert/strict';
import test from 'node:test';
import { stable, sha, makeManifest, validateFindings, coverageLedger, desiredTargets, createWrite, targetMatches, ROOT,
  safeHTTPSURL } from '../scripts/research-map-model.mjs';
import { preparePlan } from '../scripts/import-research-map.mjs';
import { flattenCommunityEvidence } from '../scripts/prepare-research-findings.mjs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Timestamp } from 'firebase/firestore';
import { loadBindings, transform } from 'next/dist/build/swc/index.js';

const require = createRequire(import.meta.url);
await loadBindings();
async function compile(relative, imports = {}) {
  const source = await readFile(new URL(relative, import.meta.url), 'utf8');
  const result = await transform(source, { filename: relative, jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.code)(module, module.exports, name => Object.hasOwn(imports, name) ? imports[name] : require(name));
  return module.exports;
}
const sourceModel = await compile('../lib/source-comments.ts', { 'firebase/firestore': { Timestamp }, '@/lib/firebase-client': { getFirebaseClient: () => null } });
const accessModel = await compile('../lib/restroom-access-details-model.ts');

const inventory = { schemaVersion: 1, places: [
  { id: 'community-one', name: 'Exact branch', sourceKind: 'community', baseRecord: {}, accessDetails: null },
  { id: 'city:row-two', name: 'Same-name other branch', sourceKind: 'city', baseRecord: { hours: '9am–5pm' }, accessDetails: null },
] };
const inventoryHash = sha(JSON.stringify(inventory));
const reviewedAt = '2026-10-24T05:00:00.000Z';
const entry = (patch = {}) => ({ placeID: 'community-one', sourceURL: 'https://www.example.org/exact-branch',
  sourceTitle: 'Exact branch official accessibility page', retrievedAt: '2026-10-24T04:50:00.000Z', evidenceType: 'official-page',
  scope: 'restroom', identityEvidence: 'Exact branch and street address match the inventory.', publishedOn: null,
  originalTimestamp: null, dateEvidence: 'Publication date not shown.', paraphrase: 'A restroom is on the second floor; an elevator reaches that restroom level.',
  facts: [{ field: 'restroomFloor', value: 'Second floor', evidence: 'Restroom floor explicitly identified.' },
    { field: 'elevatorToRestroom', value: 'yes', evidence: 'Elevator explicitly reaches the restroom floor.' }],
  limitations: 'Not a visit or guarantee of current access.', ...patch });
const findings = (entries = [entry()]) => ({ schemaVersion: 1, batchID: 'research-map-2026-10-24', inventorySHA256: inventoryHash, entries });
const manifest = (entries, source = inventory) => makeManifest(findings(entries), source, inventoryHash, reviewedAt);
const stored = target => {
  const write = createWrite(target), document = { ...write.update, createTime: reviewedAt, updateTime: reviewedAt };
  for (const field of target.serverFields) document.fields[field] = { timestampValue: '2026-10-24T05:00:01Z' };
  return document;
};

test('the batch binds the actual inventory, matches exact IDs and rejects unresolved or duplicate evidence', () => {
  assert.equal(validateFindings(findings(), inventory, inventoryHash).length, 1);
  assert.throws(() => validateFindings({ ...findings(), inventorySHA256: '0'.repeat(64) }, inventory, inventoryHash));
  assert.throws(() => manifest([entry({ placeID: 'same-name-nearby' })]));
  assert.throws(() => manifest([entry(), entry()]));
  assert.throws(() => manifest([entry({ authorUID: 'private' })]));
});

test('there is no October21/2026-only cutoff and old source publication dates retain their actual provenance', () => {
  const m = manifest([entry({ publishedOn: '2023-02-15', originalTimestamp: 'February 15, 2023', dateEvidence: 'Dated source heading.' })]);
  assert.equal(m.entries[0].publishedOn, '2023-02-15');
  assert.equal(m.batchID, 'research-map-2026-10-24');
});

test('publication requires original evidence and cannot be manufactured from retrieval, inspection or dataset dates', () => {
  for (const patch of [{ publishedOn: '2026-10-24' }, { publishedOn: '2026-10-25', originalTimestamp: 'October25' },
    { publishedOn: '2026-10-23', originalTimestamp: 'No date shown' }, { publishedOn: '2026-10-23', originalTimestamp: '1 day ago' },
    { publishedOn: '2026-02-30', originalTimestamp: 'February30' }, { evidenceType: 'inspection', publishedOn: '2026-10-23', originalTimestamp: 'Inspection10/23' },
    { evidenceType: 'official-dataset', publishedOn: '2026-10-23', originalTimestamp: 'Dataset updated10/23' }]) assert.throws(() => manifest([entry(patch)]));
  const m = manifest([entry({ evidenceType: 'inspection', originalTimestamp: 'Inspection: 2026-09-15' })]);
  const comment = desiredTargets(m).find(target => target.path.startsWith('restroomSourceComments/')).payload;
  assert.equal(comment.publishedOn, null); assert.equal(comment.displayedDate, 'Inspection: 2026-09-15');
  assert.equal(comment.dateStatus, 'unknown'); assert.equal(comment.observedOn, null); assert.equal(comment.verified, false);
});

test('every map ID remains in the real coverage ledger and unchecked places remain pending', () => {
  const entries = validateFindings(findings(), inventory, inventoryHash);
  const ledger = coverageLedger(inventory, entries);
  assert.equal(ledger.length, 2); assert.equal(ledger[0].status, 'reviewed-with-findings'); assert.equal(ledger[1].status, 'pending');
  assert.equal(coverageLedger(inventory, entries, ['city:row-two'])[1].status, 'source-checked-no-new-facts');
  assert.throws(() => coverageLedger(inventory, entries, ['unknown']));
});

test('public source notes have exactly the existing15 anonymous fields and preserve source/capture/import separation', () => {
  const target = desiredTargets(manifest()).find(target => target.path.startsWith('restroomSourceComments/'));
  assert.equal(Object.keys(target.payload).length, 14); assert.deepEqual(target.serverFields, ['submittedAt']);
  assert.equal(target.payload.displayName, 'Anonymous user'); assert.equal(target.payload.displayedDate, 'Publication date not shown');
  assert.equal(target.payload.capturedAt, '2026-10-24T04:50:00.000Z');
  assert.equal(target.payload.observedOn, null); assert.equal(target.payload.verified, false);
  assert.deepEqual(Object.keys(createWrite(target).update.fields).sort(), Object.keys(target.payload).sort());
  assert.doesNotMatch(stable(target), /ownerUID|authorName|ratingSum|ratingCount/);
});

test('venue hours and building elevators never become restroom hours or restroom-route claims', () => {
  const m = manifest([entry({ scope: 'venue', facts: [{ field: 'venueHours', value: '24 hours', evidence: 'Venue open hours.' },
    { field: 'elevatorToRestroom', value: 'yes', scope: 'building', evidence: 'Lobby elevator only.' }] })]);
  assert.equal(m.access.length, 0);
});

test('explicit restroom evidence creates only a compatible sidecar without route inferences or observations', () => {
  const m = manifest(), access = m.access[0].payload;
  assert.equal(Object.keys(access).length, 15);
  assert.equal(access.elevatorToRestroom, 'yes'); assert.equal(access.stairFreeRoute, 'unknown'); assert.equal(access.entranceStepFree, 'unknown');
  assert.equal(access.observedOn, null); assert.equal(access.reportedAt, reviewedAt);
  assert.match(access.sourceTitle, /publication date not shown/);
  assert.match(access.limitations, /not a visit or inspection/);
  assert.equal(desiredTargets(m).filter(target => target.path.startsWith('communityRestrooms/')).length, 0);
});

test('existing Peninsula/direct sidecars are preserved and multiple sources are not flattened into one fresh date', () => {
  const original = { ...inventory, places: inventory.places.map(place => ({ ...place, accessDetails: place.id === 'community-one' ? { original: true } : null })) };
  const m = manifest(undefined, original); assert.equal(m.access.length, 0); assert.deepEqual(m.preservedSidecars, ['community-one']);
  const multiple = manifest([entry(), entry({ sourceURL: 'https://other.example.org/branch', paraphrase: 'Separate floor source.' })]);
  assert.equal(multiple.access.length, 0); assert.deepEqual(multiple.accessReviewRequired, ['community-one']);
  const positive = { ...inventory, places: inventory.places.map(place => ({ ...place, baseRecord: { stepFreeAccess: 'yes' } })) };
  const preserved = manifest(undefined, positive); assert.equal(preserved.access.length, 0);
  assert.deepEqual(preserved.preservedBaselineRoutes, ['community-one']);
});

test('unchanged city schedules and official dataset checks do not create redundant source comments or sidecars', () => {
  const m = manifest([entry({ placeID: 'city:row-two', evidenceType: 'official-dataset', facts: [
    { field: 'restroomHours', value: '9am–5pm', evidence: 'Unchanged official row.' }] })]);
  assert.equal(m.access.length, 0);
  assert.equal(m.coverage.find(row => row.placeID === 'city:row-two').status, 'official-record-rechecked');
  assert.equal(desiredTargets(m).filter(target => target.path.startsWith('restroomSourceComments/')).length, 0);
  const inspection = manifest([entry({ placeID: 'city:row-two', evidenceType: 'official-dataset', originalTimestamp: 'Inspection: 2026-09-15',
    facts: [{ field: 'inspectionDate', value: '2026-09-15', evidence: 'Actual inspection date, not dataset refresh.' },
      { field: 'inspectionRating', value: 'Acceptable', evidence: 'Official inspection grade.' }] })]);
  const note = desiredTargets(inspection).find(target => target.path.startsWith('restroomSourceComments/'));
  assert.ok(note); assert.equal(note.payload.publishedOn, null); assert.equal(note.payload.displayedDate, 'Inspection: 2026-09-15');
});

test('contradictory full-route answers fail closed and long source facts stay in notes without truncating into sidecars', () => {
  for (const facts of [[{ field: 'stairFreeRoute', value: 'yes', evidence: 'Full route claim.' }, { field: 'entranceStepFree', value: 'no', evidence: 'Entrance has steps.' }],
    [{ field: 'stairFreeRoute', value: 'yes', evidence: 'Full route claim.' }, { field: 'stairsAfterEntry', value: 1, evidence: 'One step.' }]]) assert.throws(() => manifest([entry({ facts })]));
  const m = manifest([entry({ facts: [{ field: 'restroomHours', value: 'x'.repeat(161), evidence: 'Full long schedule retained.' }] })]);
  assert.equal(m.access.length, 0); assert.equal(m.accessProjectionOmissions[0].field, 'restroomHours');
  assert.equal(m.entries[0].facts[0].value.length, 161);
});

test('source ratings, codes and inspection grades remain archive evidence and never fabricate user votes or verification', () => {
  const m = manifest([entry({ facts: [{ field: 'inspectionRating', value: 'Acceptable', evidence: 'Official inspection result.' },
    { field: 'passcode', value: '001234', evidence: 'Historical source code, not checked.' },
    { field: 'sourceRating', value: '7.4 as displayed; scale not shown', scope: 'venue', evidence: 'Venue score, not restroom cleanliness.' }] })]);
  assert.equal(m.access.length, 0);
  for (const target of desiredTargets(m)) assert.doesNotMatch(target.path, /Rating|Passcode|users\//);
  assert.equal(m.entries[0].facts[2].scope, 'venue');
  assert.equal(m.entries[0].facts[1].value, '001234');
  assert.throws(() => manifest([entry({ facts: [{ field: 'sourceRating', value: '4.8/5', evidence: 'Scope missing.' }] })]));
});

test('safe fact URLs reject credential-like query strings, credentials, local hosts and deceptive scheme data', () => {
  for (const url of ['http://example.org', 'https://example.org/?access_token=secret', 'https://u:p@example.org', 'https://127.1/',
    'https://host.local/', 'https://example.org/a b', 'javascript:alert(1)']) assert.equal(safeHTTPSURL(url), false);
  assert.throws(() => manifest([entry({ facts: [{ field: 'soap', value: 'yes', evidence: 'Source.', sourceURL: 'https://example.org/?api_key=secret' }] })]));
});

test('all writes are create-only with manifest-constrained target paths and correct timestamp wire types', () => {
  for (const target of desiredTargets(manifest())) {
    const write = createWrite(target); assert.deepEqual(write.currentDocument, { exists: false });
    assert.ok(write.update.name.startsWith(`${ROOT}/restroomResearch/`) || write.update.name.startsWith(`${ROOT}/restroomSourceComments/`)
      || write.update.name.startsWith(`${ROOT}/restroomAccessDetails/`));
    for (const field of target.timestampFields) assert.ok(write.update.fields[field].timestampValue);
  }
});

test('create/readback timestamps accept protobuf-equivalent fractions but reject content or precision changes', () => {
  const target = desiredTargets(manifest()).find(target => target.path.startsWith('restroomAccessDetails/'));
  const document = stored(target); document.fields.reportedAt.timestampValue = '2026-10-24T05:00:00Z';
  assert.equal(targetMatches(target, document), true);
  document.fields.reportedAt.timestampValue = '2026-10-24T05:00:00.000001Z'; assert.equal(targetMatches(target, document), false);
});

test('fresh preimages bind a plan, a replay creates zero writes, and immutable differences stop before mutation', async () => {
  const m = manifest(), documents = new Map();
  const store = { get: async path => documents.get(path) ?? null, list: async () => [...documents.values()].filter(doc => doc.name.includes('/restroomAccessDetails/')) };
  const before = await preparePlan(m, sha(stable(m)), store); assert.ok(before.writes.length > 0);
  for (const target of before.targets) documents.set(target.path, stored(target));
  const replay = await preparePlan(m, sha(stable(m)), store); assert.equal(replay.writes.length, 0);
  assert.notEqual(before.planSHA256, replay.planSHA256);
  const comment = [...documents].find(([path]) => path.startsWith('restroomSourceComments/'));
  comment[1].fields.text = { stringValue: 'Changed after independent preview.' };
  await assert.rejects(preparePlan(m, sha(stable(m)), store), /immutable research target differs/);
});

test('a new direct sidecar after inventory is preserved and global sidecar feed capacity is enforced', async () => {
  const m = manifest(), target = desiredTargets(m).find(target => target.path.startsWith('restroomAccessDetails/'));
  const direct = stored(target); direct.fields.entranceLocation = { stringValue: 'New direct report' };
  const plan = await preparePlan(m, '0'.repeat(64), { get: async path => path === target.path ? direct : null, list: async () => [direct] });
  assert.equal(plan.skipped.length, 1); assert.ok(plan.writes.every(write => !write.update.name.includes('/restroomAccessDetails/')));
  await assert.rejects(preparePlan(m, '0'.repeat(64), { get: async () => null,
    list: async () => Array.from({ length: 1000 }, (_, i) => ({ name: `existing${i}` })) }), /overflow/);
});

test('projected source comments and access records pass the actual current client strict decoders', () => {
  for (const target of desiredTargets(manifest())) {
    if (target.path.startsWith('restroomSourceComments/')) {
      const decoded = sourceModel.decodeSourceComment(target.path.split('/').at(-1), target.payload.placeID,
        { ...target.payload, submittedAt: Timestamp.fromDate(new Date(reviewedAt)) });
      assert.equal(decoded.publishedOn, null); assert.equal(decoded.observedOn, null);
    } else if (target.path.startsWith('restroomAccessDetails/')) {
      const raw = { ...target.payload };
      for (const field of target.timestampFields) raw[field] = Timestamp.fromDate(new Date(raw[field]));
      const decoded = accessModel.decodeRestroomAccessDetails(target.payload.placeID, raw,
        value => value instanceof Timestamp ? value.toDate() : null);
      assert.equal(decoded.elevatorToRestroom, 'yes'); assert.equal(decoded.stairFreeRoute, 'unknown');
    }
  }
});

test('every public projection in the frozen October24 packet passes the actual client decoder without manufacturing codes or votes', async () => {
  const m = JSON.parse(await readFile(new URL('../data/research-map-2026-10-24/manifest.json', import.meta.url), 'utf8'));
  let comments = 0, access = 0;
  for (const target of desiredTargets(m)) {
    assert.doesNotMatch(target.path, /restroomRating|restroomPasscode|users\//);
    if (target.path.startsWith('restroomSourceComments/')) {
      sourceModel.decodeSourceComment(target.path.split('/').at(-1), target.payload.placeID,
        { ...target.payload, submittedAt: Timestamp.fromDate(new Date(m.reviewedAt)) }); comments++;
    } else if (target.path.startsWith('restroomAccessDetails/')) {
      const raw = { ...target.payload };
      for (const field of target.timestampFields) raw[field] = Timestamp.fromDate(new Date(raw[field]));
      accessModel.decodeRestroomAccessDetails(target.payload.placeID, raw, value => value instanceof Timestamp ? value.toDate() : null); access++;
    }
  }
  assert.equal(comments, 863); assert.equal(access, 17);
});

test('append-only manifest audits allow later reviewed sources without changing the batch header', () => {
  const first = manifest(), second = manifest([entry(), entry({ sourceURL: 'https://second.example.org/branch', paraphrase: 'Another source reports soap.',
    facts: [{ field: 'soap', value: 'yes', evidence: 'Soap explicitly reported.' }] })]);
  assert.deepEqual(desiredTargets(first)[0], desiredTargets(second)[0]);
  const firstAudit = desiredTargets(first).find(target => target.path.includes('/manifests/'));
  const nextAudit = desiredTargets(second).find(target => target.path.includes('/manifests/'));
  assert.notEqual(firstAudit.path, nextAudit.path);
});

test('rich-source normalization preserves bounded raw provenance, venue hours and route text without promoting inferences', () => {
  const source = { sourceURL: 'https://www.example.org/branch', title: 'Branch', sourceType: 'official',
    retrievedAt: '2026-10-24T04:00:00Z', publishedOn: null, originalTimestamp: null, dateEvidence: 'Publication date not shown',
    identityEvidence: 'Exact branch/address', rawEvidenceFiles: ['captured-search-01.json'], limitations: 'Venue hours only.',
    facts: [{ field: 'venueHours', value: '10–6', scope: 'venue' }, { field: 'elevatorAccess', value: 'Lobby has elevator', scope: 'building' }] };
  const rich = { schemaVersion: 1, entries: [{ placeID: 'community-one', queries: [{ query: 'branch' }], evidence: [source] }] };
  const flat = flattenCommunityEvidence(rich);
  assert.match(flat[0].paraphrase, /Venue hours: 10–6/); assert.match(flat[0].facts[0].evidence, /captured-search-01.json/);
  assert.equal(flat[0].facts[1].field, 'elevatorAccess'); assert.equal(flat[0].facts[1].scope, 'building');
  assert.equal(manifest(flat).access.length, 0);
  assert.equal(flattenCommunityEvidence(rich, { preferredSourceKeys: new Set(['community-one|https://www.example.org/branch']) }).length, 0);
  assert.equal(flattenCommunityEvidence(rich, { excludedSources: [{ placeID: 'community-one', sourceURL: source.sourceURL }] }).length, 0);
  assert.equal(flattenCommunityEvidence({ ...rich, entries: [{ ...rich.entries[0], evidence: [{ ...source, publicationEligible: false, facts: [] }] }] }).length, 0);
});
