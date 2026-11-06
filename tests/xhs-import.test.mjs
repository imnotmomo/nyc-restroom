import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, PROJECT, DATABASE, OWNER, sha, id20, stable, venueIdentity, encode, dataOf, validateManifest, buildPlan } from '../scripts/xhs-import-model.mjs';
import { run, verifyCaptures, validateReview } from '../scripts/import-xhs-restrooms.mjs';

const PLACE = 'community-aaaaaaaaaaaaaaaaaaaa';
const STAMP = '2026-10-21T12:00:00.000Z';
const payload = () => ({ name: 'Example Cafe', address: '123 Example Street, Manhattan, NY', latitude: 40.75, longitude: -73.98,
  locationType: 'cafe', entryRule: 'unknown', stepFreeAccess: 'unknown', notes: 'Xiaohongshu source report. Not independently verified.', observedOn: null, passcodeRequired: 'unknown' });
const source = () => ({ id: 'native-post-one', nativeID: null, kind: 'post', parentSourceID: null, title: 'Native restroom post', author: 'Private source author', url: null,
  displayedDate: '2026-08-15', publishedOn: '2026-08-15', dateStatus: 'explicit-year', dateEvidence: 'The native post displays its full date.', capturedAt: STAMP,
  captures: [{ file: 'capture.png', sha256: sha('synthetic screenshot fixture') }], transcript: 'Private original transcript.', limitations: 'No actual visit date established.' });
const manifest = () => ({ schemaVersion: 1, project: PROJECT, database: DATABASE, batchID: 'xhs-2026-10-21-test', cutoff: '2026-10-21',
  eligibilityPolicy: 'confirmed-2026-only', sources: [source()], venues: [], codes: [], reports: [], comments: [] });
const code = (value = '0123#') => ({ placeID: PLACE, reportID: id20(`${PLACE}|${value}`), code: value, sourceIDs: ['native-post-one'], doorType: 'restroom', restroomLabel: 'Single cafe restroom', scopeEvidence: 'The native post explicitly names this branch and restroom door.', limitations: 'Not independently verified.' });
const doc = (path, fields, timeFields = []) => ({ name: `${ROOT}/${path}`, fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, timeFields.includes(key) ? { timestampValue: value } : encode(value)])), createTime: STAMP, updateTime: STAMP });
const summary = (placeID = PLACE) => doc(`restroomRatingSummaries/${placeID}`, { ratingCount: 0, ratingSum: 0, updatedAt: STAMP }, ['updatedAt']);
const listing = () => doc(`communityRestrooms/${PLACE}`, { ...payload(), submittedAt: STAMP }, ['submittedAt']);
function storeFixture(extra = []) {
  const documents = new Map([listing(), summary(), ...extra].map(document => [document.name.slice(ROOT.length + 1), document]));
  return { documents, commits: [], databaseIdentity: { name: `projects/${PROJECT}/databases/${DATABASE}`, databaseEdition: 'STANDARD' },
    get: async path => documents.get(path) ?? null,
    list: async path => [...documents].filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(([, value]) => value),
    commit: async function(writes) {
      for (const write of writes) assert.equal(documents.has(write.update.name.slice(ROOT.length + 1)), false, 'create-only precondition');
      this.commits.push(structuredClone(writes));
      for (const write of writes) {
        const document = structuredClone(write.update); document.createTime = STAMP; document.updateTime = STAMP;
        for (const transform of write.updateTransforms) document.fields[transform.fieldPath] = { timestampValue: STAMP };
        documents.set(document.name.slice(ROOT.length + 1), document);
      }
    },
  };
}
function publicCode(value, reportID = id20(`${PLACE}|${value}`), verified = null) {
  return doc(`restroomPasscodeReports/${PLACE}/reports/${reportID}`, { placeID: PLACE, code: value, codeUpdatedAt: STAMP, lastVerifiedAt: verified }, verified ? ['codeUpdatedAt', 'lastVerifiedAt'] : ['codeUpdatedAt']);
}
function reservation(reportID, owner = 'system-photo-import') {
  return doc(`restroomPasscodeOwners/${reportID}`, { ownerUID: owner, placeID: PLACE, createdAt: STAMP }, ['createdAt']);
}
function withReport(data, value = 'A building elevator is reported; the complete restroom route is unknown.') {
  const facts = [{ field: 'elevatorAccess', value }];
  data.reports.push({ id: id20(`native-post-one|${PLACE}|${stable(facts)}`), placeID: PLACE, sourceID: 'native-post-one', venueLabel: 'Example Cafe', reportedOn: '2026-08-15', observedOn: null, facts, limitations: 'Not independently verified.' });
  return data;
}

