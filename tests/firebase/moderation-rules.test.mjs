import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit,
  orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PLACE = 'i7jb-7jku:moderation-test', OTHER_PLACE = 'i7jb-7jku:moderation-other';
const ID = 'community-ABCDEFGHIJKLMNOPQRST', OTHER_ID = 'community-abcdefghijklmnopqrst';
const NOTE = 'ModerationNoteTest01', SECOND_NOTE = 'ModerationNoteTest02';
const OLD = Timestamp.fromDate(new Date('2026-01-01T00:00:00Z'));
let env, alice, bob, apple, reader, guest, claimedModerator;
const request = (db, uid = 'alice', id = ID) => doc(db, 'users', uid, 'restroomReadySubmissionRequests', id);
const reservation = (db, id = ID) => doc(db, 'restroomSubmissions', id);
const listing = (db, id = ID) => doc(db, 'communityRestrooms', id);
const rating = (db, id = ID) => doc(db, 'restroomRatingSummaries', id);
const candidate = () => ({ name: 'Synthetic test restroom', address: '1 Broadway, New York, NY',
  latitude: 40.75, longitude: -73.98, locationType: 'library', entryRule: 'unknown',
  stepFreeAccess: 'unknown', passcodeRequired: 'unknown', notes: '', observedOn: null, submittedAt: serverTimestamp() });
const fields = () => ({ schemaVersion: 1, status: 'pending', revision: 1,
  submittedAt: serverTimestamp(), listing: candidate(), codeDraft: null });

function submit(db, { uid = 'alice', id = ID, data = {}, venue = {}, proof = {}, omit = [], extra = [] } = {}) {
  const batch = writeBatch(db);
  if (!omit.includes('request')) batch.set(request(db, uid, id), { ...fields(), listing: { ...candidate(), ...venue }, ...data });
  if (!omit.includes('reservation')) batch.set(reservation(db, id), { ownerUID: uid, submittedAt: serverTimestamp(), ...proof });
  for (const [ref, value] of extra) batch.set(ref, value);
  return batch.commit();
}

const paths = kind => kind === 'public-note'
  ? { parent: 'restroomPublicNotes', child: 'notes', receipt: 'restroomReadyPublicNoteReceipts', marker: 'publicNotes', text: 'body' }
  : { parent: 'restroomUnifiedVisits', child: 'reports', receipt: 'restroomReadyUnifiedVisitReceipts', marker: 'unifiedVisits', text: 'comment' };
const comment = (db, kind, id = NOTE, place = PLACE) => doc(db, paths(kind).parent, place, paths(kind).child, id);
const ownership = (db, kind, id = NOTE, uid = 'alice') => doc(db, 'users', uid, paths(kind).receipt, id);
const marker = (db, kind, id = NOTE, place = PLACE) => doc(db, 'restroomModerationRemovals', place, paths(kind).marker, id);
function commentFields(kind, overrides = {}) {
  const base = { schemaVersion: 1, placeID: PLACE, observedAt: OLD, submittedAt: serverTimestamp(),
    condition: 'not-reported', soap: 'not-reported', toiletPaper: 'not-reported', stairs: 'not-reported' };
  return kind === 'public-note' ? { ...base, body: 'Synthetic visitor text.', ...overrides }
    : { ...base, entryRule: 'not-reported', purchaseRequired: 'not-reported', codeRequired: 'not-reported',
      floor: 'not-reported', comment: 'Synthetic visitor text.', anonymous: true, authorName: null, ...overrides };
}
function createComment(db, kind, { id = NOTE, uid = 'alice', data = {} } = {}) {
  const batch = writeBatch(db);
  batch.set(comment(db, kind, id), commentFields(kind, data));
  batch.set(ownership(db, kind, id, uid), { placeID: PLACE, submittedAt: serverTimestamp(),
    ...(kind === 'unified-visit' ? { codeReportID: null } : {}) });
  return batch.commit();
}
function removeComment(db, kind, id = NOTE) {
  const batch = writeBatch(db); batch.delete(comment(db, kind, id)); batch.delete(ownership(db, kind, id)); return batch.commit();
}

