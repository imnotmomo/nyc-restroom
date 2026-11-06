import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, orderBy, query,
  runTransaction, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, where, writeBatch,
} from 'firebase/firestore';

// Native wire-contract tests use the actual modular Firebase SDK and current rules.
// Every fixture and mutation is confined to this disposable loopback demo project.
const PROJECT = 'demo-restroom-passcode-v2-sdk';
const PLACE = 'i7jb-7jku:passcode-v2-sdk', OTHER = 'i7jb-7jku:passcode-v2-sdk-other';
const OLD = 'OlderCodeReport00001', LATEST = 'LatestCodeReport0001';
const LEGACY = 'LegacyImportedCode01';
const OLD_TIME = Timestamp.fromDate(new Date('2020-01-01T00:00:00Z'));
let env, owner, reader, guest, voters;
const ownRef = (db, uid, id) => doc(db, 'users', uid, 'restroomReadyPasscodesV2', id);
const ownerRef = (db, id) => doc(db, 'restroomPasscodeV2Owners', id);
const publicRef = (db, place, id, kind = 'v2') => doc(db, kind === 'v2' ? 'restroomPasscodeReportsV2' : 'restroomPasscodeReports', place, 'reports', id);
const summaryRef = (db, place, id, kind = 'v2') => doc(db, 'restroomPasscodeFeedback', place, 'codes', `${kind}_${id}`);
const voteRef = (db, uid, place, id, kind = 'v2') => doc(db, 'users', uid, 'restroomReadyPasscodeVotes', `${place}~${kind}_${id}`);
const savedRef = (db, uid, place) => doc(db, 'users', uid, 'restroomReadySaved', place);
const sameVersion = (value, version) => value?.codeUpdatedAt instanceof Timestamp && value.codeUpdatedAt.isEqual(version);
const advancedStamp = (after, before) => after instanceof Timestamp && (before === null
  || after.seconds > before.seconds || after.seconds === before.seconds && after.nanoseconds > before.nanoseconds);

function createCode(db, { uid = 'owner', id = LATEST, place = PLACE, code = '3434', visibility = 'public', omit = [] } = {}) {
  const batch = writeBatch(db);
  if (!omit.includes('own')) batch.set(ownRef(db, uid, id), { placeID: place, code, visibility, createdAt: serverTimestamp(), codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null });
  if (!omit.includes('reservation')) batch.set(ownerRef(db, id), { ownerUID: uid, placeID: place, createdAt: serverTimestamp() });
  if (visibility === 'private' && !omit.includes('saved')) batch.set(savedRef(db, uid, place), { placeID: place, savedAt: serverTimestamp() });
  if (visibility === 'public' && !omit.includes('public')) batch.set(publicRef(db, place, id), { placeID: place, code, codeUpdatedAt: serverTimestamp() });
  return batch.commit();
}

async function changeVisibility(db, visibility, { uid = 'owner', id = LATEST, omit = [] } = {}) {
  const before = (await getDocFromServer(ownRef(db, uid, id))).data();
  const batch = writeBatch(db);
  batch.set(ownRef(db, uid, id), { ...before, visibility });
  if (visibility === 'private' && !omit.includes('saved')) batch.set(savedRef(db, uid, before.placeID), { placeID: before.placeID, savedAt: serverTimestamp() });
  if (!omit.includes('public')) {
    if (visibility === 'public') batch.set(publicRef(db, before.placeID, id), { placeID: before.placeID, code: before.code, codeUpdatedAt: before.codeUpdatedAt });
    else batch.delete(publicRef(db, before.placeID, id));
  }
  return batch.commit();
}

async function removeCode(db, { uid = 'owner', id = LATEST, omit = [] } = {}) {
  const before = (await getDocFromServer(ownRef(db, uid, id))).data(), batch = writeBatch(db);
  if (!omit.includes('own')) batch.delete(ownRef(db, uid, id));
  if (!omit.includes('reservation')) batch.delete(ownerRef(db, id));
  if (before.visibility === 'public' && !omit.includes('public')) batch.delete(publicRef(db, before.placeID, id));
  return batch.commit();
}