test('default date policy archives unknown/historical source dates but blocks public targets', () => {
  for (const [dateStatus, publishedOn] of [['unknown-year', null], ['unknown', null], ['explicit-year', '2025-08-15']]) {
    const data = manifest(); Object.assign(data.sources[0], { dateStatus, publishedOn });
    assert.equal(validateManifest(data).sources.size, 1);
    data.codes.push(code()); assert.throws(() => validateManifest(data), /ineligible/);
  }
  for (const publishedOn of ['2026-02-29', '2026-10-22', '2026-04-31']) {
    const data = manifest(); data.sources[0].publishedOn = publishedOn; assert.throws(() => validateManifest(data));
  }
});

test('explicit all-source-dates policy requires unknown-year caveats and never manufactures observations/checks', () => {
  const data = manifest(); data.eligibilityPolicy = 'all-source-dates'; Object.assign(data.sources[0], { dateStatus: 'unknown-year', publishedOn: null });
  data.codes.push(code()); assert.throws(() => validateManifest(data), /source-year caveat/);
  data.codes[0].limitations += ' Source year not established.'; assert.equal(validateManifest(data).codes.size, 1);
  const place = payload(); place.notes += ' Source year not established.';
  const identity = venueIdentity(place);
  data.venues.push({ id: `community-${id20(identity)}`, canonicalIdentity: identity, payload: place, sourceIDs: ['native-post-one'], identityEvidence: 'Exact venue address evidence.', restroomEvidence: 'Native source explicitly identifies a restroom.' });
  assert.equal(validateManifest(data).venues.size, 1);
  data.venues[0].payload.observedOn = '2026-10-21'; assert.throws(() => validateManifest(data), /observation/);
});

test('strict schemas reject staff-door codes, passcode-bearing facts and invalid provenance', () => {
  const mutations = [
    data => { data.codes.push({ ...code(), doorType: 'staff' }); },
    data => { data.sources[0].url = 'https://example.com/?xsec_token=secret'; },
    data => { data.sources[0].captures[0].file = '../capture.png'; },
    data => { data.sources[0].dateStatus = 'unknown-year'; },
    data => { data.sources[0].kind = 'comment'; },
    data => { data.sources[0].privateToken = 'extra'; },
  ];
  for (const mutate of mutations) { const data = manifest(); mutate(data); assert.throws(() => validateManifest(data)); }
  for (const value of ['Code is 1234.', 'Enter AB12# to unlock the restroom.', 'Use 1234 at the door.', '0123#']) {
    assert.throws(() => validateManifest(withReport(manifest(), value)), /code-bearing/);
  }
  const data = withReport(manifest(), 'The door reads AB12#.'); data.codes.push(code('AB12#'));
  assert.throws(() => validateManifest(data), /code-bearing/);
});

test('codes can target an existing community listing; code version is a new server timestamp and verification is null', async () => {
  const data = manifest(); data.codes.push(code()); const store = storeFixture();
  const plan = await buildPlan(data, 'manifest-hash', 'capture-digest', store, []);
  assert.equal(plan.counts.newCodes, 1); assert.equal(plan.counts.newVenues, 0);
  const write = plan.groups.flat().find(write => write.update.name.includes('/restroomPasscodeReports/'));
  assert.equal(write.currentDocument.exists, false); assert.equal(dataOf(write.update).code, '0123#');
  assert.equal(dataOf(write.update).lastVerifiedAt, null);
  assert.deepEqual(write.updateTransforms, [{ fieldPath: 'codeUpdatedAt', setToServerValue: 'REQUEST_TIME' }]);
  assert.equal(dataOf(write.update).codeUpdatedAt, undefined); assert.equal(store.commits.length, 0);
});