before(async () => {
  setLogLevel('silent');
  const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8185'}`);
  assert.ok(['127.0.0.1', 'localhost'].includes(endpoint.hostname), 'Rules tests require a local emulator.');
  env = await initializeTestEnvironment({ projectId: 'demo-restroom-moderation-rules', firestore: {
    host: endpoint.hostname, port: Number(endpoint.port), rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') } });
  alice = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  bob = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  apple = env.authenticatedContext('apple', { firebase: { sign_in_provider: 'apple.com' } }).firestore();
  guest = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  claimedModerator = env.authenticatedContext('claimedModerator', { admin: true, moderator: true, firebase: { sign_in_provider: 'google.com' } }).firestore();
  reader = env.unauthenticatedContext().firestore();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c => {
    const b = writeBatch(c.firestore());
    for (const p of [PLACE, OTHER_PLACE]) b.set(rating(c.firestore(), p), { ratingCount: 0, ratingSum: 0, updatedAt: OLD });
    await b.commit();
  });
});
after(async () => { if (env) { try { await env.clearFirestore(); } finally { await env.cleanup(); } } });

test('Google creates a private pending request and exact reservation, with no public projection', async () => {
  await assertSucceeds(submit(alice));
  const pending = (await getDocFromServer(request(alice))).data(), proof = (await getDocFromServer(reservation(alice))).data();
  assert.deepEqual(Object.keys(pending).sort(), Object.keys(fields()).sort());
  assert.equal(pending.status, 'pending'); assert.equal(pending.revision, 1);
  assert.ok(pending.submittedAt.isEqual(pending.listing.submittedAt)); assert.ok(pending.submittedAt.isEqual(proof.submittedAt));
  assert.deepEqual(Object.keys(proof).sort(), ['ownerUID', 'submittedAt']);
  assert.equal((await getDocFromServer(listing(reader))).exists(), false);
  await env.withSecurityRulesDisabled(async c => assert.equal((await getDocFromServer(rating(c.firestore()))).exists(), false));
});
test('Apple requests and missing owner retry reads are supported', async () => {
  assert.equal((await getDocFromServer(request(apple, 'apple'))).exists(), false);
  assert.equal((await getDocFromServer(reservation(apple))).exists(), false);
  await assertSucceeds(submit(apple, { uid: 'apple' }));
});
for (const visibility of ['private', 'public']) test(`a ${visibility} code stays solely in the owner-private pending request`, async () => {
  await submit(alice, { venue: { passcodeRequired: 'yes' }, data: { codeDraft: { code: '0012#', visibility } } });
  assert.deepEqual((await getDocFromServer(request(alice))).data().codeDraft, { code: '0012#', visibility });
  for (const db of [reader, bob, guest, claimedModerator]) await assertFails(getDocFromServer(request(db)));
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    for (const p of [`users/alice/restroomReadySaved/${ID}`, `users/alice/restroomReadyPasscodes/${ID}`,
      `restroomPasscodeReports/${ID}/reports/${NOTE}`, `restroomRatingSummaries/${ID}`]) assert.equal((await getDocFromServer(doc(db, p))).exists(), false);
  });
});
test('owner history is bounded and private; group queries cannot use claimed moderator privileges', async () => {
  await submit(alice);
  const q = db => query(collection(db, 'users', 'alice', 'restroomReadySubmissionRequests'), orderBy('submittedAt', 'desc'), limit(50));
  assert.equal((await assertSucceeds(getDocsFromServer(q(alice)))).size, 1);
  await assertFails(getDocsFromServer(collection(alice, 'users', 'alice', 'restroomReadySubmissionRequests')));
  await assertFails(getDocsFromServer(query(collection(alice, 'users', 'alice', 'restroomReadySubmissionRequests'), limit(51))));
  for (const db of [reader, bob, guest, claimedModerator]) {
    await assertFails(getDocFromServer(request(db))); await assertFails(getDocFromServer(reservation(db)));
    await assertFails(getDocsFromServer(q(db)));
  }
  for (const db of [alice, claimedModerator, reader]) await assertFails(getDocsFromServer(query(collectionGroup(db, 'restroomReadySubmissionRequests'), limit(25))));
});
test('signed-out/anonymous/cross-owner requests and reservation theft are denied', async () => {
  await assertFails(submit(reader)); await assertFails(submit(guest, { uid: 'guest' }));
  await assertFails(submit(alice, { uid: 'bob' })); await assertFails(submit(alice, { proof: { ownerUID: 'bob' } }));
  await submit(alice); await assertFails(submit(bob, { uid: 'bob' }));
  assert.equal((await getDocFromServer(request(bob, 'bob'))).exists(), false);
});
for (const missing of ['request', 'reservation']) test(`pending creation requires paired ${missing}`, () => assertFails(submit(alice, { omit: [missing] })));
test('client cannot publish listing, rating parent, code or saved place while requesting review', async () => {
  for (const db of [alice, claimedModerator]) {
    const uid = db === alice ? 'alice' : 'claimedModerator';
    const legacy = writeBatch(db); legacy.set(listing(db), candidate());
    legacy.set(reservation(db), { ownerUID: uid, submittedAt: serverTimestamp() });
    legacy.set(rating(db), { ratingCount: 0, ratingSum: 0, updatedAt: serverTimestamp() });
    await assertFails(legacy.commit());
    await assertFails(submit(db, { uid, extra: [[listing(db), candidate()]] }));
    await assertFails(submit(db, { uid, extra: [[rating(db), { ratingCount: 0, ratingSum: 0, updatedAt: serverTimestamp() }]] }));
    await assertFails(submit(db, { uid, extra: [[doc(db, 'users', uid, 'restroomReadySaved', ID), { placeID: ID, savedAt: serverTimestamp() }]] }));
  }
});
test('requests cannot reserve an already published ID or rating parent', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(listing(c.firestore()), { ...candidate(), submittedAt: OLD }));
  await assertFails(submit(alice));
  await env.withSecurityRulesDisabled(c => setDoc(rating(c.firestore(), OTHER_ID), { ratingCount: 0, ratingSum: 0, updatedAt: OLD }));
  await assertFails(submit(alice, { id: OTHER_ID }));
});
test('pending requests and global reservations cannot be edited, removed or replayed by clients', async () => {
  await submit(alice); await assertFails(submit(alice));
  for (const db of [alice, bob, claimedModerator]) {
    for (const ref of [request(db), reservation(db)]) { await assertFails(deleteDoc(ref)); await assertFails(updateDoc(ref, { status: 'approved' })); }
  }
  for (const change of [{ revision: 2 }, { codeDraft: null }, { listing: candidate() }, { ownerUID: 'bob' }, { isAdmin: true }]) await assertFails(updateDoc(request(alice), change));
});
for (const data of [{ status: 'approved' }, { status: 'denied' }, { revision: 2 }, { revision: 1.5 }, { schemaVersion: 2 },
  { reviewedAt: OLD }, { reason: '' }, { codeFingerprint: null }, { ownerUID: 'alice' }, { isAdmin: true }, { submittedAt: OLD },
  { codeDraft: true }, { codeDraft: { code: '1234', visibility: 'everyone' } }, { codeDraft: { code: '1234', visibility: 'private', ownerUID: 'alice' } }]) {
  test(`pending exact schema rejects ${JSON.stringify(data)}`, () => assertFails(submit(alice, { data })));
}
for (const field of Object.keys(fields())) test(`pending request requires ${field}`, async () => {
  const value = fields(); delete value[field]; const b = writeBatch(alice);
  b.set(request(alice), value); b.set(reservation(alice), { ownerUID: 'alice', submittedAt: serverTimestamp() }); await assertFails(b.commit());
});
for (const code of ['', ' 1234', '1234 ', 'x'.repeat(41), '12\n34', '你好']) test(`private draft rejects invalid code ${JSON.stringify(code)}`, () =>
  assertFails(submit(alice, { venue: { passcodeRequired: 'yes' }, data: { codeDraft: { code, visibility: 'private' } } })));
