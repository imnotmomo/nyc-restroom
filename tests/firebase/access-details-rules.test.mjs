import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  limit, orderBy, query, serverTimestamp, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch,
} from 'firebase/firestore';

const CITY = 'i7jb-7jku:row-access-test';
const COMMUNITY = 'community-AccessDetailsVenue01';
const NOTE = 'AccessDetailsNote001';
const REPORT = 'AccessDetailsCode001';
const stamp = Timestamp.fromDate(new Date('2026-10-23T12:00:00.000Z'));
const value = (placeID = CITY) => ({
  schemaVersion: 1, placeID,
  restroomHours: 'Hours from an emulator fixture',
  entranceLocation: 'Fixture side entrance',
  entranceStepFree: 'yes', stairFreeRoute: 'yes', elevatorToRestroom: 'yes',
  elevatorNote: 'Fixture elevator route', restroomFloor: 'Fixture upper floor',
  stairsAfterEntry: 0, sourceTitle: 'Emulator fixture',
  reportedAt: stamp, observedOn: null, updatedAt: stamp,
  limitations: 'Synthetic security-test data, not a real venue report.',
});
const target = (db, placeID = CITY) => doc(db, 'restroomAccessDetails', placeID);
let env;
const databases = {};
const actors = ['signed out', 'Google account', 'another account', 'anonymous account', 'claimed admin'];