test('semantic dedup scans beyond ten reports and preserves the original code version/check and owner', async () => {
  const data = manifest(); data.codes.push(code()); const id = 'ZZZZZZZZZZZZZZZZZZZZ';
  const reports = Array.from({ length: 11 }, (_, index) => publicCode(`variant-${index}`, String(index).padStart(20, '0')));
  reports.push(publicCode('0123#', id, STAMP)); const stored = reports.at(-1);
  const store = storeFixture([...reports, reservation(id)]), original = structuredClone(stored);
  const plan = await buildPlan(data, 'manifest-hash', 'capture-digest', store, []);
  assert.equal(plan.counts.newCodes, 0); assert.equal(plan.codeTargets[0].actualReportID, id);
  assert.deepEqual(store.documents.get(stored.name.slice(ROOT.length + 1)), original);
  assert.equal(plan.groups.flat().some(write => write.update.name.includes('/restroomPasscodeReports/')), false);
});

test('new variants cannot hide older reports behind the latest-ten feed and missing reservations stop replay', async () => {
  const data = manifest(); data.codes.push(code());
  const reports = Array.from({ length: 10 }, (_, index) => publicCode(`variant-${index}`, String(index).padStart(20, '0')));
  await assert.rejects(buildPlan(data, 'm', 'c', storeFixture(reports), []), /latest-ten/);
  await assert.rejects(buildPlan(data, 'm', 'c', storeFixture([publicCode('0123#')]), []), /reservation/);
  const different = publicCode('different', code().reportID), same = publicCode('0123#', 'BBBBBBBBBBBBBBBBBBBB');
  await assert.rejects(buildPlan(data, 'm', 'c', storeFixture([different, same, reservation('BBBBBBBBBBBBBBBBBBBB')]), []), /deterministic/);
});

test('a duplicate venue reuses the current city/community ID instead of adding another pin', async () => {
  const data = manifest(), place = payload(), identity = venueIdentity(place);
  data.venues.push({ id: `community-${id20(identity)}`, canonicalIdentity: identity, payload: place, sourceIDs: ['native-post-one'], identityEvidence: 'Exact branch address.', restroomEvidence: 'Explicit native restroom report.' });
  await assert.rejects(buildPlan(data, 'm', 'c', storeFixture(), []), /reuse its ID/);
});

test('anonymous source comments preserve source/capture/import dates without public author identities', async () => {
  const data = manifest();
  data.sources.push({ ...source(), id: 'native-comment-one', nativeID: 'comment-identifier', kind: 'comment', parentSourceID: 'native-post-one', title: 'Private native title with code 1234', publishedOn: '2026-09-01', displayedDate: '2026-09-01' });
  const text = 'The restroom is downstairs; staff can direct visitors to the stairs.';
  data.comments.push({ id: id20(`native-comment-one|${PLACE}|${text}`), placeID: PLACE, sourceID: 'native-comment-one', sourceKind: 'comment', text, displayName: 'Anonymous user', publishedOn: '2026-09-01', observedOn: null, verified: false,
    limitations: 'Not independently verified.', scopeEvidence: 'Comment explicitly names the same branch.', sourceTitle: 'Xiaohongshu restroom discussion', sourceURL: null });
  const plan = await buildPlan(data, 'm', 'c', storeFixture(), []);
  const write = plan.groups.flat().find(write => write.update.name.includes('/restroomSourceComments/')), record = dataOf(write.update);
  assert.equal(record.displayName, 'Anonymous user'); assert.equal(record.publishedOn, '2026-09-01'); assert.equal(record.capturedAt, STAMP);
  assert.equal(record.sourceKind, 'comment');
  assert.equal(record.sourceID, id20('native-comment-one'));
  assert.equal(record.observedOn, null); assert.equal(record.verified, false); assert.equal(record.author, undefined);
  assert.equal(record.sourceTitle, 'Xiaohongshu restroom discussion'); assert.equal(JSON.stringify(record).includes('1234'), false);
  assert.deepEqual(write.updateTransforms, [{ fieldPath: 'submittedAt', setToServerValue: 'REQUEST_TIME' }]);
  data.comments[0].sourceTitle = data.sources[1].title; assert.throws(() => validateManifest(data));
  data.comments[0].sourceTitle = 'Xiaohongshu restroom discussion';
  data.sources[1].displayedDate = '2026-09-01; code 1234'; assert.throws(() => validateManifest(data));
  data.codes.push(code('AB12#')); data.sources[1].displayedDate = 'AB12#'; assert.throws(() => validateManifest(data));
});