test('code draft requires an explicit yes requirement and receipt timestamp cannot be forged', async () => {
  for (const flag of ['unknown', 'no']) await assertFails(submit(alice, { venue: { passcodeRequired: flag }, data: { codeDraft: { code: '1234', visibility: 'public' } } }));
  await assertFails(submit(alice, { proof: { submittedAt: OLD } }));
  await assertFails(submit(alice, { venue: { submittedAt: OLD } }));
});
test('server-only review keeps original public schema compatible and terminal history private', async () => {
  await submit(alice, { venue: { passcodeRequired: 'yes' }, data: { codeDraft: { code: '1234', visibility: 'private' } } });
  const original = (await getDocFromServer(request(alice))).data();
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), b = writeBatch(db);
    b.update(request(db), { status: 'approved', revision: 2, reviewedAt: serverTimestamp(), reason: '', codeDraft: null, codeFingerprint: 'a'.repeat(64) });
    b.set(listing(db), original.listing); b.set(rating(db), { ratingCount: 0, ratingSum: 0, updatedAt: serverTimestamp() }); await b.commit();
  });
  const published = (await getDocFromServer(listing(reader))).data(), terminal = (await getDocFromServer(request(alice))).data();
  assert.deepEqual(published, original.listing); assert.equal(Object.hasOwn(published, 'status'), false);
  assert.equal(terminal.codeDraft, null); assert.equal(terminal.revision, 2); assert.equal(terminal.codeFingerprint, 'a'.repeat(64));
  assert.equal((await getDocsFromServer(query(collection(reader, 'communityRestrooms'), orderBy('submittedAt', 'desc'), limit(1000)))).size, 1);
  await assertFails(getDocFromServer(request(bob))); await assertFails(updateDoc(request(alice), { status: 'pending' }));
  await assertSucceeds(setDoc(doc(alice, 'users', 'alice', 'restroomReadySaved', ID), { placeID: ID, savedAt: serverTimestamp() }));
});
test('deletion lock blocks pending writes and owner reads while other accounts still request review', async () => {
  await submit(alice);
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'accountDeletionLocks', 'alice'), { phase: 'pending', policyVersion: 4 }));
  await assertFails(getDocFromServer(request(alice))); await assertFails(getDocFromServer(reservation(alice)));
  await assertFails(getDocsFromServer(query(collection(alice, 'users', 'alice', 'restroomReadySubmissionRequests'), limit(50))));
  await assertFails(submit(alice, { id: OTHER_ID })); await assertSucceeds(submit(bob, { uid: 'bob', id: OTHER_ID }));
});