/** Same transaction wire shape used by native: exact version + exclusive per-account vote. */
async function feedback(db, uid, vote, { place = PLACE, id = LATEST, kind = 'v2', expectedVersion, afterCommit } = {}) {
  let committedVersion = expectedVersion ?? null, selectedCode = null, confirmed = false;
  const read = transaction => Promise.all([
    transaction.get(publicRef(db, place, id, kind)), transaction.get(summaryRef(db, place, id, kind)), transaction.get(voteRef(db, uid, place, id, kind)),
  ]);
  const pinCode = codeSnapshot => {
    assert.ok(codeSnapshot.exists(), 'The selected public code must still exist');
    const code = codeSnapshot.data(), version = code.codeUpdatedAt;
    if (committedVersion && !version.isEqual(committedVersion) || selectedCode !== null && selectedCode !== code.code) throw new Error('The public code changed; explicit review is required');
    committedVersion = version;
    selectedCode = code.code;
    return version;
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    let attemptedWrite = false, beforeSummaryStamp = null, beforeVoteStamp = null;
    try {
      await runTransaction(db, async transaction => {
        const [codeSnapshot, summarySnapshot, receiptSnapshot] = await read(transaction), version = pinCode(codeSnapshot);
        if (receiptSnapshot.exists() && sameVersion(receiptSnapshot.data(), version)
          && !(summarySnapshot.exists() && sameVersion(summarySnapshot.data(), version))) throw new Error('A partial feedback pair needs review');
        beforeSummaryStamp = summarySnapshot.exists() ? summarySnapshot.data().updatedAt : null;
        beforeVoteStamp = receiptSnapshot.exists() ? receiptSnapshot.data().updatedAt : null;
        const currentSummary = summarySnapshot.exists() && sameVersion(summarySnapshot.data(), version) ? summarySnapshot.data() : null;
        const currentReceipt = currentSummary && receiptSnapshot.exists() && sameVersion(receiptSnapshot.data(), version) ? receiptSnapshot.data() : null;
        const beforeVote = currentReceipt?.vote;
        const usedCount = (currentSummary?.usedCount ?? 0) - (beforeVote === 'used' ? 1 : 0) + (vote === 'used' ? 1 : 0);
        const invalidCount = (currentSummary?.invalidCount ?? 0) - (beforeVote === 'invalid' ? 1 : 0) + (vote === 'invalid' ? 1 : 0);
        attemptedWrite = true;
        transaction.set(summaryRef(db, place, id, kind), {
          placeID: place, kind, reportID: id, codeUpdatedAt: version, usedCount, invalidCount,
          lastUsedAt: vote === 'used' ? serverTimestamp() : currentSummary?.lastUsedAt ?? null, updatedAt: serverTimestamp(),
        });
        transaction.set(voteRef(db, uid, place, id, kind), { placeID: place, kind, reportID: id, codeUpdatedAt: version, vote, updatedAt: serverTimestamp() });
      });
      confirmed = true; break;
    } catch (error) {
      if (attempt < 2 && attemptedWrite && error.code === 'permission-denied') {
        // Existing rating mutations handle this same rules-before-conflict case.
        const [codeSnapshot, summarySnapshot, receiptSnapshot] = await runTransaction(db, read), version = pinCode(codeSnapshot);
        const latestSummary = summarySnapshot.exists() ? summarySnapshot.data() : null, latestVote = receiptSnapshot.exists() ? receiptSnapshot.data() : null;
        const summaryChanged = advancedStamp(latestSummary?.updatedAt ?? null, beforeSummaryStamp);
        const voteChanged = advancedStamp(latestVote?.updatedAt ?? null, beforeVoteStamp);
        if (sameVersion(latestSummary, version) && sameVersion(latestVote, version) && latestVote.vote === vote && voteChanged) { confirmed = true; break; }
        if (summaryChanged || voteChanged) continue;
      }
      throw error;
    }
  }
  assert.ok(confirmed, 'Feedback must be server-confirmed within its bounded attempts');
  if (afterCommit) await afterCommit();
  return committedVersion;
}

