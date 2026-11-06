import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer, serverTimestamp,
  setDoc, setLogLevel, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT = 'demo-restroom-passcode-v2-security';
const PLACE = 'i7jb-7jku:security-v2', OTHER = 'i7jb-7jku:security-v2-other';
const ID = 'A'.repeat(20), SECOND = 'B'.repeat(20), OLD = Timestamp.fromMillis(1_600_000_000_000);
let env, alice, bob, guest, out;
const own = (db, uid = 'alice', id = ID) => doc(db, 'users', uid, 'restroomReadyPasscodesV2', id);
const reservation = (db, id = ID) => doc(db, 'restroomPasscodeV2Owners', id);
const pub = (db, id = ID) => doc(db, 'restroomPasscodeReportsV2', PLACE, 'reports', id);
const saved = db => doc(db, 'users', 'alice', 'restroomReadySaved', PLACE);
const feedback = db => doc(db, 'restroomPasscodeFeedback', PLACE, 'codes', `v2_${ID}`);
const vote = (db, uid = 'bob', key = `${PLACE}~v2_${ID}`) => doc(db, 'users', uid, 'restroomReadyPasscodeVotes', key);
const original = (visibility = 'public') => ({ placeID: PLACE, code: '0123#', visibility,
  createdAt: serverTimestamp(), codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null });

function create(db, { uid = 'alice', id = ID, data = original(), ownerExtra = {}, publicExtra = {}, omit = [] } = {}) {
  const batch = writeBatch(db);
  if (!omit.includes('own')) batch.set(own(db, uid, id), data);
  if (!omit.includes('reservation')) batch.set(reservation(db, id), { ownerUID: uid, placeID: PLACE, createdAt: serverTimestamp(), ...ownerExtra });
  if (data.visibility === 'public' && !omit.includes('public')) batch.set(pub(db, id), { placeID: PLACE, code: data.code, codeUpdatedAt: data.codeUpdatedAt, ...publicExtra });
  if (data.visibility === 'private' && !omit.includes('saved')) batch.set(saved(db), { placeID: PLACE, savedAt: serverTimestamp() });
  return batch.commit();
}
async function cast(db = bob, { uid = 'bob', value = 'used', summaryExtra = {}, voteExtra = {}, key, omit = [] } = {}) {
  const version = (await getDocFromServer(pub(out))).data().codeUpdatedAt;
  const batch = writeBatch(db);
  if (!omit.includes('summary')) batch.set(feedback(db), { placeID: PLACE, kind: 'v2', reportID: ID, codeUpdatedAt: version,
    usedCount: value === 'used' ? 1 : 0, invalidCount: value === 'invalid' ? 1 : 0,
    lastUsedAt: value === 'used' ? serverTimestamp() : null, updatedAt: serverTimestamp(), ...summaryExtra });
  if (!omit.includes('vote')) batch.set(vote(db, uid, key), { placeID: PLACE, kind: 'v2', reportID: ID,
    codeUpdatedAt: version, vote: value, updatedAt: serverTimestamp(), ...voteExtra });
  return batch.commit();
}
before(async () => {
  setLogLevel('silent');
  const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8185'}`);
  assert.equal(endpoint.hostname, '127.0.0.1');
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: endpoint.hostname, port: Number(endpoint.port), rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') } });
  alice = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  bob = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'apple.com' } }).firestore();
  guest = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  out = env.unauthenticatedContext().firestore();
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (const place of [PLACE, OTHER]) batch.set(doc(context.firestore(), 'restroomRatingSummaries', place), { ratingCount: 0, ratingSum: 0, updatedAt: OLD });
    await batch.commit();
  });
});
after(async () => { if (env) { try { await env.clearFirestore(); } finally { await env.cleanup(); } } });

