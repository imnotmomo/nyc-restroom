import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  addDoc, collection, collectionGroup, deleteDoc, deleteField, doc,
  getDocFromServer, getDocsFromServer, serverTimestamp, setDoc,
  setLogLevel, Timestamp, updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'demo-restroom-ready';
const OWNER = 'alice';
const PLACE_ID = 'i7jb-7jku:row-xb7j_yzsr~cp6w';
const NOTE_ID = 'A'.repeat(20);
const OTHER_NOTE_ID = 'B'.repeat(20);
const observedAt = () => Timestamp.fromDate(new Date('2020-06-15T12:00:00.000Z'));
const future = () => Timestamp.fromMillis(Date.now() + 86_400_000);
const savedData = (placeID = PLACE_ID) => ({ placeID, savedAt: serverTimestamp() });
const noteData = () => ({
  placeID: PLACE_ID,
  observedAt: observedAt(),
  submittedAt: serverTimestamp(),
  condition: 'usable',
  soap: 'yes',
  toiletPaper: 'no',
  stairs: 'not-reported',
  entryNote: 'The restroom was one level below the entrance.',
});
const omit = (data, key) => Object.fromEntries(Object.entries(data).filter(([field]) => field !== key));

let environment;
let owner;
let other;
let anonymous;

const savedCollection = (database, uid = OWNER) => collection(database, 'users', uid, 'restroomReadySaved');
const notesCollection = (database, uid = OWNER) => collection(database, 'users', uid, 'restroomReadyNotes');
const savedReference = (database, placeID = PLACE_ID) => doc(savedCollection(database), placeID);
const noteReference = (database, noteID = NOTE_ID) => doc(notesCollection(database), noteID);