async function readCounts(id = LATEST, kind = 'v2', place = PLACE) {
  return (await getDocFromServer(summaryRef(reader, place, id, kind))).data();
}
async function allSucceeded(operations) {
  const results = await Promise.allSettled(operations);
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(failures.length, 0, failures.map(result => result.reason?.message ?? String(result.reason)).join('\n'));
}
async function seedLegacy(place = PLACE, { version = OLD_TIME, code = '5656', id = LEGACY } = {}) {
  await env.withSecurityRulesDisabled(context => setDoc(publicRef(context.firestore(), place, id, 'legacy'), { placeID: place, code, codeUpdatedAt: version, lastVerifiedAt: OLD_TIME }));
}

before(async () => {
  setLogLevel('silent');
  const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8185'}`);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname), 'Wire tests use loopback emulators only');
  assert.ok(endpoint.port && !endpoint.username && !endpoint.password && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash);
  env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: endpoint.hostname.replace(/^\[|\]$/g, ''), port: Number(endpoint.port), rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8') } });
  owner = env.authenticatedContext('owner', { firebase: { sign_in_provider: 'google.com' } }).firestore();
  guest = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  reader = env.unauthenticatedContext().firestore();
  voters = Array.from({ length: 5 }, (_, i) => ({ uid: `visitor${i}`, db: env.authenticatedContext(`visitor${i}`, { firebase: { sign_in_provider: i % 2 ? 'apple.com' : 'google.com' } }).firestore() }));
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const batch = writeBatch(context.firestore());
    for (const place of [PLACE, OTHER]) batch.set(doc(context.firestore(), 'restroomRatingSummaries', place), { ratingCount: 0, ratingSum: 0, updatedAt: OLD_TIME });
    await batch.commit();
  });
});
after(async () => { if (env) { try { await env.clearFirestore(); } finally { await env.cleanup(); } } });

test('new public code has exact anonymous projection and private ownership without requiring Saved', async () => {
  await createCode(owner);
  const code = (await getDocFromServer(publicRef(reader, PLACE, LATEST))).data();
  const own = (await getDocFromServer(ownRef(owner, 'owner', LATEST))).data();
  assert.deepEqual(Object.keys(code).sort(), ['placeID', 'code', 'codeUpdatedAt'].sort());
  assert.deepEqual(Object.keys(own).sort(), ['placeID', 'code', 'visibility', 'createdAt', 'codeUpdatedAt', 'lastVerifiedAt'].sort());
  assert.deepEqual(Object.keys((await getDocFromServer(ownerRef(owner, LATEST))).data()).sort(), ['ownerUID', 'placeID', 'createdAt'].sort());
  assert.equal(own.lastVerifiedAt, null); assert.ok(own.createdAt.isEqual(code.codeUpdatedAt));
  assert.equal((await getDocFromServer(savedRef(owner, 'owner', PLACE))).exists(), false);
  for (const db of [reader, guest, voters[0].db]) { await assertFails(getDocFromServer(ownRef(db, 'owner', LATEST))); await assertFails(getDocFromServer(ownerRef(db, LATEST))); }
});

test('private code requires Saved and publishes neither its code nor feedback', async () => {
  await assertFails(createCode(owner, { visibility: 'private', omit: ['saved'] }));
  await createCode(owner, { visibility: 'private' });
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, LATEST))).exists(), false);
  await assertFails(getDocFromServer(summaryRef(reader, PLACE, LATEST)));
  assert.equal((await getDocFromServer(savedRef(owner, 'owner', PLACE))).data().placeID, PLACE);
});