for (const omit of ['own', 'reservation', 'public']) test(`public V2 create requires atomic ${omit}`, async () => {
  await assertFails(create(alice, { omit: [omit] }));
});
for (const omit of ['own', 'reservation', 'saved']) test(`private V2 create requires atomic ${omit}`, async () => {
  await assertFails(create(alice, { data: original('private'), omit: [omit] }));
});
for (const [label, patch] of [
  ['extra identity', { ownerUID: 'alice' }], ['empty code', { code: '' }], ['padded code', { code: ' 0123' }],
  ['control code', { code: '0123\n' }], ['nonascii code', { code: '密码' }], ['long code', { code: 'a'.repeat(41) }],
  ['wrong place', { placeID: OTHER }], ['past create time', { createdAt: OLD }], ['past version', { codeUpdatedAt: OLD }],
  ['forged check', { lastVerifiedAt: serverTimestamp() }], ['bad visibility', { visibility: 'everyone' }],
]) test(`V2 rejects ${label}`, async () => { await assertFails(create(alice, { data: { ...original(), ...patch } })); });
test('ownership and public projection schemas reject extra metadata', async () => {
  await assertFails(create(alice, { ownerExtra: { email: 'fixture@example.test' } }));
  await assertFails(create(alice, { publicExtra: { lastVerifiedAt: null } }));
  await assertFails(create(alice, { publicExtra: { ownerUID: 'alice' } }));
});
test('another account cannot hijack even an unpublished reserved ID', async () => {
  await create(alice, { data: original('private') });
  await assertFails(create(bob, { uid: 'bob' }));
  await assertFails(updateDoc(reservation(bob), { ownerUID: 'bob' }));
});
test('private explicit verification requires Saved and cannot refresh code or publication time', async () => {
  await create(alice, { data: original('private') });
  const before = (await getDocFromServer(own(alice))).data();
  await deleteDoc(saved(alice));
  await assertFails(updateDoc(own(alice), { lastVerifiedAt: serverTimestamp() }));
  const batch = writeBatch(alice);
  batch.update(own(alice), { lastVerifiedAt: serverTimestamp() });
  batch.set(saved(alice), { placeID: PLACE, savedAt: serverTimestamp() });
  await assertSucceeds(batch.commit());
  const after = (await getDocFromServer(own(alice))).data();
  assert.ok(after.codeUpdatedAt.isEqual(before.codeUpdatedAt));
  await assertFails(updateDoc(own(alice), { code: '9999' }));
});
test('public owner cannot fabricate verification through its private projection', async () => {
  await create(alice);
  await assertFails(updateDoc(own(alice), { lastVerifiedAt: serverTimestamp() }));
  await assertFails(cast(alice, { uid: 'alice' }));
});
for (const dbName of ['out', 'guest']) test(`${dbName} cannot contribute V2 codes or votes`, async () => {
  const db = dbName === 'out' ? out : guest;
  await assertFails(create(db, { uid: dbName })); await create(alice);
  await assertFails(cast(db, { uid: dbName }));
});
for (const omit of ['summary', 'vote']) test(`feedback requires atomic ${omit}`, async () => {
  await create(alice); await assertFails(cast(bob, { omit: [omit] }));
});
for (const [label, patch] of [
  ['extra UID', { uid: 'bob' }], ['wrong place', { placeID: OTHER }], ['wrong source', { kind: 'legacy' }],
  ['wrong report', { reportID: SECOND }], ['old version', { codeUpdatedAt: OLD }], ['old time', { updatedAt: OLD }],
  ['fractional count', { usedCount: 1.5 }], ['negative count', { invalidCount: -1 }], ['inflated count', { usedCount: 4 }],
  ['overflow count', { usedCount: 1_000_001 }], ['false invalid count', { invalidCount: 1 }], ['false verified', { lastUsedAt: null }],
]) test(`feedback rejects ${label}`, async () => { await create(alice); await assertFails(cast(bob, { summaryExtra: patch })); });
for (const [label, patch] of [
  ['identity', { ownerUID: 'bob' }], ['wrong place', { placeID: OTHER }], ['wrong source', { kind: 'legacy' }],
  ['wrong report', { reportID: SECOND }], ['old version', { codeUpdatedAt: OLD }], ['old time', { updatedAt: OLD }],
  ['invalid outcome', { vote: 'maybe' }],
]) test(`private vote rejects ${label}`, async () => { await create(alice); await assertFails(cast(bob, { voteExtra: patch })); });
test('private vote key must bind exact place, kind and report', async () => {
  await create(alice);
  for (const key of [`v2_${ID}`, `${OTHER}~v2_${ID}`, `${PLACE}~legacy_${ID}`, `${PLACE}~v2_${SECOND}`]) await assertFails(cast(bob, { key }));
});
test('Invalid does not create a successful verification time', async () => {
  await create(alice);
  await assertFails(cast(bob, { value: 'invalid', summaryExtra: { lastUsedAt: serverTimestamp() } }));
  await assertSucceeds(cast(bob, { value: 'invalid' }));
  assert.equal((await getDocFromServer(feedback(out))).data().lastUsedAt, null);
});
test('new public counts cannot be overwritten without refreshing the paired current vote', async () => {
  await create(alice); await cast();
  await assertFails(updateDoc(feedback(bob), { usedCount: 2, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(feedback(alice), { usedCount: 0, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(feedback(bob))); await assertFails(deleteDoc(vote(bob)));
});
test('collection-group reads cannot disclose any own codes, reservations or votes', async () => {
  await create(alice); await cast();
  for (const db of [alice, bob, out]) for (const name of ['restroomReadyPasscodesV2', 'restroomPasscodeV2Owners', 'restroomReadyPasscodeVotes', 'codes']) await assertFails(getDocsFromServer(collectionGroup(db, name)));
});
test('a deletion lock fences V2 private reads and all paired mutations', async () => {
  await create(alice);
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'accountDeletionLocks', 'bob'), { phase: 'pending' }));
  await assertFails(cast()); await assertFails(getDocFromServer(vote(bob)));
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'accountDeletionLocks', 'alice'), { phase: 'pending' }));
  await assertFails(create(alice, { id: SECOND })); await assertFails(getDocFromServer(own(alice)));
  assert.equal((await getDocFromServer(pub(out))).exists(), true);
});

 test('public-code text filter covers V2 create/share but leaves Only me code storage unchanged',async()=>{
   await assertFails(create(alice,{data:{...original('public'),code:'FUCK'}}));await assertSucceeds(create(alice,{data:{...original('private'),code:'FUCK'}}));const before=(await getDocFromServer(own(alice))).data();const b=writeBatch(alice);b.set(own(alice),{...before,visibility:'public'});b.set(pub(alice),{placeID:PLACE,code:before.code,codeUpdatedAt:before.codeUpdatedAt});await assertFails(b.commit());
 });
 test('removed V2 public code keeps private ownership usable but exact removed version cannot be shared again',async()=>{
   await assertSucceeds(create(alice));const before=(await getDocFromServer(own(alice))).data();await env.withSecurityRulesDisabled(async c=>{const b=writeBatch(c.firestore());b.delete(pub(c.firestore()));b.set(doc(c.firestore(),'restroomModerationRemovals',PLACE,'v2Codes',ID),{kind:'v2-code',placeID:PLACE,recordID:ID,codeUpdatedAt:before.codeUpdatedAt,reason:'spam',removedAt:serverTimestamp()});await b.commit();});
   const hide=writeBatch(alice);hide.set(own(alice),{...before,visibility:'private'});hide.set(saved(alice),{placeID:PLACE,savedAt:serverTimestamp()});hide.delete(pub(alice));await assertSucceeds(hide.commit());const share=writeBatch(alice);share.set(own(alice),before);share.set(pub(alice),{placeID:PLACE,code:before.code,codeUpdatedAt:before.codeUpdatedAt});await assertFails(share.commit());assert.equal((await getDocFromServer(own(alice))).data().code,before.code);
 });
 test('a removed immutable V2 report ID cannot be recycled to evade its moderation tombstone',async()=>{
   await assertSucceeds(create(alice));const before=(await getDocFromServer(own(alice))).data();await env.withSecurityRulesDisabled(async c=>{const b=writeBatch(c.firestore());b.delete(pub(c.firestore()));b.set(doc(c.firestore(),'restroomModerationRemovals',PLACE,'v2Codes',ID),{kind:'v2-code',placeID:PLACE,recordID:ID,codeUpdatedAt:before.codeUpdatedAt,reason:'spam',removedAt:serverTimestamp()});await b.commit();});const remove=writeBatch(alice);remove.delete(own(alice));remove.delete(reservation(alice));remove.delete(pub(alice));await assertSucceeds(remove.commit());await assertFails(create(alice));await assertSucceeds(create(alice,{data:original('private')}));
 });
