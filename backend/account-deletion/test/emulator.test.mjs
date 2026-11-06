import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { DeletionLease, pruneCompletedReceipts } from '../src/lease.mjs';
import { createDeletionService } from '../src/service.mjs';
import { recoveryWorker } from '../src/recovery.mjs';
import { COMPLETED_RETENTION_MS, DELETION_POLICY_VERSION, ServiceError } from '../src/policy.mjs';

const PROJECT = 'demo-restroom-account-deletion';
// Fail before constructing any Admin client unless BOTH isolated loopback emulators are explicit.
assert.ok(PROJECT.startsWith('demo-'));
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8588');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9599');
assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
const CITY = 'i7jb-7jku:deletion-fixture';
const COMMUNITY = `community-${'C'.repeat(20)}`;
const OTHER_COMMUNITY = `community-${'D'.repeat(20)}`;
const OWN_CODE = 'A'.repeat(20), OTHER_CODE = 'B'.repeat(20), OWN_VISIT = 'V'.repeat(20), OTHER_VISIT = 'W'.repeat(20);
const OWN_NOTE = 'N'.repeat(20), OTHER_NOTE = 'O'.repeat(20), SECOND_NOTE = 'P'.repeat(20);
const OWN_CODE_V2 = 'X'.repeat(20), OTHER_CODE_V2 = 'Y'.repeat(20), SECOND_CODE_V2 = 'Z'.repeat(20);
const OWN_UNIFIED_VISIT = 'E'.repeat(20), OTHER_UNIFIED_VISIT = 'F'.repeat(20), SECOND_UNIFIED_VISIT = 'G'.repeat(20);
const OLD = Timestamp.fromMillis(1_600_000_000_000);
const VERSION = Timestamp.fromMillis(1_600_000_001_000);
const VERIFIED = Timestamp.fromMillis(1_600_000_002_000);
let app, db, auth, clock, unchangedSnapshots;
const issuedTokens = new Map();
const ref = path => db.doc(path);
const summary = place => ref(`restroomRatingSummaries/${place}`);
const vote = (place, uid) => summary(place).collection('ratings').doc(uid);
const privateRef = (uid, collection, id) => ref(`users/${uid}/${collection}/${id}`);
const publicCode = (place, id) => ref(`restroomPasscodeReports/${place}/reports/${id}`);
const publicVisit = (place, id) => ref(`restroomVisitReports/${place}/reports/${id}`);
const publicNote = (place, id) => ref(`restroomPublicNotes/${place}/notes/${id}`);
const publicCodeV2 = (place, id) => ref(`restroomPasscodeReportsV2/${place}/reports/${id}`);
const unifiedVisit = (place, id) => ref(`restroomUnifiedVisits/${place}/reports/${id}`);
const unifiedReceipt = (uid, id) => privateRef(uid, 'restroomReadyUnifiedVisitReceipts', id);
const codeFeedback = (place, kind, id) => ref(`restroomPasscodeFeedback/${place}/codes/${kind}_${id}`);
const codeVote = (uid, place, kind, id) => privateRef(uid, 'restroomReadyPasscodeVotes', `${place}~${kind}_${id}`);
const lock = uid => ref(`accountDeletionLocks/${uid}`);