describe('administrator-written public restroom access details', { concurrency: false }, () => {
  before(async () => {
    setLogLevel('silent');
    const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088'}`);
    env = await initializeTestEnvironment({
      projectId: 'demo-restroom-access-details',
      firestore: {
        host: endpoint.hostname, port: Number(endpoint.port),
        rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
      },
    });
    databases['signed out'] = env.unauthenticatedContext().firestore();
    databases['Google account'] = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    databases['another account'] = env.authenticatedContext('bob', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    databases['anonymous account'] = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
    databases['claimed admin'] = env.authenticatedContext('web-admin', {
      admin: true, isAdmin: true, role: 'admin', firebase: { sign_in_provider: 'google.com' },
    }).firestore();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      const batch = writeBatch(db);
      for (const placeID of [CITY, COMMUNITY]) {
        batch.set(target(db, placeID), value(placeID));
        batch.set(doc(db, 'restroomRatingSummaries', placeID), { ratingCount: 0, ratingSum: 0, updatedAt: stamp });
      }
      batch.set(doc(db, 'communityRestrooms', COMMUNITY), {
        name: 'Emulator venue', address: 'Emulator address', latitude: 40.75, longitude: -73.99,
        locationType: 'other', entryRule: 'unknown', stepFreeAccess: 'unknown',
        notes: '', observedOn: null, submittedAt: stamp,
      });
      batch.set(doc(db, 'users', 'alice', 'restroomReadySaved', CITY), { placeID: CITY, savedAt: stamp });
      batch.set(doc(db, 'users', 'alice', 'restroomReadyNotes', NOTE), {
        placeID: CITY, observedAt: stamp, submittedAt: stamp, condition: 'not-reported',
        soap: 'not-reported', toiletPaper: 'not-reported', stairs: 'not-reported',
        entryNote: 'Private emulator note',
      });
      batch.set(doc(db, 'users', 'alice', 'restroomReadyPasscodes', CITY), {
        placeID: CITY, reportID: REPORT, code: 'private-fixture', visibility: 'private',
        createdAt: stamp, codeUpdatedAt: stamp, lastVerifiedAt: null,
      });
      batch.set(doc(db, 'restroomPasscodeOwners', REPORT), { ownerUID: 'alice', placeID: CITY, createdAt: stamp });
      batch.set(doc(db, 'restroomSubmissions', COMMUNITY), { ownerUID: 'alice', submittedAt: stamp });
      batch.set(doc(db, 'restroomAccessDetails', CITY, 'private', 'fixture'), { privateNote: 'Not a public projection' });
      await batch.commit();
    });
  });

  after(async () => {
    if (env) {
      try { await env.clearFirestore(); }
      finally { await env.cleanup(); }
    }
  });

  for (const actor of actors) {
    test(`${actor} can get public city/community details and explicitly bounded feeds`, async () => {
      const db = databases[actor];
      for (const placeID of [CITY, COMMUNITY]) {
        const snapshot = await assertSucceeds(getDocFromServer(target(db, placeID)));
        assert.equal(snapshot.data().placeID, placeID);
        assert.equal(snapshot.data().observedOn, null);
        assert.deepEqual(Object.keys(snapshot.data()).sort(), Object.keys(value()).sort());
      }
      assert.equal((await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomAccessDetails'), limit(1))))).size, 1);
      assert.equal((await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomAccessDetails'), limit(1000))))).size, 2);
      assert.equal((await assertSucceeds(getDocsFromServer(query(collection(db, 'restroomAccessDetails'),
        orderBy('updatedAt', 'desc'), limit(1000))))).size, 2);
    });

    test(`${actor} cannot create, replace, merge, update, delete or spoof ownership`, async () => {
      const db = databases[actor];
      await assertFails(setDoc(target(db, 'new-access-fixture'), value('new-access-fixture')));
      await assertFails(setDoc(target(db), value()));
      await assertFails(setDoc(target(db), { restroomHours: 'Changed' }, { merge: true }));
      await assertFails(updateDoc(target(db), { restroomHours: 'Changed' }));
      await assertFails(deleteDoc(target(db)));
      await assertFails(setDoc(target(db, 'spoofed-access-fixture'), {
        ...value('spoofed-access-fixture'), ownerUID: 'alice', authorUID: 'web-admin', isAdmin: true,
      }));
      assert.equal((await getDocFromServer(target(databases['signed out']))).data().restroomHours, value().restroomHours);
    });
  }

  test('a missing optional record is readable as absent, including the 160-character ID boundary', async () => {
    for (const placeID of ['missing-access-fixture', 'p'.repeat(160)]) {
      const snapshot = await assertSucceeds(getDocFromServer(target(databases['signed out'], placeID)));
      assert.equal(snapshot.exists(), false);
    }
  });

  test('point reads reject malformed IDs and the 161-character overflow', async () => {
    for (const placeID of ['p'.repeat(161), 'contains space', 'contains\nnewline', '-leading', 'unicode-é']) {
      await assertFails(getDocFromServer(target(databases['signed out'], placeID)));
    }
  });

  test('unbounded and oversized feeds are denied for every client identity', async () => {
    for (const actor of actors) {
      const db = databases[actor];
      await assertFails(getDocsFromServer(collection(db, 'restroomAccessDetails')));
      await assertFails(getDocsFromServer(query(collection(db, 'restroomAccessDetails'), limit(1001))));
    }
  });

  test('unknown descendants and collection-group reads remain denied', async () => {
    for (const actor of actors) {
      const db = databases[actor];
      await assertFails(getDocFromServer(doc(db, 'restroomAccessDetails', CITY, 'private', 'fixture')));
      await assertFails(getDocsFromServer(query(collection(db, 'restroomAccessDetails', CITY, 'private'), limit(1000))));
      await assertFails(setDoc(doc(db, 'restroomAccessDetails', CITY, 'private', 'new'), { note: 'Forbidden' }));
      await assertFails(getDocsFromServer(query(collectionGroup(db, 'restroomAccessDetails'), limit(1000))));
    }
  });

  test('public access details do not expose private saves, notes, codes or ownership receipts', async () => {
    const paths = [
      ['users', 'alice', 'restroomReadySaved', CITY],
      ['users', 'alice', 'restroomReadyNotes', NOTE],
      ['users', 'alice', 'restroomReadyPasscodes', CITY],
      ['restroomPasscodeOwners', REPORT],
      ['restroomSubmissions', COMMUNITY],
    ];
    for (const path of paths) {
      await assertSucceeds(getDocFromServer(doc(databases['Google account'], ...path)));
      for (const actor of actors.filter((name) => name !== 'Google account')) {
        await assertFails(getDocFromServer(doc(databases[actor], ...path)));
      }
    }
  });

  test('a rejected sidecar write cannot partially commit a permitted private update', async () => {
    const db = databases['Google account'];
    const saved = doc(db, 'users', 'alice', 'restroomReadySaved', CITY);
    const batch = writeBatch(db);
    batch.update(saved, { savedAt: serverTimestamp() });
    batch.update(target(db), { restroomHours: 'Forged administrator update' });
    await assertFails(batch.commit());
    assert.ok((await getDocFromServer(saved)).data().savedAt.isEqual(stamp));
    assert.equal((await getDocFromServer(target(databases['signed out']))).data().restroomHours, value().restroomHours);
  });
});