test('target digest changes for a genuine code check, a new public venue, or changed summary', async () => {
  const data = manifest(); data.codes.push(code()); const id = code().reportID;
  const store = storeFixture([publicCode('0123#'), reservation(id)]), before = await buildPlan(data, 'm', 'c', store, []);
  store.documents.get(`restroomPasscodeReports/${PLACE}/reports/${id}`).fields.lastVerifiedAt = { timestampValue: STAMP };
  const after = await buildPlan(data, 'm', 'c', store, []); assert.notEqual(before.targetDigest, after.targetDigest);
  store.documents.set('communityRestrooms/community-bbbbbbbbbbbbbbbbbbbb', doc('communityRestrooms/community-bbbbbbbbbbbbbbbbbbbb', { ...payload(), name: 'Other Cafe', submittedAt: STAMP }, ['submittedAt']));
  assert.notEqual(after.targetDigest, (await buildPlan(data, 'm', 'c', store, [])).targetDigest);
});

test('post-body source notes remain posts and cannot be relabeled as comments', async () => {
  const data = manifest(), text = 'The source describes a restroom upstairs; no exact floor number is given.';
  data.comments.push({ id: id20(`native-post-one|${PLACE}|${text}`), placeID: PLACE, sourceID: 'native-post-one', sourceKind: 'post', text,
    displayName: 'Anonymous user', publishedOn: '2026-08-15', observedOn: null, verified: false, limitations: 'Not independently verified.',
    scopeEvidence: 'The post body names this exact branch.', sourceTitle: 'Native restroom guide', sourceURL: null });
  const plan = await buildPlan(data, 'm', 'c', storeFixture(), []);
  const write = plan.groups.flat().find(write => write.update.name.includes('/restroomSourceComments/'));
  assert.equal(dataOf(write.update).sourceKind, 'post');
  data.comments[0].sourceKind = 'comment'; assert.throws(() => validateManifest(data));
});