for (const kind of ['public-note', 'unified-visit']) {
  test(`${kind}: moderator paired deletion blocks stable-ID recreation but allows a fresh contribution`, async () => {
    await createComment(alice, kind);
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore(), b = writeBatch(db); b.delete(comment(db, kind)); b.delete(ownership(db, kind));
      b.set(marker(db, kind), { reason: 'spam', removedAt: serverTimestamp() }); await b.commit();
    });
    assert.equal((await getDocFromServer(comment(reader, kind))).exists(), false);
    assert.equal((await getDocFromServer(ownership(alice, kind))).exists(), false);
    await assertFails(createComment(alice, kind)); await assertSucceeds(createComment(alice, kind, { id: SECOND_NOTE }));
  });
  test(`${kind}: redaction preserves facts/dates/ownership and remains protected after later owner deletion`, async () => {
    await createComment(alice, kind, { data: { condition: 'usable', soap: 'yes' } });
    const before = (await getDocFromServer(comment(reader, kind))).data();
    await env.withSecurityRulesDisabled(async c => {
      const db = c.firestore(), b = writeBatch(db); b.update(comment(db, kind), { [paths(kind).text]: '' });
      b.set(marker(db, kind), { reason: 'personal_information', removedAt: serverTimestamp() }); await b.commit();
    });
    const after = (await getDocFromServer(comment(reader, kind))).data();
    assert.deepEqual(after, { ...before, [paths(kind).text]: '' }); assert.equal((await getDocFromServer(ownership(alice, kind))).exists(), true);
    await assertFails(updateDoc(comment(alice, kind), { [paths(kind).text]: 'Restored text.' }));
    await assertSucceeds(removeComment(alice, kind)); await assertFails(createComment(alice, kind));
  });
  test(`${kind}: markers remain server-only, including for claimed moderators`, async () => {
    await env.withSecurityRulesDisabled(c => setDoc(marker(c.firestore(), kind), { reason: 'other', removedAt: OLD }));
    for (const db of [alice, bob, reader, claimedModerator]) {
      await assertFails(getDocFromServer(marker(db, kind))); await assertFails(setDoc(marker(db, kind), { reason: 'other' }));
      await assertFails(deleteDoc(marker(db, kind))); await assertFails(getDocsFromServer(query(collection(db, 'restroomModerationRemovals', PLACE, paths(kind).marker), limit(10))));
    }
  });
}
test('markers are scoped to the exact comment namespace and target ID', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(marker(c.firestore(), 'public-note'), { reason: 'other', removedAt: OLD }));
  await assertFails(createComment(alice, 'public-note')); await assertSucceeds(createComment(alice, 'unified-visit'));
  await assertSucceeds(createComment(alice, 'public-note', { id: SECOND_NOTE }));
});
test('roles, action receipts and arbitrary private/admin paths cannot be self-authorized', async () => {
  for (const db of [alice, claimedModerator]) for (const path of ['users/alice', 'roles/alice', 'restroomModerators/alice', 'moderationActions/fake-action']) {
    await assertFails(setDoc(doc(db, path), { role: 'moderator' })); await assertFails(getDocFromServer(doc(db, path)));
  }
});

test('new pending listing requires the full queue contract even though legacy public listings keep optional code requirements',async()=>{
 const incomplete=candidate();delete incomplete.passcodeRequired;await assertFails(submit(alice,{data:{...fields(),listing:incomplete}}));assert.equal((await getDocFromServer(request(alice))).exists(),false);
});

test('legacy public listing without a code-requirement field remains anonymously readable',async()=>{
 await env.withSecurityRulesDisabled(async c=>{const data=candidate();delete data.passcodeRequired;data.submittedAt=OLD;await setDoc(listing(c.firestore()),data);});await assertSucceeds(getDocFromServer(listing(reader)));
});
