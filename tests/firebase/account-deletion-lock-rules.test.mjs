import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp,
  updateDoc, where, writeBatch,
} from 'firebase/firestore';

const PROJECT = 'demo-restroom-account-deletion-lock';
const PLACE = 'i7jb-7jku:row-deletion-lock';
const SECOND = 'i7jb-7jku:second-deletion-lock';
const THIRD = 'i7jb-7jku:third-deletion-lock';
const COMMUNITY = 'community-ABCDEFGHIJKLMNOPQRST';
const NEW_COMMUNITY = 'community-abcdefghijklmnopqrst';
const ALICE_CODE = 'AAAAAAAAAAAAAAAAAAAA';
const BOB_CODE = 'BBBBBBBBBBBBBBBBBBBB';
const NEW_CODE = 'CCCCCCCCCCCCCCCCCCCC';
const NOTE = 'NNNNNNNNNNNNNNNNNNNN';
const NEW_NOTE = 'OOOOOOOOOOOOOOOOOOOO';
const VISIT = 'VisitObservation0001';
const NEW_VISIT = 'VisitObservation0002';
const OLD = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
let env, alice, bob, out, guest, adminClaim;
const lock = (db, uid = 'alice') => doc(db, 'accountDeletionLocks', uid);
const saved = (db, uid = 'alice', place = PLACE) => doc(db, 'users', uid, 'restroomReadySaved', place);
const note = (db, uid = 'alice', id = NOTE) => doc(db, 'users', uid, 'restroomReadyNotes', id);
const ownCode = (db, uid = 'alice', place = PLACE) => doc(db, 'users', uid, 'restroomReadyPasscodes', place);
const codeOwner = (db, id = ALICE_CODE) => doc(db, 'restroomPasscodeOwners', id);
const publicCode = (db, id = ALICE_CODE, place = PLACE) => doc(db, 'restroomPasscodeReports', place, 'reports', id);
const codeCheck = (db, uid = 'alice', id = BOB_CODE) => doc(db, 'users', uid, 'restroomReadyPasscodeChecks', id);
const summary = (db, place = PLACE) => doc(db, 'restroomRatingSummaries', place);
const vote = (db, uid = 'alice') => doc(summary(db), 'ratings', uid);
const visit = (db, id = VISIT) => doc(db, 'restroomVisitReports', PLACE, 'reports', id);
const visitReceipt = (db, uid = 'alice', id = VISIT) => doc(db, 'users', uid, 'restroomReadyVisitReceipts', id);
const listing = (db, id = COMMUNITY) => doc(db, 'communityRestrooms', id);
const submission = (db, id = COMMUNITY) => doc(db, 'restroomSubmissions', id);
const noteFields = () => ({ placeID: PLACE, observedAt: OLD, submittedAt: serverTimestamp(),
  condition: 'not-reported', soap: 'not-reported', toiletPaper: 'not-reported', stairs: 'not-reported', entryNote: '' });
const visitFields = () => ({ placeID: PLACE, observedAt: OLD, submittedAt: serverTimestamp(),
  entryRule: 'not-reported', purchaseRequired: 'not-reported', codeRequired: 'not-reported',
  stairs: 'not-reported', soap: 'yes', toiletPaper: 'not-reported', floor: 'not-reported', condition: 'not-reported' });
const listingFields = () => ({ name: 'Emulator-only library', address: '1 Broadway, New York, NY',
  latitude: 40.75, longitude: -73.98, locationType: 'library', entryRule: 'unknown',
  stepFreeAccess: 'unknown', passcodeRequired: 'unknown', notes: '', observedOn: null, submittedAt: serverTimestamp() });