test('capture hashing rejects changed files and symlinks outside the evidence root', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'xhs-evidence-test-'));
  try {
    const data = manifest(); await writeFile(join(directory, 'capture.png'), 'synthetic screenshot fixture');
    const digest = await verifyCaptures(data, directory); assert.match(digest, /^[a-f0-9]{64}$/);
    await writeFile(join(directory, 'capture.png'), 'modified'); await assert.rejects(verifyCaptures(data, directory), /hash/);
    await rm(join(directory, 'capture.png')); await symlink('/etc/hosts', join(directory, 'capture.png'));
    await assert.rejects(verifyCaptures(data, directory), /escapes/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('independent review is bound to policy, manifest, evidence and fresh target digest', () => {
  const data = manifest(), now = new Date('2026-10-21T14:00:00Z');
  const review = { reviewer: 'independent-review-agent', reviewedAt: '2026-10-21T13:00:00Z', verdict: 'approved', manifestHash: 'm', captureDigest: 'c', targetDigest: 't', eligibilityPolicy: data.eligibilityPolicy };
  assert.doesNotThrow(() => validateReview(review, data, 'm', 'c', 't', now));
  for (const replacement of [{ targetDigest: 'changed' }, { eligibilityPolicy: 'all-source-dates' }, { reviewer: 'self' }, { reviewedAt: '2026-10-19T13:00:00Z' }, { verdict: 'rejected' }]) {
    assert.throws(() => validateReview({ ...review, ...replacement }, data, 'm', 'c', 't', now));
  }
});

async function runFixture(callback) {
  const directory = await mkdtemp(join(tmpdir(), 'xhs-run-test-'));
  try {
    await writeFile(join(directory, 'capture.png'), 'synthetic screenshot fixture');
    const data = manifest(); data.codes.push(code()); const manifestPath = join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify(data)); const store = storeFixture();
    const args = suffix => ['--manifest', manifestPath, '--snapshot', join(directory, `snapshot-${suffix}.json`), '--report', join(directory, `report-${suffix}.json`), '--evidence-root', directory, '--firebase-tools-dir', directory];
    await callback({ directory, data, store, args, manifestPath });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
test('dry run never commits; mock apply is create-only, reads back and replays with zero writes', async () => runFixture(async ({ directory, data, store, args }) => {
  const dry = await run(args('dry'), { store, city: [], log: () => {} }); assert.equal(store.commits.length, 0);
  const reviewPath = join(directory, 'review.json');
  await writeFile(reviewPath, JSON.stringify({ reviewer: 'independent-test-reviewer', reviewedAt: new Date().toISOString(), verdict: 'approved', manifestHash: dry.manifestHash, captureDigest: dry.captureDigest, targetDigest: dry.targetDigest, eligibilityPolicy: data.eligibilityPolicy }));
  const applyArgs = [...args('apply'), '--apply', '--expected-sha', dry.manifestHash, '--expected-target-sha', dry.targetDigest, '--review', reviewPath];
  const applied = await run(applyArgs, { store, city: [], log: () => {} });
  assert.equal(applied.status, 'complete'); assert.equal(applied.readback.zeroWriteReplay, true); assert.ok(store.commits.length > 0);
  const replay = await run(args('replay'), { store, city: [], log: () => {} }); assert.equal(replay.counts.writes, 0);
  const original = store.documents.get(`restroomPasscodeReports/${PLACE}/reports/${code().reportID}`);
  original.fields.lastVerifiedAt = { timestampValue: STAMP };
  const checkedReplay = await run(args('checked'), { store, city: [], log: () => {} }); assert.equal(checkedReplay.counts.writes, 0);
}));

test('apply refuses stale targets and uncertain commits preserve the pending-path reconciliation record', async () => runFixture(async ({ directory, data, store, args }) => {
  const dry = await run(args('dry'), { store, city: [], log: () => {} }), reviewPath = join(directory, 'review.json');
  await writeFile(reviewPath, JSON.stringify({ reviewer: 'independent-test-reviewer', reviewedAt: new Date().toISOString(), verdict: 'approved', manifestHash: dry.manifestHash, captureDigest: dry.captureDigest, targetDigest: dry.targetDigest, eligibilityPolicy: data.eligibilityPolicy }));
  const applyArgs = suffix => [...args(suffix), '--apply', '--expected-sha', dry.manifestHash, '--expected-target-sha', dry.targetDigest, '--review', reviewPath];
  const old = store.documents.get(`restroomRatingSummaries/${PLACE}`); store.documents.set(`restroomRatingSummaries/${PLACE}`, summary()); store.documents.get(`restroomRatingSummaries/${PLACE}`).updateTime = '2026-10-21T13:00:00Z';
  await assert.rejects(run(applyArgs('stale'), { store, city: [], log: () => {} }), /Fresh target/); assert.equal(store.commits.length, 0);
  store.documents.set(`restroomRatingSummaries/${PLACE}`, old); store.commit = async () => { throw Error('provider error with secret should never print'); };
  await assert.rejects(run(applyArgs('failure'), { store, city: [], log: () => {} }), /raw provider details are omitted/);
  const report = JSON.parse(await readFile(join(directory, 'report-failure.json'), 'utf8'));
  assert.equal(report.status, 'commit-outcome-unknown'); assert.equal(report.requiresReconciliation, true);
  assert.ok(report.pendingBatchPaths.length > 0); assert.equal(JSON.stringify(report).includes('secret'), false);
}));