test('new reports preserve immutable history; editing a code in place or refreshing report time is denied', async () => {
  await createCode(owner, { id: OLD, code: '1111' });
  const before = (await getDocFromServer(ownRef(owner, 'owner', OLD))).data();
  await createCode(owner, { code: '2222' });
  const feed = await getDocsFromServer(query(collection(reader, 'restroomPasscodeReportsV2', PLACE, 'reports'), orderBy('codeUpdatedAt', 'desc'), limit(10)));
  assert.deepEqual(feed.docs.map(snapshot => snapshot.id), [LATEST, OLD]);
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, OLD))).data().code, '1111');
  for (const patch of [{ code: '3333' }, { codeUpdatedAt: serverTimestamp() }, { createdAt: serverTimestamp() }, { placeID: OTHER }]) await assertFails(updateDoc(ownRef(owner, 'owner', OLD), patch));
  await assertFails(updateDoc(publicRef(owner, PLACE, OLD), { code: '3333' }));
  assert.ok((await getDocFromServer(ownRef(owner, 'owner', OLD))).data().createdAt.isEqual(before.createdAt));
});

test('publication and privacy changes are atomic and hide feedback while retaining private ownership', async () => {
  await createCode(owner); const voter = voters[0]; await feedback(voter.db, voter.uid, 'used');
  await assertFails(changeVisibility(owner, 'private', { omit: ['public'] }));
  await changeVisibility(owner, 'private');
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, LATEST))).exists(), false);
  await assertFails(getDocFromServer(summaryRef(reader, PLACE, LATEST)));
  await assertFails(feedback(voters[1].db, voters[1].uid, 'used'));
  assert.equal((await getDocFromServer(ownRef(owner, 'owner', LATEST))).data().visibility, 'private');
  await changeVisibility(owner, 'public');
  assert.equal((await readCounts()).usedCount, 1);
});

test('public feedback contains counts and exact version only; voter identity stays private and unlistable', async () => {
  await createCode(owner); const voter = voters[0]; const version = await feedback(voter.db, voter.uid, 'used');
  const summary = await readCounts(), receipt = (await getDocFromServer(voteRef(voter.db, voter.uid, PLACE, LATEST))).data();
  assert.deepEqual(Object.keys(summary).sort(), ['placeID', 'kind', 'reportID', 'codeUpdatedAt', 'usedCount', 'invalidCount', 'lastUsedAt', 'updatedAt'].sort());
  assert.deepEqual(Object.keys(receipt).sort(), ['placeID', 'kind', 'reportID', 'codeUpdatedAt', 'vote', 'updatedAt'].sort());
  assert.ok(summary.codeUpdatedAt.isEqual(version)); assert.ok(summary.lastUsedAt.isEqual(summary.updatedAt));
  assert.equal(summary.usedCount, 1); assert.equal(summary.invalidCount, 0);
  for (const db of [owner, reader, voters[1].db]) await assertFails(getDocFromServer(voteRef(db, voter.uid, PLACE, LATEST)));
  await assertFails(getDocsFromServer(collection(voter.db, 'users', voter.uid, 'restroomReadyPasscodeVotes')));
  await assertFails(getDocsFromServer(query(collection(reader, 'restroomPasscodeFeedback', PLACE, 'codes'), limit(10))));
});

test('repeat Used refreshes verification time without counting a visitor twice', async () => {
  await createCode(owner); const voter = voters[0]; await feedback(voter.db, voter.uid, 'used'); const first = await readCounts();
  await feedback(voter.db, voter.uid, 'used'); const second = await readCounts();
  assert.equal(second.usedCount, 1); assert.equal(second.invalidCount, 0);
  assert.ok(second.lastUsedAt.isEqual(second.updatedAt)); assert.ok(second.updatedAt.toMillis() >= first.updatedAt.toMillis());
  assert.ok(second.updatedAt.isEqual((await getDocFromServer(voteRef(voter.db, voter.uid, PLACE, LATEST))).data().updatedAt));
});