async function administrativeLock(data = { startedAt: OLD }) {
  await env.withSecurityRulesDisabled(ctx => setDoc(lock(ctx.firestore()), data));
}
function rate(db, uid, stars, count, sum) {
  const batch = writeBatch(db);
  batch.set(summary(db), { ratingCount: count, ratingSum: sum, updatedAt: serverTimestamp() });
  if (stars === null) batch.delete(vote(db, uid));
  else batch.set(vote(db, uid), { stars, updatedAt: serverTimestamp() });
  return batch.commit();
}
function createCode(db, uid, place = SECOND) {
  const batch = writeBatch(db);
  batch.set(ownCode(db, uid, place), { placeID: place, reportID: NEW_CODE, code: 'Test-code',
    visibility: 'private', createdAt: serverTimestamp(), codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null });
  batch.set(codeOwner(db, NEW_CODE), { ownerUID: uid, placeID: place, createdAt: serverTimestamp() });
  batch.set(saved(db, uid, place), { placeID: place, savedAt: serverTimestamp() });
  return batch.commit();
}
function verifyCode(db, uid, id = BOB_CODE, place = SECOND) {
  const batch = writeBatch(db);
  batch.update(publicCode(db, id, place), { lastVerifiedAt: serverTimestamp() });
  batch.set(codeCheck(db, uid, id), { placeID: place, codeUpdatedAt: OLD, verifiedAt: serverTimestamp() });
  return batch.commit();
}
function createVisit(db, uid) {
  const batch = writeBatch(db);
  batch.set(visit(db, NEW_VISIT), visitFields());
  batch.set(visitReceipt(db, uid, NEW_VISIT), { placeID: PLACE, submittedAt: serverTimestamp() });
  return batch.commit();
}
function createCommunity(db, uid) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', uid, 'restroomReadySubmissionRequests', NEW_COMMUNITY), {
    schemaVersion: 1, status: 'pending', revision: 1, submittedAt: serverTimestamp(), listing: listingFields(), codeDraft: null,
  });
  batch.set(submission(db, NEW_COMMUNITY), { ownerUID: uid, submittedAt: serverTimestamp() });
  return batch.commit();
}

