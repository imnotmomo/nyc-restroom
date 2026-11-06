import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { collection, collectionGroup, deleteDoc, doc, getDocFromServer, getDocsFromServer,
  limit, query, setDoc, setLogLevel, updateDoc, writeBatch } from 'firebase/firestore';

const CITY = 'i7jb-7jku:row-profile-test', COMMUNITY = 'community-1234567890abcdef1234';
const profile = (placeID = CITY) => ({ schemaVersion: 1, placeID, manifestSHA256: 'a'.repeat(64),
  generatedAt: '2026-10-24T05:10:08.000Z', sources: [], facts: [], comments: [], coveredCommentIDs: [] });
const target = (db, placeID = CITY) => doc(db, 'restroomResearchProfiles', placeID);
let env;
const clients = {};

describe('researched card facts are exact-read public and administrator-written', { concurrency: false }, () => {
  before(async () => {
    setLogLevel('silent');
    const endpoint = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088'}`);
    env = await initializeTestEnvironment({ projectId: 'demo-restroom-card-research', firestore: {
      host: endpoint.hostname, port: Number(endpoint.port),
      rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
    } });
    clients.reader = env.unauthenticatedContext().firestore();
    clients.owner = env.authenticatedContext('alice', { firebase: { sign_in_provider: 'google.com' } }).firestore();
    clients.guest = env.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
    clients.claimedAdmin = env.authenticatedContext('admin', { admin: true, role: 'admin' }).firestore();
  });
  beforeEach(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore(), batch = writeBatch(db);
      for (const id of [CITY, COMMUNITY]) batch.set(target(db, id), profile(id));
      batch.set(doc(db, 'restroomResearchProfiles', CITY, 'private', 'raw'), { author: 'Private fixture' });
      batch.set(doc(db, 'restroomResearch', 'review-fixture', 'entries', 'raw'), { author: 'Private fixture' });
      batch.set(doc(db, 'users', 'alice', 'restroomReadySaved', CITY), { placeID: CITY });
      await batch.commit();
    });
  });
  after(async () => { if (env) { try { await env.clearFirestore(); } finally { await env.cleanup(); } } });

  for (const actor of ['reader', 'owner', 'guest', 'claimedAdmin']) {
    test(`${actor} can read exact city/community profiles and a missing optional profile`, async () => {
      for (const id of [CITY, COMMUNITY]) assert.deepEqual((await assertSucceeds(getDocFromServer(target(clients[actor], id)))).data(), profile(id));
      assert.equal((await assertSucceeds(getDocFromServer(target(clients[actor], 'missing-card-fixture')))).exists(), false);
    });
    test(`${actor} cannot create, merge, replace, mutate, delete or spoof a profile`, async () => {
      const db = clients[actor];
      await assertFails(setDoc(target(db, 'new-card-fixture'), profile('new-card-fixture')));
      await assertFails(setDoc(target(db), profile()));
      await assertFails(setDoc(target(db), { facts: [], ownerUID: 'alice' }, { merge: true }));
      await assertFails(updateDoc(target(db), { facts: [{ value: 'Fabricated fixture claim' }] }));
      await assertFails(deleteDoc(target(db)));
      assert.deepEqual((await getDocFromServer(target(clients.reader))).data(), profile());
    });
    test(`${actor} cannot enumerate profiles, query a collection group or read private siblings`, async () => {
      const db = clients[actor];
      await assertFails(getDocsFromServer(collection(db, 'restroomResearchProfiles')));
      await assertFails(getDocsFromServer(query(collection(db, 'restroomResearchProfiles'), limit(1))));
      await assertFails(getDocsFromServer(query(collectionGroup(db, 'restroomResearchProfiles'), limit(1))));
      await assertFails(getDocFromServer(doc(db, 'restroomResearchProfiles', CITY, 'private', 'raw')));
      await assertFails(getDocsFromServer(query(collection(db, 'restroomResearchProfiles', CITY, 'private'), limit(1))));
      await assertFails(getDocFromServer(doc(db, 'restroomResearch', 'review-fixture', 'entries', 'raw')));
    });
  }
  test('invalid and oversized exact profile IDs remain denied', async () => {
    for (const id of ['-leading', 'has space', 'unicode-é', 'p'.repeat(161)]) await assertFails(getDocFromServer(target(clients.reader, id)));
    assert.equal((await assertSucceeds(getDocFromServer(target(clients.reader, 'p'.repeat(160))))).exists(), false);
  });
  test('public card access does not expose someone else’s saved places', async () => {
    for (const actor of ['reader', 'guest', 'claimedAdmin']) await assertFails(getDocFromServer(doc(clients[actor], 'users', 'alice', 'restroomReadySaved', CITY)));
  });
});