test('exclusive Used and Invalid changes transfer one vote; Invalid never claims a successful verification', async () => {
  await createCode(owner); const voter = voters[0];
  await feedback(voter.db, voter.uid, 'invalid'); let result = await readCounts();
  assert.deepEqual([result.usedCount, result.invalidCount, result.lastUsedAt], [0, 1, null]);
  await feedback(voter.db, voter.uid, 'used'); result = await readCounts(); const lastUsed = result.lastUsedAt;
  assert.deepEqual([result.usedCount, result.invalidCount], [1, 0]);
  await feedback(voter.db, voter.uid, 'invalid'); result = await readCounts();
  assert.deepEqual([result.usedCount, result.invalidCount], [0, 1]); assert.ok(result.lastUsedAt.isEqual(lastUsed));
  await feedback(voter.db, voter.uid, 'invalid'); result = await readCounts();
  assert.deepEqual([result.usedCount, result.invalidCount], [0, 1]); assert.ok(result.lastUsedAt.isEqual(lastUsed));
});

test('distinct visitors cross three to four Used votes without deleting older code history', async () => {
  await createCode(owner, { id: OLD, code: '1111' }); await createCode(owner, { code: '2222' });
  for (const voter of voters.slice(0, 3)) await feedback(voter.db, voter.uid, 'used');
  assert.equal((await readCounts()).usedCount, 3);
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, OLD))).exists(), true);
  await feedback(voters[3].db, voters[3].uid, 'used'); assert.equal((await readCounts()).usedCount, 4);
  // Hiding previous codes is a presentation decision, never a destructive database operation.
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, OLD))).data().code, '1111');
  await feedback(voters[3].db, voters[3].uid, 'invalid'); assert.equal((await readCounts()).usedCount, 3);
});

test('simultaneous distinct visitors do not lose or duplicate their individual votes', async () => {
  await createCode(owner);
  await allSucceeded(voters.slice(0, 3).map(voter => feedback(voter.db, voter.uid, 'used')));
  const result = await readCounts(); assert.deepEqual([result.usedCount, result.invalidCount], [3, 0]);
  for (const voter of voters.slice(0, 3)) assert.equal((await getDocFromServer(voteRef(voter.db, voter.uid, PLACE, LATEST))).data().vote, 'used');
});

test('concurrent repeated submissions by one visitor count once, including a lost acknowledgement retry', async () => {
  await createCode(owner); const voter = voters[0];
  await allSucceeded([feedback(voter.db, voter.uid, 'used'), feedback(voter.db, voter.uid, 'used')]);
  assert.equal((await readCounts()).usedCount, 1);
  await assert.rejects(feedback(voter.db, voter.uid, 'used', { afterCommit: () => { throw new Error('Simulated lost acknowledgement'); } }), /lost acknowledgement/);
  await feedback(voter.db, voter.uid, 'used'); assert.equal((await readCounts()).usedCount, 1);
});

test('owners, signed-out users and anonymous-provider accounts cannot vote', async () => {
  await createCode(owner);
  await assertFails(feedback(owner, 'owner', 'used'));
  await assertFails(feedback(guest, 'guest', 'used'));
  await assertFails(feedback(reader, 'unsigned', 'used'));
  assert.equal((await getDocFromServer(summaryRef(reader, PLACE, LATEST))).exists(), false);
});