describe('server-owned account deletion locks', { concurrency: false }, () => {
  before(async () => {
    setLogLevel('silent');
    const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8208'}`);
    env = await initializeTestEnvironment({ projectId: PROJECT, firestore: {
      host: endpoint.hostname, port: Number(endpoint.port),
      rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
    } });
    alice = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    bob = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'apple.com' } }).firestore();
    guest = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
    adminClaim = env.authenticatedContext('claimed-admin', { admin: true, firebase: { sign_in_provider: 'google.com' } }).firestore();
    out = env.unauthenticatedContext().firestore();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async ctx => {
      const db = ctx.firestore(), batch = writeBatch(db);
      batch.set(summary(db), { ratingCount: 1, ratingSum: 4, updatedAt: OLD });
      for (const id of [SECOND, THIRD, COMMUNITY]) batch.set(summary(db, id), { ratingCount: 0, ratingSum: 0, updatedAt: OLD });
      batch.set(vote(db), { stars: 4, updatedAt: OLD });
      for (const uid of ['alice', 'bob']) {
        batch.set(saved(db, uid), { placeID: PLACE, savedAt: OLD });
        batch.set(note(db, uid), { ...noteFields(), submittedAt: OLD });
      }
      for (const [uid, id, place] of [['alice', ALICE_CODE, PLACE], ['bob', BOB_CODE, SECOND]]) {
        const own = { placeID: place, reportID: id, code: 'Emulator-code', visibility: 'public', createdAt: OLD, codeUpdatedAt: OLD, lastVerifiedAt: null };
        batch.set(ownCode(db, uid, place), own);
        batch.set(codeOwner(db, id), { ownerUID: uid, placeID: place, createdAt: OLD });
        batch.set(publicCode(db, id, place), { placeID: place, code: own.code, codeUpdatedAt: OLD, lastVerifiedAt: null });
      }
      batch.set(codeCheck(db), { placeID: SECOND, codeUpdatedAt: OLD, verifiedAt: OLD });
      batch.set(visit(db), { ...visitFields(), submittedAt: OLD });
      batch.set(visitReceipt(db), { placeID: PLACE, submittedAt: OLD });
      batch.set(listing(db), { ...listingFields(), submittedAt: OLD });
      batch.set(submission(db), { ownerUID: 'alice', submittedAt: OLD });
      batch.set(doc(db, 'restroomAccessDetails', PLACE), { schemaVersion: 1, placeID: PLACE,
        restroomHours: null, entranceLocation: null, entranceStepFree: 'unknown', stairFreeRoute: 'unknown',
        elevatorToRestroom: 'unknown', elevatorNote: null, restroomFloor: null, stairsAfterEntry: null,
        sourceTitle: 'Emulator-only report', reportedAt: OLD, observedOn: null, updatedAt: OLD, limitations: 'Emulator test only.' });
      await batch.commit();
    });
  });
  after(async () => {
    if (env) { try { await env.clearFirestore(); } finally { await env.cleanup(); } }
  });

  test('the same already-authenticated client loses private access when an administrator inserts its lock', async () => {
    await assertSucceeds(getDocFromServer(saved(alice)));
    await assertSucceeds(getDocsFromServer(collection(alice, 'users', 'alice', 'restroomReadyNotes')));
    await administrativeLock();
    for (const ref of [saved(alice), note(alice), ownCode(alice), vote(alice), codeOwner(alice), codeCheck(alice), visitReceipt(alice), submission(alice)]) {
      await assertFails(getDocFromServer(ref));
    }
    for (const name of ['restroomReadySaved', 'restroomReadyNotes', 'restroomReadyPasscodes']) {
      await assertFails(getDocsFromServer(collection(alice, 'users', 'alice', name)));
    }
  });

  test('locked sessions cannot create, replace or delete saves and notes', async () => {
    await administrativeLock();
    for (const place of [PLACE, SECOND]) await assertFails(setDoc(saved(alice, 'alice', place), { placeID: place, savedAt: serverTimestamp() }));
    await assertFails(deleteDoc(saved(alice)));
    await assertFails(setDoc(note(alice, 'alice', NEW_NOTE), noteFields()));
    await assertFails(deleteDoc(note(alice)));
  });

  test('locked paired rating updates and removals fail without changing the public aggregate', async () => {
    await administrativeLock();
    await assertFails(rate(alice, 'alice', 5, 1, 5));
    await assertFails(rate(alice, 'alice', null, 0, 0));
    assert.equal((await getDocFromServer(summary(out))).data().ratingSum, 4);
    await assertSucceeds(rate(bob, 'bob', 3, 2, 7));
    assert.equal((await getDocFromServer(summary(out))).data().ratingCount, 2);
  });

  test('locked code creation and version-pinned verification fail while another account still contributes', async () => {
    await administrativeLock();
    await assertFails(createCode(alice, 'alice'));
    await assertFails(verifyCode(alice, 'alice'));
    await assertSucceeds(createCode(bob, 'bob', THIRD));
    await assertSucceeds(verifyCode(bob, 'bob', ALICE_CODE, PLACE));
    assert.ok((await getDocFromServer(publicCode(out))).data().lastVerifiedAt instanceof Timestamp);
  });

  test('locked code edits and paired owner deletion are denied', async () => {
    await administrativeLock();
    const before = { placeID: PLACE, reportID: ALICE_CODE, code: 'Changed-code', visibility: 'public', createdAt: OLD, codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null };
    const edit = writeBatch(alice);
    edit.set(ownCode(alice), before);
    edit.set(publicCode(alice), { placeID: PLACE, code: before.code, codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null });
    await assertFails(edit.commit());
    const remove = writeBatch(alice);
    for (const ref of [ownCode(alice), codeOwner(alice), publicCode(alice)]) remove.delete(ref);
    await assertFails(remove.commit());
    assert.equal((await getDocFromServer(publicCode(out))).exists(), true);
  });

  test('locked public observation creation and paired removal are denied', async () => {
    await administrativeLock();
    await assertFails(createVisit(alice, 'alice'));
    const remove = writeBatch(alice);
    remove.delete(visit(alice)); remove.delete(visitReceipt(alice));
    await assertFails(remove.commit());
    await assertSucceeds(createVisit(bob, 'bob'));
    assert.equal((await getDocFromServer(visit(out))).exists(), true);
  });

  test('locked private requests fail atomically and an unlocked account can still request review', async () => {
    await administrativeLock();
    await assertFails(createCommunity(alice, 'alice'));
    assert.equal((await getDocFromServer(listing(out, NEW_COMMUNITY))).exists(), false);
    await assertSucceeds(createCommunity(bob, 'bob'));
    assert.equal((await getDocFromServer(listing(out, NEW_COMMUNITY))).exists(), false);
    assert.equal((await getDocFromServer(doc(bob, 'users', 'bob', 'restroomReadySubmissionRequests', NEW_COMMUNITY))).data().status, 'pending');
  });

  test('public reads remain available to locked, unlocked and signed-out visitors', async () => {
    await administrativeLock();
    for (const db of [alice, bob, out]) {
      for (const ref of [summary(db), listing(db), publicCode(db), visit(db), doc(db, 'restroomAccessDetails', PLACE)]) await assertSucceeds(getDocFromServer(ref));
      await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomRatingSummaries'), where('ratingCount', '>', 0))));
      await assertSucceeds(getDocsFromServer(query(collection(db, 'communityRestrooms'), orderBy('submittedAt', 'desc'), limit(1000))));
      await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomPasscodeReports', PLACE, 'reports'), orderBy('codeUpdatedAt', 'desc'), limit(10))));
      await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomVisitReports', PLACE, 'reports'), orderBy('observedAt', 'desc'), limit(10))));
      await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomAccessDetails'), limit(1000))));
    }
  });

  test('an unlocked account retains its private CRUD without gaining access to the locked account', async () => {
    await administrativeLock();
    await assertSucceeds(getDocFromServer(saved(bob, 'bob')));
    await assertSucceeds(setDoc(saved(bob, 'bob', SECOND), { placeID: SECOND, savedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(note(bob, 'bob', NEW_NOTE), noteFields()));
    await assertSucceeds(deleteDoc(note(bob, 'bob', NEW_NOTE)));
    await assertFails(getDocFromServer(saved(bob)));
    await assertFails(getDocFromServer(note(bob)));
    await assertFails(deleteDoc(saved(bob)));
  });

  test('no client can inspect, forge, edit or delete locks, including one with a custom admin claim', async () => {
    await administrativeLock();
    for (const db of [alice, bob, guest, out, adminClaim]) {
      await assertFails(getDocFromServer(lock(db)));
      await assertFails(getDocsFromServer(query(collection(db, 'accountDeletionLocks'), limit(1))));
      await assertFails(setDoc(lock(db, 'new-lock'), { startedAt: serverTimestamp() }));
      await assertFails(updateDoc(lock(db), { startedAt: serverTimestamp() }));
      await assertFails(deleteDoc(lock(db)));
      await assertFails(setDoc(doc(db, 'accountDeletionLocks', 'alice', 'overrides', 'unlock'), { enabled: false }));
    }
  });

  test('locks do not widen owner-only receipt lists or collection-group reads', async () => {
    await administrativeLock();
    for (const db of [alice, bob, out]) {
      for (const name of ['restroomReadyPasscodeChecks', 'restroomReadyVisitReceipts']) {
        await assertFails(getDocsFromServer(query(collection(db, 'users', 'bob', name), limit(10))));
      }
      await assertFails(getDocsFromServer(query(collection(db, 'restroomSubmissions'), limit(10))));
      await assertFails(getDocsFromServer(query(collectionGroup(db, 'ratings'), limit(10))));
      await assertFails(getDocsFromServer(query(collectionGroup(db, 'restroomReadySaved'), limit(10))));
    }
  });

  test('an expired or malformed server marker still locks by existence until administrative removal', async () => {
    await administrativeLock({ expiresAt: OLD, status: 'complete', ownerUID: 'bob' });
    await assertFails(setDoc(saved(alice, 'alice', SECOND), { placeID: SECOND, savedAt: serverTimestamp() }));
    await env.withSecurityRulesDisabled(ctx => deleteDoc(lock(ctx.firestore())));
    await assertSucceeds(setDoc(saved(alice, 'alice', SECOND), { placeID: SECOND, savedAt: serverTimestamp() }));
    await assertFails(getDocFromServer(saved(alice, 'bob')));
  });
});