function token(uid = 'alice', authTime = Math.floor(clock / 1000), provider = 'google.com') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const seconds = Math.floor(Date.now() / 1000);
  const claims = {
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid,
    iat: seconds, exp: seconds + 3600, auth_time: authTime,
    firebase: { sign_in_provider: provider, identities: { [provider]: [uid] } },
  };
  const result = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.`;
  issuedTokens.set(result, { ...claims, uid });
  return result;
}
// The Admin Auth emulator ALWAYS looks up the user, even when checkRevoked=false.
// Model only the production offline signature stage using exact test-issued tokens;
// the revocation/disabled/getUser/delete stages still use the real Admin emulator.
// Production authenticate() is unchanged and always uses SDK signature verification.
const emulatorAuth = {
  async verifyIdToken(value, revoked) {
    if (revoked) return auth.verifyIdToken(value, true);
    const claims = issuedTokens.get(value);
    if (!claims || claims.exp <= Date.now() / 1000) throw { code: 'auth/argument-error' };
    return { ...claims };
  },
  getUser: uid => auth.getUser(uid),
  deleteUser: uid => auth.deleteUser(uid),
};
const service = extra => createDeletionService({ auth: emulatorAuth, db, now: () => clock, ...extra });

async function seedUnifiedVisit(uid = 'alice', id = OWN_UNIFIED_VISIT, { anonymous = false, codeReportID = null } = {}) {
  const batch = db.batch();
  batch.set(unifiedVisit(CITY, id), { schemaVersion: 1, placeID: CITY, observedAt: OLD, submittedAt: OLD,
    entryRule: 'not-reported', purchaseRequired: 'not-reported', codeRequired: codeReportID === null ? 'not-reported' : 'yes',
    stairs: 'not-reported', soap: 'not-reported', toiletPaper: 'not-reported', floor: 'not-reported',
    condition: 'usable', comment: 'Synthetic unified visitor comment', anonymous,
    authorName: anonymous ? null : 'Synthetic Tester' });
  batch.set(unifiedReceipt(uid, id), { placeID: CITY, submittedAt: OLD, codeReportID });
  await batch.commit();
}

async function allowHistoricalFixtureSession(uid) {
  const result = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
    method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({ localId: uid, validSince: '1600000000' }),
  });
  assert.equal(result.ok, true);
}

async function seed() {
  const users = await auth.importUsers(['alice', 'bob'].map(uid => ({
    uid, providerData: [{ uid: `provider-${uid}`, providerId: 'google.com' }],
  })));
  assert.equal(users.failureCount, 0);
  for (const uid of ['alice', 'bob']) await allowHistoricalFixtureSession(uid);
  const batch = db.batch();
  batch.set(summary(CITY), { ratingCount: 2, ratingSum: 7.5, updatedAt: OLD });
  batch.set(vote(CITY, 'alice'), { stars: 4.5, updatedAt: OLD });
  batch.set(vote(CITY, 'bob'), { stars: 3, updatedAt: OLD });
  batch.set(summary(COMMUNITY), { ratingCount: 1, ratingSum: 5, updatedAt: OLD });
  batch.set(vote(COMMUNITY, 'bob'), { stars: 5, updatedAt: OLD });
  for (const uid of ['alice', 'bob']) {
    batch.set(privateRef(uid, 'restroomReadySaved', CITY), { placeID: CITY, savedAt: OLD });
    batch.set(privateRef(uid, 'restroomReadyNotes', 'note'), { placeID: CITY, entryNote: `${uid} emulator-only private note` });
  }
  for (const [uid, place, id] of [['alice', CITY, OWN_CODE], ['bob', COMMUNITY, OTHER_CODE]]) {
    batch.set(ref(`restroomPasscodeOwners/${id}`), { ownerUID: uid, placeID: place, createdAt: OLD });
    batch.set(privateRef(uid, 'restroomReadyPasscodes', place), { placeID: place, reportID: id, code: 'fixture-only',
      visibility: 'public', createdAt: OLD, codeUpdatedAt: VERSION, lastVerifiedAt: VERIFIED });
    batch.set(publicCode(place, id), { placeID: place, code: 'fixture-only', codeUpdatedAt: VERSION, lastVerifiedAt: VERIFIED });
  }
  batch.set(privateRef('alice', 'restroomReadyPasscodeChecks', OTHER_CODE), { placeID: COMMUNITY, codeUpdatedAt: VERSION, verifiedAt: VERIFIED });
  for (const [uid, place, id] of [['alice', CITY, OWN_CODE_V2], ['bob', COMMUNITY, OTHER_CODE_V2]]) {
    batch.set(ref(`restroomPasscodeV2Owners/${id}`), { ownerUID: uid, placeID: place, createdAt: VERSION });
    batch.set(privateRef(uid, 'restroomReadyPasscodesV2', id), { placeID: place, code: 'fixture-v2-only', visibility: 'public',
      createdAt: VERSION, codeUpdatedAt: VERSION, lastVerifiedAt: null });
    batch.set(publicCodeV2(place, id), { placeID: place, code: 'fixture-v2-only', codeUpdatedAt: VERSION });
  }
  batch.set(codeFeedback(CITY, 'v2', OWN_CODE_V2), { placeID: CITY, kind: 'v2', reportID: OWN_CODE_V2,
    codeUpdatedAt: VERSION, usedCount: 1, invalidCount: 0, lastUsedAt: VERIFIED, updatedAt: VERIFIED });
  batch.set(codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2), { placeID: COMMUNITY, kind: 'v2', reportID: OTHER_CODE_V2,
    codeUpdatedAt: VERSION, usedCount: 4, invalidCount: 2, lastUsedAt: VERIFIED, updatedAt: VERIFIED });
  batch.set(codeVote('alice', COMMUNITY, 'v2', OTHER_CODE_V2), { placeID: COMMUNITY, kind: 'v2', reportID: OTHER_CODE_V2,
    codeUpdatedAt: VERSION, vote: 'used', updatedAt: VERIFIED });
  batch.set(codeFeedback(COMMUNITY, 'legacy', OTHER_CODE), { placeID: COMMUNITY, kind: 'legacy', reportID: OTHER_CODE,
    codeUpdatedAt: VERSION, usedCount: 2, invalidCount: 1, lastUsedAt: VERSION, updatedAt: VERIFIED });
  batch.set(codeVote('alice', COMMUNITY, 'legacy', OTHER_CODE), { placeID: COMMUNITY, kind: 'legacy', reportID: OTHER_CODE,
    codeUpdatedAt: VERSION, vote: 'invalid', updatedAt: VERIFIED });
  for (const [uid, id] of [['alice', OWN_VISIT], ['bob', OTHER_VISIT]]) {
    batch.set(publicVisit(CITY, id), { placeID: CITY, submittedAt: OLD, observedAt: OLD, soap: 'yes' });
    batch.set(privateRef(uid, 'restroomReadyVisitReceipts', id), { placeID: CITY, submittedAt: OLD });
  }
  for (const [uid, id] of [['alice', OWN_NOTE], ['bob', OTHER_NOTE]]) {
    batch.set(publicNote(CITY, id), { schemaVersion: 1, placeID: CITY, observedAt: OLD, submittedAt: OLD,
      body: 'Synthetic public visitor note', condition: 'usable', soap: 'yes', toiletPaper: 'not-reported', stairs: 'no' });
    batch.set(privateRef(uid, 'restroomReadyPublicNoteReceipts', id), { placeID: CITY, submittedAt: OLD });
  }
  batch.set(ref(`restroomSourceComments/${CITY}/comments/${OTHER_NOTE}`), { body: 'Synthetic imported source note' });
  // A mismatching receipt cannot authorize deletion of somebody else's public observation.
  batch.set(privateRef('alice', 'restroomReadyVisitReceipts', OTHER_VISIT), { placeID: CITY, submittedAt: VERSION });
  batch.set(ref(`restroomSubmissions/${COMMUNITY}`), { ownerUID: 'alice', submittedAt: OLD });
  batch.set(ref(`communityRestrooms/${COMMUNITY}`), { name: 'Emulator-only own listing', address: 'Emulator-only address',
    notes: 'Original public listing text remains anonymous', latitude: 40.75, longitude: -73.98, submittedAt: OLD });
  batch.set(ref(`restroomSubmissions/${OTHER_COMMUNITY}`), { ownerUID: 'bob', submittedAt: OLD });
  batch.set(ref(`communityRestrooms/${OTHER_COMMUNITY}`), { name: 'Emulator-only other listing',
    address: 'Other fixture address', submittedAt: OLD });
  batch.set(ref('users/alice/legacyNested/root/children/deep'), { private: true });
  // Missing parent is intentional: collection.get() would miss this account's vote.
  batch.set(vote('missing-parent', 'alice'), { stars: 2.5, updatedAt: OLD });
  batch.set(vote('missing-parent', 'bob'), { stars: 4, updatedAt: OLD });
  batch.set(summary('malformed-summary'), { ratingCount: 99, ratingSum: 'invalid', updatedAt: OLD });
  batch.set(vote('malformed-summary', 'alice'), { stars: 2.5, updatedAt: OLD });
  batch.set(vote('malformed-summary', 'bob'), { stars: 4.5, updatedAt: OLD });
  await batch.commit();
  // Compare update times as well as payloads: preserved public documents must not be rewritten.
  unchangedSnapshots = await db.getAll(...[
    `communityRestrooms/${COMMUNITY}`, `communityRestrooms/${OTHER_COMMUNITY}`,
    `restroomSubmissions/${OTHER_COMMUNITY}`, `restroomRatingSummaries/${CITY}`,
    `restroomRatingSummaries/${COMMUNITY}`, 'restroomRatingSummaries/missing-parent',
    'restroomRatingSummaries/malformed-summary',
    `restroomPublicNotes/${CITY}/notes/${OTHER_NOTE}`,
    `users/bob/restroomReadyPublicNoteReceipts/${OTHER_NOTE}`,
    `restroomSourceComments/${CITY}/comments/${OTHER_NOTE}`,
    `restroomPasscodeReportsV2/${COMMUNITY}/reports/${OTHER_CODE_V2}`,
    `restroomPasscodeV2Owners/${OTHER_CODE_V2}`,
    `users/bob/restroomReadyPasscodesV2/${OTHER_CODE_V2}`,
  ].map(ref));
}

async function assertPreservedAndUnlinked() {
  for (const path of [
    `restroomPasscodeOwners/${OWN_CODE}`, `restroomPasscodeReports/${CITY}/reports/${OWN_CODE}`,
    `restroomVisitReports/${CITY}/reports/${OWN_VISIT}`, `restroomSubmissions/${COMMUNITY}`,
    `restroomPublicNotes/${CITY}/notes/${OWN_NOTE}`,
    `restroomPasscodeV2Owners/${OWN_CODE_V2}`, `restroomPasscodeReportsV2/${CITY}/reports/${OWN_CODE_V2}`,
    `restroomPasscodeFeedback/${CITY}/codes/v2_${OWN_CODE_V2}`,
    `users/alice/restroomReadySaved/${CITY}`, `users/alice/legacyNested/root/children/deep`,
  ]) assert.equal((await ref(path).get()).exists, false);
  const remaining = await db.listCollections();
  assert.ok(remaining.length > 0);
  assert.equal((await ref('users/alice').listCollections()).length, 0);
  assert.equal((await auth.getUser('bob')).uid, 'bob');
  await assert.rejects(auth.getUser('alice'), error => error.code === 'auth/user-not-found');
  for (const [place, stars] of [[CITY, 4.5], ['missing-parent', 2.5], ['malformed-summary', 2.5]]) {
    assert.equal((await vote(place, 'alice').get()).exists, false);
    const retained = await summary(place).collection('anonymousRatings').get();
    assert.equal(retained.size, 1);
    assert.match(retained.docs[0].id, /^[a-f0-9]{64}$/u);
    assert.deepEqual(retained.docs[0].data(), { stars, updatedAt: OLD });
  }
  assert.equal((await summary(COMMUNITY).collection('anonymousRatings').get()).empty, true);
  assert.deepEqual((await vote(CITY, 'bob').get()).data(), { stars: 3, updatedAt: OLD });
  assert.deepEqual((await vote('missing-parent', 'bob').get()).data(), { stars: 4, updatedAt: OLD });
  for (const original of unchangedSnapshots) {
    const current = await original.ref.get();
    assert.equal(current.exists, original.exists, original.ref.path);
    assert.deepEqual(current.data(), original.data(), original.ref.path);
    if (original.exists) assert.ok(current.updateTime.isEqual(original.updateTime), original.ref.path);
  }
  assert.equal((await db.collection('communityRestrooms').orderBy('submittedAt').get()).size, 2);
  assert.equal((await publicVisit(CITY, OTHER_VISIT).get()).exists, true);
  assert.equal((await privateRef('bob', 'restroomReadyVisitReceipts', OTHER_VISIT).get()).exists, true);
  assert.equal((await publicCode(COMMUNITY, OTHER_CODE).get()).data().lastVerifiedAt, null);
  assert.equal((await privateRef('bob', 'restroomReadyPasscodes', COMMUNITY).get()).data().lastVerifiedAt.isEqual(VERIFIED), true);
  assert.equal((await ref(`restroomPasscodeOwners/${OTHER_CODE}`).get()).data().ownerUID, 'bob');
  assert.equal((await privateRef('bob', 'restroomReadyNotes', 'note').get()).exists, true);
  assert.equal((await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).get()).data().usedCount, 3);
  assert.equal((await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).get()).data().invalidCount, 2);
  assert.equal((await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).get()).data().lastUsedAt, null);
  assert.equal((await codeFeedback(COMMUNITY, 'legacy', OTHER_CODE).get()).data().usedCount, 2);
  assert.equal((await codeFeedback(COMMUNITY, 'legacy', OTHER_CODE).get()).data().invalidCount, 0);
  assert.ok((await codeFeedback(COMMUNITY, 'legacy', OTHER_CODE).get()).data().lastUsedAt.isEqual(VERSION));
}

describe('isolated account deletion using Admin Auth and Firestore emulators', { concurrency: false }, () => {
  before(() => {
    app = initializeApp({ projectId: PROJECT }, 'account-deletion-emulator-tests');
    db = getFirestore(app); auth = getAuth(app);
  });
  beforeEach(async () => {
    clock = Date.now();
    issuedTokens.clear();
    const firestore = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
    assert.equal(firestore.ok, true);
    const authentication = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
    assert.equal(authentication.ok, true);
    await seed();
  });
  after(async () => { await db.terminate(); await deleteApp(app); });

  test('full cleanup removes private identity and retains exact public listings, ratings and summaries', async () => {
    const requestToken = token();
    assert.ok((await db.collection('restroomRatingSummaries').listDocuments()).some(parent => parent.id === 'missing-parent'));
    assert.deepEqual(await service()(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
    const receipt = (await lock('alice').get()).data();
    assert.equal(receipt.phase, 'completed');
    assert.equal(receipt.policyVersion, DELETION_POLICY_VERSION);
    assert.equal(receipt.expiresAt.toMillis(), clock + COMPLETED_RETENTION_MS);
    assert.equal(receipt.leaseOwner, undefined);
    clock += 360_000; // Completed status is still retrievable after the five-minute NEW-job gate.
    assert.deepEqual(await service()(requestToken), { status: 'deleted' });
  });

  test('partial cleanup retries retain exactly one anonymous vote without losing private cleanup', async () => {
    let fail = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'ratings-anonymized' && fail) { fail = false; throw new Error('simulated interruption'); }
    } });
    const requestToken = token();
    await assert.rejects(deletion(requestToken));
    assert.equal((await lock('alice').get()).data().phase, 'pending');
    assert.equal((await lock('alice').get()).data().expiresAt, undefined);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('an interruption immediately after one atomic vote move resumes without duplicates or identity links', async () => {
    let moved = 0;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'rating-anonymized' && ++moved === 1) throw new Error('interrupted after commit');
    } });
    const requestToken = token();
    await assert.rejects(deletion(requestToken));
    assert.equal((await lock('alice').get()).data().phase, 'pending');
    const before = await Promise.all([CITY, 'missing-parent', 'malformed-summary']
      .map(place => summary(place).collection('anonymousRatings').get()));
    assert.equal(before.reduce((count, votes) => count + votes.size, 0), 1);
    const retainedBefore = before.flatMap(votes => votes.docs.map(doc => doc.ref.path));
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
    for (const path of retainedBefore) assert.equal((await ref(path).get()).exists, true);
    const allAnonymous = await db.collectionGroup('anonymousRatings').get();
    assert.equal(new Set(allAnonymous.docs.map(doc => doc.id)).size, 3);
    assert.equal(allAnonymous.size, 3);
  });

  test('a linked Apple account follows the same verified UID cleanup path', async () => {
    await auth.deleteUser('alice');
    const result = await auth.importUsers([{ uid: 'alice', providerData: [{ uid: 'apple-fixture', providerId: 'apple.com' }] }]);
    assert.equal(result.failureCount, 0);
    await allowHistoricalFixtureSession('alice');
    assert.deepEqual(await service()(token('alice', Math.floor(clock / 1000), 'apple.com')), { status: 'deleted' });
    await assertPreservedAndUnlinked();
    assert.equal((await lock('alice').get()).data().provider, 'apple.com');
  });

  test('a signed test token cannot authorize missing-Auth cleanup without a data-deleted/completed receipt', async () => {
    const requestToken = token();
    await auth.deleteUser('alice');
    await assert.rejects(service()(requestToken), error => error.code === 'authentication_required');
    assert.equal((await lock('alice').get()).exists, false);
    await lock('alice').set({ phase: 'pending', provider: 'google.com', sessionAuthTime: Math.floor(clock / 1000),
      leaseOwner: 'fixture', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    await assert.rejects(service()(requestToken), error => error.code === 'authentication_required');
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await vote(CITY, 'bob').get()).exists, true);
  });

  test('an ambiguous response after Auth deletion resumes from the durable data-deleted phase', async () => {
    let fail = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'after-auth-delete' && fail) { fail = false; throw new Error('lost response'); }
    } });
    const requestToken = token();
    await assert.rejects(deletion(requestToken));
    assert.equal((await lock('alice').get()).data().phase, 'data-deleted');
    clock += 360_000;
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('a restarted background worker finishes an already-authorized request without any stored token', async () => {
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'public-pairs-cleaned') throw new Error('simulated process interruption');
    } });
    await assert.rejects(deletion(token()));
    const receipt = (await lock('alice').get()).data();
    assert.equal(receipt.phase, 'pending');
    assert.equal(JSON.stringify(Object.keys(receipt)).includes('token'), false);
    clock += 600_000;
    const restarted = service();
    const worker = recoveryWorker({ db, deletion: restarted, now: () => clock, pageSize: 2, maxPages: 2 });
    await worker.tick(); await worker.stop();
    await assertPreservedAndUnlinked();
    assert.equal((await lock('alice').get()).data().phase, 'completed');
    assert.equal((await lock('bob').get()).exists, false);
  });

  test('same-session requests join one running job while another process is fenced by the active lease', async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    let gatherings = 0;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'gathered') { gatherings++; entered.resolve(); await release.promise; }
    } });
    const requestToken = token();
    const first = deletion(requestToken);
    await entered.promise;
    const joined = deletion(requestToken);
    await assert.rejects(service()(requestToken), error => error instanceof ServiceError && error.status === 409);
    release.resolve();
    assert.deepEqual(await Promise.all([first, joined]), [{ status: 'deleted' }, { status: 'deleted' }]);
    assert.equal(gatherings, 1);
    assert.equal((await summary(CITY).get()).data().ratingSum, 7.5);
  });

  test('new jobs require recent sign-in; fresh reauthentication resumes a pending job and older sessions are rejected', async () => {
    const oldTime = Math.floor(clock / 1000) - 301;
    await assert.rejects(service()(token('alice', oldTime)), error => error.code === 'recent_sign_in_required');
    assert.equal((await lock('alice').get()).exists, false);
    const originalTime = Math.floor(clock / 1000);
    await lock('alice').set({ phase: 'pending', provider: 'google.com', sessionAuthTime: originalTime,
      leaseOwner: 'crashed-worker', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    await assert.rejects(service()(token('alice', originalTime - 1)), error => error.code === 'recent_sign_in_required');
    clock += 600_000;
    assert.deepEqual(await service()(token('alice', Math.floor(clock / 1000))), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('lease takeover fences an expired worker and retention pruning never deletes pending/data-deleted markers', async () => {
    const session = { uid: 'alice', provider: 'google.com', authTime: Math.floor(clock / 1000), authMissing: false };
    const first = new DeletionLease(db, session, { now: () => clock, leaseMs: 1000 });
    const second = new DeletionLease(db, session, { now: () => clock, leaseMs: 1000 });
    await first.acquire();
    await assert.rejects(second.acquire(), error => error.status === 409);
    clock += 1001; await second.acquire();
    await assert.rejects(db.runTransaction(transaction => first.check(transaction)), error => error.status === 409);
    await second.release();
    for (const [uid, phase, expires] of [['pending', 'pending', -1], ['data-deleted', 'data-deleted', -1],
      ['completed-old', 'completed', -1], ['completed-new', 'completed', 1000]]) {
      await lock(uid).set({ phase, expiresAt: Timestamp.fromMillis(clock + expires),
        completedAt: Timestamp.fromMillis(clock - COMPLETED_RETENTION_MS + expires) });
    }
    assert.equal(await pruneCompletedReceipts(db, clock), 1);
    assert.equal((await lock('pending').get()).exists, true);
    assert.equal((await lock('data-deleted').get()).exists, true);
    assert.equal((await lock('completed-old').get()).exists, false);
    assert.equal((await lock('completed-new').get()).exists, true);
    await lock('completed-too-early').set({ phase: 'completed', expiresAt: Timestamp.fromMillis(clock - 1),
      completedAt: Timestamp.fromMillis(clock - 1000) });
    await pruneCompletedReceipts(db, clock);
    assert.equal((await lock('completed-too-early').get()).exists, true);
  });

  test('a malformed other-user vote and summary remain untouched while valid own votes become anonymous', async () => {
    await vote('malformed-summary', 'bob').set({ stars: 99, updatedAt: OLD });
    const original = await vote('malformed-summary', 'bob').get();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    const current = await original.ref.get();
    assert.deepEqual(current.data(), original.data());
    assert.ok(current.updateTime.isEqual(original.updateTime));
    await assertPreservedAndUnlinked();
  });

  test('receipt pruning preserves unsupported policies without blocking eligible legacy and current completions', async () => {
    const cases = [['untagged', undefined], ['legacy', 1], ['preserving-legacy', 2], ['preserving-public-notes', 3], ['preserving-unified', 4], ['current', DELETION_POLICY_VERSION], ['future', DELETION_POLICY_VERSION + 1], ['invalid', null]];
    for (const [uid, policyVersion] of cases) {
      await lock(uid).set({ phase: 'completed', ...(policyVersion === undefined ? {} : { policyVersion }),
        completedAt: Timestamp.fromMillis(clock - COMPLETED_RETENTION_MS - 1),
        expiresAt: Timestamp.fromMillis(clock - 1) });
    }
    assert.equal(await pruneCompletedReceipts(db, clock), 6);
    for (const [uid, policyVersion] of cases) {
      assert.equal((await lock(uid).get()).exists, policyVersion === DELETION_POLICY_VERSION + 1 || policyVersion === null, uid);
    }
  });

  test('a malformed own vote fails closed without copying identity fields or inventing a rating', async () => {
    const bad = { stars: 4, updatedAt: OLD, ownerUID: 'alice', privateText: 'fixture-only' };
    await vote(CITY, 'alice').set(bad);
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.deepEqual((await vote(CITY, 'alice').get()).data(), bad);
    assert.equal((await summary(CITY).collection('anonymousRatings').get()).empty, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.equal((await lock('alice').get()).data().phase, 'pending');
    assert.equal((await lock('alice').get()).data().policyVersion, DELETION_POLICY_VERSION);
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
  });

  test('legacy pending work adopts policy 4 and never reconstructs previously erased public content', async () => {
    await ref(`communityRestrooms/${COMMUNITY}`).set({ removedAt: OLD });
    await vote(CITY, 'alice').delete();
    await summary(CITY).set({ ratingCount: 1, ratingSum: 3, updatedAt: OLD });
    await lock('alice').set({ phase: 'pending', provider: 'google.com', sessionAuthTime: Math.floor(clock / 1000),
      leaseOwner: 'legacy-worker', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.deepEqual((await ref(`communityRestrooms/${COMMUNITY}`).get()).data(), { removedAt: OLD });
    assert.deepEqual((await summary(CITY).get()).data(), { ratingCount: 1, ratingSum: 3, updatedAt: OLD });
    assert.equal((await summary(CITY).collection('anonymousRatings').get()).empty, true);
    assert.equal((await summary('missing-parent').collection('anonymousRatings').get()).size, 1);
    assert.equal((await ref('users/alice').listCollections()).length, 0);
    assert.equal((await lock('alice').get()).data().policyVersion, DELETION_POLICY_VERSION);
  });

  test('legacy data-deleted and completed receipts finish or confirm without replaying public cleanup', async () => {
    let cleanupCalls = 0;
    const deletion = service({ cleanup: async () => { cleanupCalls++; throw new Error('must not replay cleanup'); } });
    const requestToken = token();
    await db.recursiveDelete(ref('users/alice'));
    // Model a valid old data-deleted receipt: that policy already erased these contributions.
    const oldCleanup = db.batch();
    for (const place of [CITY, 'missing-parent', 'malformed-summary']) oldCleanup.delete(vote(place, 'alice'));
    oldCleanup.set(summary(CITY), { ratingCount: 1, ratingSum: 3, updatedAt: OLD });
    oldCleanup.set(summary('missing-parent'), { ratingCount: 1, ratingSum: 4, updatedAt: OLD });
    oldCleanup.set(summary('malformed-summary'), { ratingCount: 1, ratingSum: 4.5, updatedAt: OLD });
    oldCleanup.set(ref(`communityRestrooms/${COMMUNITY}`), { removedAt: OLD });
    oldCleanup.delete(ref(`restroomSubmissions/${COMMUNITY}`));
    oldCleanup.delete(ref(`restroomPasscodeOwners/${OWN_CODE}`));
    oldCleanup.delete(publicCode(CITY, OWN_CODE));
    oldCleanup.delete(publicVisit(CITY, OWN_VISIT));
    oldCleanup.delete(publicNote(CITY, OWN_NOTE));
    await oldCleanup.commit();
    unchangedSnapshots = await Promise.all(unchangedSnapshots.map(original => original.ref.get()));
    await lock('alice').set({ phase: 'data-deleted', policyVersion: 1, provider: 'google.com',
      sessionAuthTime: Math.floor(clock / 1000), leaseOwner: 'legacy-worker',
      leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    assert.equal(cleanupCalls, 0);
    assert.equal((await lock('alice').get()).data().policyVersion, 1);
    assert.equal((await lock('alice').get()).data().phase, 'completed');
    // Also support already-completed original receipts that did not carry a version field.
    await lock('alice').update({ policyVersion: FieldValue.delete() });
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    assert.equal(cleanupCalls, 0);
    for (const original of unchangedSnapshots) {
      const current = await original.ref.get();
      assert.deepEqual(current.data(), original.data());
      if (original.exists) assert.ok(current.updateTime.isEqual(original.updateTime));
    }
  });

  test('unsupported cleanup policy versions cannot start, resume or mutate any account data', async () => {
    await lock('alice').set({ phase: 'pending', policyVersion: 6, provider: 'google.com',
      sessionAuthTime: Math.floor(clock / 1000), leaseOwner: 'future-worker',
      leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    const deletion = service();
    await assert.rejects(deletion(token()), error => error.code === 'deletion_unavailable');
    await assert.rejects(deletion.resume(await lock('alice').get()), error => error.code === 'deletion_unavailable');
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await vote(CITY, 'alice').get()).exists, true);
    assert.equal((await summary(CITY).collection('anonymousRatings').get()).empty, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('public-note pairs commit together and a lost response resumes without leaving public text', async () => {
    let fail = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'public-note-cleaned' && fail) { fail = false; throw new Error('interrupted after atomic note removal'); }
    } });
    const requestToken = token();
    await assert.rejects(deletion(requestToken));
    assert.equal((await publicNote(CITY, OWN_NOTE).get()).exists, false);
    assert.equal((await privateRef('alice', 'restroomReadyPublicNoteReceipts', OWN_NOTE).get()).exists, false);
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('a missing public note clears only its valid ownership receipt and cleanup continues', async () => {
    await publicNote(CITY, OWN_NOTE).delete();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('a vanished ownership receipt with remaining public text fails closed', async () => {
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'gathered') await privateRef('alice', 'restroomReadyPublicNoteReceipts', OWN_NOTE).delete();
    } });
    await assert.rejects(deletion(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await publicNote(CITY, OWN_NOTE).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
  });

  test('mismatched public-note place cannot authorize deletion or discard its receipt', async () => {
    await publicNote(CITY, OWN_NOTE).update({ placeID: COMMUNITY });
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await publicNote(CITY, OWN_NOTE).get()).exists, true);
    assert.equal((await privateRef('alice', 'restroomReadyPublicNoteReceipts', OWN_NOTE).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  for (const [label, change] of [
    ['mismatched timestamp', { placeID: CITY, submittedAt: VERSION }],
    ['malformed timestamp', { placeID: CITY, submittedAt: 'invalid' }],
    ['extra private field', { placeID: CITY, submittedAt: OLD, extra: true }],
    ['unsafe place', { placeID: '../other', submittedAt: OLD }],
  ]) test(`public-note ${label} fails closed before recursive cleanup or Auth removal`, async () => {
    const ownReceipt = privateRef('alice', 'restroomReadyPublicNoteReceipts', OWN_NOTE);
    await ownReceipt.set(change);
    const original = await publicNote(CITY, OWN_NOTE).get();
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.equal((await lock('alice').get()).data().phase, 'pending');
    assert.equal((await ownReceipt.get()).exists, true);
    assert.deepEqual((await publicNote(CITY, OWN_NOTE).get()).data(), original.data());
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await publicNote(CITY, OTHER_NOTE).get()).exists, true);
  });

  test('an expired worker cannot remove a second public note after lease takeover', async () => {
    await publicNote(CITY, SECOND_NOTE).set({ placeID: CITY, submittedAt: OLD, body: 'Second synthetic public note' });
    await privateRef('alice', 'restroomReadyPublicNoteReceipts', SECOND_NOTE).set({ placeID: CITY, submittedAt: OLD });
    let first = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'public-note-cleaned' && first) {
        first = false;
        await lock('alice').update({ leaseOwner: 'new-worker', leaseExpiresAt: Timestamp.fromMillis(clock + 100000) });
      }
    } });
    await assert.rejects(deletion(token()), error => error.code === 'deletion_in_progress');
    assert.equal((await publicNote(CITY, OWN_NOTE).get()).exists, false);
    assert.equal((await publicNote(CITY, SECOND_NOTE).get()).exists, true);
    assert.equal((await privateRef('alice', 'restroomReadyPublicNoteReceipts', SECOND_NOTE).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
  });

  test('policy-2 pending work upgrades to policy 4 and cleans new public-note pairs', async () => {
    await lock('alice').set({ phase: 'pending', policyVersion: 2, provider: 'google.com',
      sessionAuthTime: Math.floor(clock / 1000), leaseOwner: 'old-worker', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.equal((await lock('alice').get()).data().policyVersion, DELETION_POLICY_VERSION);
    await assertPreservedAndUnlinked();
  });

  test('policy-2 data-deleted work finishes without replaying cleanup', async () => {
    let calls = 0;
    const deletion = service({ cleanup: async () => { calls++; throw new Error('must not replay completed cleanup'); } });
    await lock('alice').set({ phase: 'data-deleted', policyVersion: 2, provider: 'google.com',
      sessionAuthTime: Math.floor(clock / 1000), leaseOwner: 'old-worker', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    assert.deepEqual(await deletion(token()), { status: 'deleted' });
    assert.equal(calls, 0);
    assert.equal((await lock('alice').get()).data().phase, 'completed');
    assert.equal((await lock('alice').get()).data().policyVersion, 2);
    assert.equal((await publicNote(CITY, OTHER_NOTE).get()).exists, true);
  });

  test('another version or later verifier is preserved; a fake private code cannot delete another owner reservation', async () => {
    await publicCode(COMMUNITY, OTHER_CODE).update({ lastVerifiedAt: Timestamp.fromMillis(VERIFIED.toMillis() + 1) });
    await privateRef('alice', 'restroomReadyPasscodes', 'fake-reference').set({ placeID: COMMUNITY, reportID: OTHER_CODE });
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.equal((await publicCode(COMMUNITY, OTHER_CODE).get()).data().lastVerifiedAt.toMillis(), VERIFIED.toMillis() + 1);
    assert.equal((await ref(`restroomPasscodeOwners/${OTHER_CODE}`).get()).data().ownerUID, 'bob');
  });

  test('V2 owned-code pairs and feedback are atomically removed and retry cannot double-decrement', async () => {
    let fail = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'passcode-feedback-cleaned' && fail) { fail = false; throw new Error('lost cleanup response'); }
    } });
    const requestToken = token();
    await assert.rejects(deletion(requestToken));
    assert.equal((await publicCodeV2(CITY, OWN_CODE_V2).get()).exists, false);
    assert.equal((await ref(`restroomPasscodeV2Owners/${OWN_CODE_V2}`).get()).exists, false);
    assert.equal((await codeFeedback(CITY, 'v2', OWN_CODE_V2).get()).exists, false);
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('a V2 own record without its global reservation fails closed before any recursive cleanup', async () => {
    await ref(`restroomPasscodeV2Owners/${OWN_CODE_V2}`).delete();
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await publicCodeV2(CITY, OWN_CODE_V2).get()).exists, true);
    assert.equal((await privateRef('alice', 'restroomReadyPasscodesV2', OWN_CODE_V2).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('a missing V2 own record preserves its recovery reservation and public code', async () => {
    await privateRef('alice', 'restroomReadyPasscodesV2', OWN_CODE_V2).delete();
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await publicCodeV2(CITY, OWN_CODE_V2).get()).exists, true);
    assert.equal((await ref(`restroomPasscodeV2Owners/${OWN_CODE_V2}`).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('a vanished V2 reservation after gathering cannot orphan its public projection', async () => {
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'gathered') await ref(`restroomPasscodeV2Owners/${OWN_CODE_V2}`).delete();
    } });
    await assert.rejects(deletion(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await publicCodeV2(CITY, OWN_CODE_V2).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('a fake V2 own pointer cannot erase another account code or reservation', async () => {
    const other = (await privateRef('bob', 'restroomReadyPasscodesV2', OTHER_CODE_V2).get()).data();
    await privateRef('alice', 'restroomReadyPasscodesV2', OTHER_CODE_V2).set(other);
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await publicCodeV2(COMMUNITY, OTHER_CODE_V2).get()).exists, true);
    assert.equal((await ref(`restroomPasscodeV2Owners/${OTHER_CODE_V2}`).get()).data().ownerUID, 'bob');
  });

  test('stale legacy feedback receipts are removed without altering the newer aggregate', async () => {
    await codeVote('alice', COMMUNITY, 'legacy', OTHER_CODE).update({ codeUpdatedAt: OLD });
    const before = await codeFeedback(COMMUNITY, 'legacy', OTHER_CODE).get();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    const after = await codeFeedback(COMMUNITY, 'legacy', OTHER_CODE).get();
    assert.deepEqual(after.data(), before.data()); assert.ok(after.updateTime.isEqual(before.updateTime));
  });

  test('feedback whose summary disappeared clears only the private receipt', async () => {
    await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).delete();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.equal((await codeVote('alice', COMMUNITY, 'v2', OTHER_CODE_V2).get()).exists, false);
    assert.equal((await publicCodeV2(COMMUNITY, OTHER_CODE_V2).get()).exists, true);
  });

  test('a later Used time from another visitor is retained during current-user vote cleanup', async () => {
    const later = Timestamp.fromMillis(VERIFIED.toMillis() + 1);
    await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).update({ lastUsedAt: later, updatedAt: later });
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    const after = (await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).get()).data();
    assert.equal(after.usedCount, 3); assert.ok(after.lastUsedAt.isEqual(later));
  });

  for (const [label, patch] of [
    ['extra identity', { uid: 'alice' }], ['wrong report', { reportID: OWN_CODE_V2 }],
    ['wrong place', { placeID: CITY }], ['bad vote', { vote: 'both' }], ['bad timestamp', { updatedAt: 'bad' }],
  ]) test(`malformed feedback receipt ${label} fails closed before identity deletion`, async () => {
    await codeVote('alice', COMMUNITY, 'v2', OTHER_CODE_V2).update(patch);
    const before = (await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).get()).data();
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.deepEqual((await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).get()).data(), before);
    assert.equal((await codeVote('alice', COMMUNITY, 'v2', OTHER_CODE_V2).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('feedback underflow fails closed and preserves the recovery receipt', async () => {
    await codeFeedback(COMMUNITY, 'v2', OTHER_CODE_V2).update({ usedCount: 0 });
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await codeVote('alice', COMMUNITY, 'v2', OTHER_CODE_V2).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('lease takeover prevents removing a second immutable V2 report', async () => {
    await ref(`restroomPasscodeV2Owners/${SECOND_CODE_V2}`).set({ ownerUID: 'alice', placeID: CITY, createdAt: VERSION });
    await privateRef('alice', 'restroomReadyPasscodesV2', SECOND_CODE_V2).set({ placeID: CITY, code: 'second-fixture',
      visibility: 'public', createdAt: VERSION, codeUpdatedAt: VERSION, lastVerifiedAt: null });
    await publicCodeV2(CITY, SECOND_CODE_V2).set({ placeID: CITY, code: 'second-fixture', codeUpdatedAt: VERSION });
    let once = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'passcode-v2-cleaned' && once) {
        once = false; await lock('alice').update({ leaseOwner: 'new-worker', leaseExpiresAt: Timestamp.fromMillis(clock + 100000) });
      }
    } });
    await assert.rejects(deletion(token()), error => error.code === 'deletion_in_progress');
    assert.equal((await publicCodeV2(CITY, OWN_CODE_V2).get()).exists, false);
    assert.equal((await publicCodeV2(CITY, SECOND_CODE_V2).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('policy 4 removes named and anonymous unified observations before private identity while preserving other owners', async () => {
    await seedUnifiedVisit();
    await seedUnifiedVisit('alice', SECOND_UNIFIED_VISIT, { anonymous: true, codeReportID: OWN_CODE_V2 });
    await seedUnifiedVisit('bob', OTHER_UNIFIED_VISIT);
    const otherPublic = await unifiedVisit(CITY, OTHER_UNIFIED_VISIT).get();
    const otherPrivate = await unifiedReceipt('bob', OTHER_UNIFIED_VISIT).get();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    for (const id of [OWN_UNIFIED_VISIT, SECOND_UNIFIED_VISIT]) {
      assert.equal((await unifiedVisit(CITY, id).get()).exists, false);
      assert.equal((await unifiedReceipt('alice', id).get()).exists, false);
    }
    for (const original of [otherPublic, otherPrivate]) {
      const current = await original.ref.get();
      assert.deepEqual(current.data(), original.data());
      assert.ok(current.updateTime.isEqual(original.updateTime));
    }
    await assertPreservedAndUnlinked();
  });

  test('independently removed linked code cannot strand a public unified name or comment', async () => {
    await seedUnifiedVisit('alice', OWN_UNIFIED_VISIT, { codeReportID: OWN_CODE_V2 });
    const batch = db.batch();
    for (const target of [publicCodeV2(CITY, OWN_CODE_V2), ref(`restroomPasscodeV2Owners/${OWN_CODE_V2}`),
      privateRef('alice', 'restroomReadyPasscodesV2', OWN_CODE_V2), codeFeedback(CITY, 'v2', OWN_CODE_V2)]) batch.delete(target);
    await batch.commit();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.equal((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).exists, false);
    await assertPreservedAndUnlinked();
  });

  test('a missing unified public document clears only its valid private receipt', async () => {
    await seedUnifiedVisit();
    await unifiedVisit(CITY, OWN_UNIFIED_VISIT).delete();
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.equal((await unifiedReceipt('alice', OWN_UNIFIED_VISIT).get()).exists, false);
    await assertPreservedAndUnlinked();
  });

  for (const [label, patch] of [
    ['wrong timestamp', { submittedAt: VERSION }], ['invalid timestamp', { submittedAt: 'invalid' }],
    ['unsafe place', { placeID: '../other' }], ['invalid linked ID', { codeReportID: 'invalid' }],
    ['extra private identity', { ownerUID: 'alice' }],
  ]) test(`unified receipt ${label} fails closed before recursive private or Auth cleanup`, async () => {
    await seedUnifiedVisit();
    await unifiedReceipt('alice', OWN_UNIFIED_VISIT).update(patch);
    const original = await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get();
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await unifiedReceipt('alice', OWN_UNIFIED_VISIT).get()).exists, true);
    assert.deepEqual((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).data(), original.data());
    assert.ok((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).updateTime.isEqual(original.updateTime));
    assert.equal((await lock('alice').get()).data().phase, 'pending');
  });

  test('a unified public place mismatch preserves the public name and its recovery receipt', async () => {
    await seedUnifiedVisit();
    await unifiedVisit(CITY, OWN_UNIFIED_VISIT).update({ placeID: COMMUNITY });
    await assert.rejects(service()(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).exists, true);
    assert.equal((await unifiedReceipt('alice', OWN_UNIFIED_VISIT).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('a vanished unified receipt cannot orphan its remaining public name or comment', async () => {
    await seedUnifiedVisit();
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'gathered') await unifiedReceipt('alice', OWN_UNIFIED_VISIT).delete();
    } });
    await assert.rejects(deletion(token()), error => error.code === 'deletion_unavailable');
    assert.equal((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
  });

  test('lost acknowledgement after atomic unified removal resumes without recreating its public text', async () => {
    await seedUnifiedVisit();
    let once = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'unified-visit-cleaned' && once) { once = false; throw new Error('lost atomic unified cleanup response'); }
    } });
    const requestToken = token();
    await assert.rejects(deletion(requestToken));
    assert.equal((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).exists, false);
    assert.equal((await unifiedReceipt('alice', OWN_UNIFIED_VISIT).get()).exists, false);
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
    assert.deepEqual(await deletion(requestToken), { status: 'deleted' });
    await assertPreservedAndUnlinked();
  });

  test('lease takeover fences the next unified observation before private identity is removed', async () => {
    await seedUnifiedVisit();
    await seedUnifiedVisit('alice', SECOND_UNIFIED_VISIT);
    let once = true;
    const deletion = service({ checkpoint: async phase => {
      if (phase === 'unified-visit-cleaned' && once) {
        once = false;
        await lock('alice').update({ leaseOwner: 'replacement-worker', leaseExpiresAt: Timestamp.fromMillis(clock + 100000) });
      }
    } });
    await assert.rejects(deletion(token()), error => error.code === 'deletion_in_progress');
    assert.equal((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).exists, false);
    assert.equal((await unifiedVisit(CITY, SECOND_UNIFIED_VISIT).get()).exists, true);
    assert.equal((await unifiedReceipt('alice', SECOND_UNIFIED_VISIT).get()).exists, true);
    assert.equal((await privateRef('alice', 'restroomReadyNotes', 'note').get()).exists, true);
    assert.equal((await auth.getUser('alice')).uid, 'alice');
  });

  test('pending policy 3 upgrades to policy 4 and removes new public names before private cleanup', async () => {
    await seedUnifiedVisit();
    await lock('alice').set({ phase: 'pending', policyVersion: 3, provider: 'google.com',
      sessionAuthTime: Math.floor(clock / 1000), leaseOwner: 'old-policy-worker', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    assert.deepEqual(await service()(token()), { status: 'deleted' });
    assert.equal((await lock('alice').get()).data().policyVersion, DELETION_POLICY_VERSION);
    assert.equal((await unifiedVisit(CITY, OWN_UNIFIED_VISIT).get()).exists, false);
    await assertPreservedAndUnlinked();
  });

  test('data-deleted policy 3 finishes without replaying already completed public cleanup', async () => {
    let cleanupCalls = 0;
    const deletion = service({ cleanup: async () => { cleanupCalls++; throw new Error('completed policy 3 must not replay'); } });
    await lock('alice').set({ phase: 'data-deleted', policyVersion: 3, provider: 'google.com',
      sessionAuthTime: Math.floor(clock / 1000), leaseOwner: 'old-policy-worker', leaseExpiresAt: Timestamp.fromMillis(0), createdAt: OLD });
    assert.deepEqual(await deletion(token()), { status: 'deleted' });
    assert.equal(cleanupCalls, 0);
    assert.equal((await lock('alice').get()).data().phase, 'completed');
    assert.equal((await lock('alice').get()).data().policyVersion, 3);
  });
});