test('forged counter changes or unpaired vote writes are denied', async () => {
  await createCode(owner); const voter = voters[0]; await feedback(voter.db, voter.uid, 'used');
  const before = await readCounts();
  await assertFails(updateDoc(summaryRef(voter.db, PLACE, LATEST), { usedCount: 4, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(voteRef(voter.db, voter.uid, PLACE, LATEST), { vote: 'invalid', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(summaryRef(voter.db, PLACE, LATEST), { lastUsedAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  const batch = writeBatch(voter.db);
  batch.set(summaryRef(voter.db, PLACE, LATEST), { ...before, usedCount: 4, updatedAt: serverTimestamp(), lastUsedAt: serverTimestamp() });
  batch.set(voteRef(voter.db, voter.uid, PLACE, LATEST), { placeID: PLACE, kind: 'v2', reportID: LATEST, codeUpdatedAt: before.codeUpdatedAt, vote: 'used', updatedAt: serverTimestamp() });
  await assertFails(batch.commit()); assert.equal((await readCounts()).usedCount, 1);
});

test('same-millisecond timestamp truncation cannot be used as the selected code version', async () => {
  const precise = new Timestamp(1_767_312_000, 123_456_000);
  await seedLegacy(PLACE, { version: precise }); const voter = voters[0];
  const rounded = Timestamp.fromMillis(Math.floor(precise.toMillis()));
  assert.equal(Math.floor(rounded.toMillis()), Math.floor(precise.toMillis())); assert.equal(rounded.isEqual(precise), false);
  const batch = writeBatch(voter.db);
  batch.set(summaryRef(voter.db, PLACE, LEGACY, 'legacy'), { placeID: PLACE, kind: 'legacy', reportID: LEGACY, codeUpdatedAt: rounded, usedCount: 1, invalidCount: 0, lastUsedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(voteRef(voter.db, voter.uid, PLACE, LEGACY, 'legacy'), { placeID: PLACE, kind: 'legacy', reportID: LEGACY, codeUpdatedAt: rounded, vote: 'used', updatedAt: serverTimestamp() });
  await assertFails(batch.commit());
  await feedback(voter.db, voter.uid, 'used', { kind: 'legacy', id: LEGACY, expectedVersion: precise });
  assert.ok((await readCounts(LEGACY, 'legacy')).codeUpdatedAt.isEqual(precise));
});

test('concurrent owners cannot reserve the same report ID or replace the winning code', async () => {
  const other = voters[0];
  const results = await Promise.allSettled([
    createCode(owner, { code: '1111' }), createCode(other.db, { uid: other.uid, code: '2222' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const publicData = (await getDocFromServer(publicRef(reader, PLACE, LATEST))).data();
  assert.ok(['1111', '2222'].includes(publicData.code));
  const winner = publicData.code === '1111' ? { db: owner, uid: 'owner' } : other;
  const loser = winner.uid === 'owner' ? other : { db: owner, uid: 'owner' };
  assert.equal((await getDocFromServer(ownerRef(winner.db, LATEST))).data().ownerUID, winner.uid);
  assert.equal((await getDocFromServer(ownRef(winner.db, winner.uid, LATEST))).data().code, publicData.code);
  assert.equal((await getDocFromServer(ownRef(loser.db, loser.uid, LATEST))).exists(), false);
});

test('legacy imported lastVerifiedAt never creates verifier counts and stale versions reset safely', async () => {
  await seedLegacy(); const voter = voters[0];
  await feedback(voter.db, voter.uid, 'used', { kind: 'legacy', id: LEGACY });
  assert.equal((await readCounts(LEGACY, 'legacy')).usedCount, 1);
  const newer = Timestamp.fromMillis(Date.now() - 1_000);
  await seedLegacy(PLACE, { version: newer, code: '7878' });
  const rawStale = await readCounts(LEGACY, 'legacy'); assert.equal(rawStale.codeUpdatedAt.isEqual(newer), false);
  await assert.rejects(feedback(voter.db, voter.uid, 'used', { kind: 'legacy', id: LEGACY, expectedVersion: OLD_TIME }), /code changed/);
  await feedback(voter.db, voter.uid, 'invalid', { kind: 'legacy', id: LEGACY, expectedVersion: newer });
  const reset = await readCounts(LEGACY, 'legacy');
  assert.deepEqual([reset.usedCount, reset.invalidCount, reset.lastUsedAt], [0, 1, null]); assert.ok(reset.codeUpdatedAt.isEqual(newer));
});

test('same legacy import report ID at two places has separate private receipts and totals', async () => {
  await seedLegacy(PLACE); await seedLegacy(OTHER); const voter = voters[0];
  await feedback(voter.db, voter.uid, 'used', { kind: 'legacy', id: LEGACY });
  await feedback(voter.db, voter.uid, 'invalid', { kind: 'legacy', id: LEGACY, place: OTHER });
  assert.deepEqual([(await readCounts(LEGACY, 'legacy')).usedCount, (await readCounts(LEGACY, 'legacy', OTHER)).invalidCount], [1, 1]);
  const first = (await getDocFromServer(voteRef(voter.db, voter.uid, PLACE, LEGACY, 'legacy'))).data();
  const second = (await getDocFromServer(voteRef(voter.db, voter.uid, OTHER, LEGACY, 'legacy'))).data();
  assert.equal(first.placeID, PLACE); assert.equal(second.placeID, OTHER);
});

test('a legacy reservation at a different place cannot block feedback on an imported code', async () => {
  await seedLegacy(PLACE);
  const batch = writeBatch(owner);
  batch.set(doc(owner, 'users', 'owner', 'restroomReadyPasscodes', OTHER), { placeID: OTHER, reportID: LEGACY, code: '9999', visibility: 'private', createdAt: serverTimestamp(), codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null });
  batch.set(doc(owner, 'restroomPasscodeOwners', LEGACY), { ownerUID: 'owner', placeID: OTHER, createdAt: serverTimestamp() });
  batch.set(savedRef(owner, 'owner', OTHER), { placeID: OTHER, savedAt: serverTimestamp() });
  await batch.commit();
  await feedback(voters[0].db, voters[0].uid, 'used', { kind: 'legacy', id: LEGACY });
  assert.equal((await readCounts(LEGACY, 'legacy')).usedCount, 1);
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, LEGACY, 'legacy'))).data().code, '5656');
});

test('private V2 queries are owner and place scoped while excessive public queries fail', async () => {
  await createCode(owner, { id: OLD }); await createCode(owner);
  const ownFeed = await getDocsFromServer(query(collection(owner, 'users', 'owner', 'restroomReadyPasscodesV2'), where('placeID', '==', PLACE), orderBy('createdAt', 'desc'), limit(10)));
  assert.equal(ownFeed.size, 2);
  await assertFails(getDocsFromServer(query(collection(voters[0].db, 'users', 'owner', 'restroomReadyPasscodesV2'), where('placeID', '==', PLACE), orderBy('createdAt', 'desc'), limit(10))));
  await assertFails(getDocsFromServer(collection(reader, 'restroomPasscodeReportsV2', PLACE, 'reports')));
  await assertFails(getDocsFromServer(query(collection(reader, 'restroomPasscodeReportsV2', PLACE, 'reports'), limit(11))));
});

test('atomic owner deletion removes only selected history and makes its feedback unreadable', async () => {
  await createCode(owner, { id: OLD }); await createCode(owner); const voter = voters[0]; await feedback(voter.db, voter.uid, 'used');
  for (const missing of ['own', 'reservation', 'public']) await assertFails(removeCode(owner, { omit: [missing] }));
  await assertFails(deleteDoc(publicRef(voter.db, PLACE, LATEST)));
  await removeCode(owner);
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, LATEST))).exists(), false);
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, OLD))).exists(), true);
  await assertFails(getDocFromServer(summaryRef(reader, PLACE, LATEST)));
});

test('deletion lock stops new reports and feedback without hiding public codes', async () => {
  await createCode(owner); const voter = voters[0];
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'accountDeletionLocks', 'owner'), { phase: 'pending', policyVersion: 3 });
    await setDoc(doc(context.firestore(), 'accountDeletionLocks', voter.uid), { phase: 'pending', policyVersion: 3 });
  });
  await assertFails(createCode(owner, { id: OLD })); await assertFails(feedback(voter.db, voter.uid, 'used'));
  assert.equal((await getDocFromServer(publicRef(reader, PLACE, LATEST))).data().code, '3434');
});