describe('Restroom Ready Firestore rules', { concurrency: false }, () => {
  before(async () => {
    const address = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8088';
    assert.ok(!address.includes('://'), 'FIRESTORE_EMULATOR_HOST must be host:port, without a protocol');
    const endpoint = new URL(`http://${address}`);
    const port = Number(endpoint.port);
    assert.ok(endpoint.hostname && Number.isInteger(port) && port > 0 && port <= 65_535,
      'FIRESTORE_EMULATOR_HOST must include a valid port');
    setLogLevel('silent');
    environment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: endpoint.hostname.replace(/^\[|\]$/g, ''),
        port,
        rules: await readFile(new URL('../../firebase/firestore.rules', import.meta.url), 'utf8'),
      },
    });
    owner = environment.authenticatedContext(OWNER).firestore();
    other = environment.authenticatedContext('bob').firestore();
    anonymous = environment.unauthenticatedContext().firestore();
  });

  beforeEach(async () => { await environment.clearFirestore(); });

  after(async () => {
    if (!environment) return;
    try { await environment.clearFirestore(); }
    finally { await environment.cleanup(); }
  });

  test('owner can create, read, list, refresh, and delete a saved place without a profile', async () => {
    const reference = savedReference(owner);
    await assertSucceeds(setDoc(reference, savedData()));
    const created = await assertSucceeds(getDocFromServer(reference));
    assert.equal(created.data().placeID, PLACE_ID);
    assert.ok(created.data().savedAt instanceof Timestamp);
    assert.equal((await assertSucceeds(getDocsFromServer(savedCollection(owner)))).size, 1);
    await assertSucceeds(setDoc(reference, savedData()));
    await assertSucceeds(updateDoc(reference, { savedAt: serverTimestamp() }));
    assert.equal((await getDocFromServer(reference)).data().placeID, PLACE_ID);
    await assertSucceeds(deleteDoc(reference));
    assert.equal((await getDocFromServer(reference)).exists(), false);
  });

  test('owner can create, read, list, and delete immutable private notes', async () => {
    const reference = await assertSucceeds(addDoc(notesCollection(owner), noteData()));
    assert.match(reference.id, /^[A-Za-z0-9]{20}$/);
    const created = await assertSucceeds(getDocFromServer(reference));
    assert.equal(created.data().placeID, PLACE_ID);
    assert.equal(created.data().observedAt.toMillis(), observedAt().toMillis());
    assert.ok(created.data().submittedAt instanceof Timestamp);
    assert.equal(created.data().entryNote, noteData().entryNote);
    assert.equal((await assertSucceeds(getDocsFromServer(notesCollection(owner)))).size, 1);
    await assertSucceeds(deleteDoc(reference));
    assert.equal((await getDocFromServer(reference)).exists(), false);
  });

  test('valid enum and maximum-size boundaries are accepted', async () => {
    const placeID = 'p'.repeat(128);
    await assertSucceeds(setDoc(savedReference(owner, placeID), savedData(placeID)));
    for (const [index, condition] of ['not-reported', 'usable', 'needs-attention'].entries()) {
      const answer = ['not-reported', 'yes', 'no'][index];
      await assertSucceeds(setDoc(noteReference(owner, String(index).repeat(20)), {
        ...noteData(), placeID, condition, soap: answer, toiletPaper: answer,
        stairs: answer, entryNote: index === 0 ? '' : 'x'.repeat(1_000),
      }));
    }
  });

  for (const [actorName, getDatabase] of [['another user', () => other], ['an anonymous user', () => anonymous]]) {
    test(`${actorName} cannot get, list, create, update, or delete the owner's saved places`, async () => {
      await setDoc(savedReference(owner), savedData());
      const database = getDatabase();
      const existing = savedReference(database);
      await assertFails(getDocFromServer(existing));
      await assertFails(getDocsFromServer(savedCollection(database)));
      await assertFails(setDoc(savedReference(database, 'new-place'), savedData('new-place')));
      await assertFails(updateDoc(existing, { savedAt: serverTimestamp() }));
      await assertFails(deleteDoc(existing));
      assert.equal((await getDocFromServer(savedReference(owner))).data().placeID, PLACE_ID);
    });

    test(`${actorName} cannot get, list, create, update, or delete the owner's private notes`, async () => {
      await setDoc(noteReference(owner), noteData());
      const database = getDatabase();
      const existing = noteReference(database);
      await assertFails(getDocFromServer(existing));
      await assertFails(getDocsFromServer(notesCollection(database)));
      await assertFails(setDoc(noteReference(database, OTHER_NOTE_ID), noteData()));
      await assertFails(updateDoc(existing, { entryNote: 'Changed by another person' }));
      await assertFails(deleteDoc(existing));
      assert.equal((await getDocFromServer(noteReference(owner))).data().entryNote, noteData().entryNote);
    });
  }

  test('notes reject owner updates, replacement writes, and required-field deletion', async () => {
    const reference = noteReference(owner);
    await setDoc(reference, noteData());
    await assertFails(updateDoc(reference, { entryNote: 'Changed', submittedAt: serverTimestamp() }));
    await assertFails(setDoc(reference, noteData()));
    await assertFails(updateDoc(reference, { observedAt: deleteField() }));
    assert.equal((await getDocFromServer(reference)).data().entryNote, noteData().entryNote);
  });

  const invalidSaved = [
    ['missing placeID', () => omit(savedData(), 'placeID')],
    ['missing savedAt', () => omit(savedData(), 'savedAt')],
    ['extra field', () => ({ ...savedData(), extra: 'unexpected' })],
    ['privilege field', () => ({ ...savedData(), isAdmin: true })],
    ['forged owner field', () => ({ ...savedData(), ownerId: 'bob' })],
    ['empty placeID', () => ({ ...savedData(), placeID: '' })],
    ['oversized placeID', () => ({ ...savedData(), placeID: 'p'.repeat(129) })],
    ['path in placeID', () => ({ ...savedData(), placeID: 'users/bob' })],
    ['mismatched document ID', () => ({ ...savedData(), placeID: 'different-place' })],
    ['numeric placeID', () => ({ ...savedData(), placeID: 42 })],
    ['array placeID', () => ({ ...savedData(), placeID: [PLACE_ID] })],
    ['map placeID', () => ({ ...savedData(), placeID: { id: PLACE_ID } })],
    ['string savedAt', () => ({ ...savedData(), savedAt: '2020-06-15T12:00:00Z' })],
    ['null savedAt', () => ({ ...savedData(), savedAt: null })],
    ['forged past savedAt', () => ({ ...savedData(), savedAt: observedAt() })],
    ['forged future savedAt', () => ({ ...savedData(), savedAt: future() })],
  ];

  for (const [name, makeData] of invalidSaved) {
    test(`saved-place create rejects ${name}`, async () => {
      await assertFails(setDoc(savedReference(owner), makeData()));
    });
    test(`saved-place update rejects ${name}`, async () => {
      const reference = savedReference(owner);
      await setDoc(reference, savedData());
      await assertFails(setDoc(reference, makeData()));
      const unchanged = await getDocFromServer(reference);
      assert.deepEqual(Object.keys(unchanged.data()).sort(), ['placeID', 'savedAt']);
      assert.equal(unchanged.data().placeID, PLACE_ID);
    });
  }

  test('partial and merge updates cannot delete required fields or add privileges', async () => {
    const reference = savedReference(owner);
    await setDoc(reference, savedData());
    await assertFails(updateDoc(reference, { placeID: deleteField(), savedAt: serverTimestamp() }));
    await assertFails(updateDoc(reference, { savedAt: deleteField() }));
    await assertFails(setDoc(reference, { isAdmin: true, savedAt: serverTimestamp() }, { merge: true }));
    await assertFails(updateDoc(reference, { placeID: 'different-place', savedAt: serverTimestamp() }));
  });

  test('saved-place ID length is checked even when document and field IDs match', async () => {
    const placeID = 'p'.repeat(129);
    await assertFails(setDoc(savedReference(owner, placeID), savedData(placeID)));
  });

  for (const field of ['placeID', 'observedAt', 'submittedAt', 'condition', 'soap', 'toiletPaper', 'stairs', 'entryNote']) {
    test(`note create rejects missing ${field}`, async () => {
      await assertFails(setDoc(noteReference(owner), omit(noteData(), field)));
    });
  }

  const invalidNotes = [
    ['extra field', () => ({ ...noteData(), extra: 'unexpected' })],
    ['privilege field', () => ({ ...noteData(), role: 'admin' })],
    ['forged author field', () => ({ ...noteData(), authorUID: 'bob' })],
    ['empty placeID', () => ({ ...noteData(), placeID: '' })],
    ['oversized placeID', () => ({ ...noteData(), placeID: 'p'.repeat(129) })],
    ['path in placeID', () => ({ ...noteData(), placeID: 'users/bob' })],
    ['newline and path in placeID', () => ({ ...noteData(), placeID: 'first\nusers/bob' })],
    ['numeric placeID', () => ({ ...noteData(), placeID: 42 })],
    ['array placeID', () => ({ ...noteData(), placeID: [PLACE_ID] })],
    ['map placeID', () => ({ ...noteData(), placeID: { id: PLACE_ID } })],
    ['string observedAt', () => ({ ...noteData(), observedAt: '2020-06-15T12:00:00Z' })],
    ['null observedAt', () => ({ ...noteData(), observedAt: null })],
    ['pre-2000 observedAt', () => ({ ...noteData(), observedAt: Timestamp.fromDate(new Date('1999-12-31T23:59:59Z')) })],
    ['future observedAt', () => ({ ...noteData(), observedAt: future() })],
    ['string submittedAt', () => ({ ...noteData(), submittedAt: '2020-06-15T12:00:00Z' })],
    ['null submittedAt', () => ({ ...noteData(), submittedAt: null })],
    ['forged past submittedAt', () => ({ ...noteData(), submittedAt: observedAt() })],
    ['forged future submittedAt', () => ({ ...noteData(), submittedAt: future() })],
    ['invalid condition enum', () => ({ ...noteData(), condition: 'verified-clean' })],
    ['array condition', () => ({ ...noteData(), condition: ['usable'] })],
    ['invalid soap enum', () => ({ ...noteData(), soap: 'maybe' })],
    ['boolean soap', () => ({ ...noteData(), soap: true })],
    ['invalid toiletPaper enum', () => ({ ...noteData(), toiletPaper: 'present' })],
    ['map toiletPaper', () => ({ ...noteData(), toiletPaper: { value: 'yes' } })],
    ['invalid stairs enum', () => ({ ...noteData(), stairs: 'none' })],
    ['numeric stairs', () => ({ ...noteData(), stairs: 0 })],
    ['oversized entryNote', () => ({ ...noteData(), entryNote: 'x'.repeat(1_001) })],
    ['numeric entryNote', () => ({ ...noteData(), entryNote: 42 })],
    ['array entryNote', () => ({ ...noteData(), entryNote: ['A note'] })],
    ['map entryNote', () => ({ ...noteData(), entryNote: { text: 'A note' } })],
  ];

  for (const [name, makeData] of invalidNotes) {
    test(`note create rejects ${name}`, async () => {
      await assertFails(setDoc(noteReference(owner), makeData()));
    });
  }

  for (const noteID of ['short', 'a'.repeat(21), `${'a'.repeat(19)}-`]) {
    test(`note create rejects invalid document ID ${JSON.stringify(noteID)}`, async () => {
      await assertFails(setDoc(noteReference(owner, noteID), noteData()));
    });
  }

  test('collection-group reads cannot expose all users libraries', async () => {
    await setDoc(savedReference(owner), savedData());
    await setDoc(noteReference(owner), noteData());
    for (const database of [owner, other, anonymous]) {
      await assertFails(getDocsFromServer(collectionGroup(database, 'restroomReadySaved')));
      await assertFails(getDocsFromServer(collectionGroup(database, 'restroomReadyNotes')));
    }
  });

  test('profiles, roles, public data, and nested collections remain default-denied', async () => {
    const paths = [
      'users/alice', 'roles/alice', 'bathrooms/public-place', 'reviews/public-review',
      `users/alice/restroomReadyNotes/${NOTE_ID}/attachments/injected`,
    ];
    for (const database of [owner, other, anonymous]) {
      await assertFails(getDocsFromServer(collection(database, 'users')));
      for (const path of paths) {
        const reference = doc(database, path);
        await assertFails(getDocFromServer(reference));
        await assertFails(setDoc(reference, { role: 'admin', isAdmin: true }));
        await assertFails(deleteDoc(reference));
      }
    }
  });
});
