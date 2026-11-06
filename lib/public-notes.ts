import type { User } from "firebase/auth";
import {
  collection, doc, getFirestore, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, Timestamp, writeBatch, type DocumentData, type Firestore,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import {
  PUBLIC_NOTE_LIMIT, isPublicNoteID, isPublicNotePlaceID, normalizePublicNoteInput, samePublicNoteInput,
  type PublicNote, type PublicNoteInput,
} from "@/lib/public-note-model";

export type { PublicNote, PublicNoteInput, PublicNoteAnswer, PublicNoteCondition } from "@/lib/public-note-model";
export { PUBLIC_NOTE_LIMIT } from "@/lib/public-note-model";

class PublicNoteError extends Error {}
type AccountScope = { client: FirebaseClient; uid: string; user: User };

function requireClient(): FirebaseClient {
  const client = getFirebaseClient();
  if (!client) throw new PublicNoteError(getFirebaseConfigurationError() ?? "Visit notes are not connected in this build.");
  return client;
}

function accountScope(uid: string): AccountScope {
  const client = requireClient();
  const user = client.auth.currentUser;
  if (!uid || !user || user.isAnonymous) throw new PublicNoteError("Sign in with Google to publish or remove a visit note.");
  if (user.uid !== uid) throw new PublicNoteError("Your account changed during this request. Return to the original account and check the same note before retrying.");
  return { client, uid, user };
}

function assertAccount(scope: AccountScope): void {
  const current = scope.client.auth.currentUser;
  if (current !== scope.user || current.uid !== scope.uid || current.isAnonymous) {
    throw new PublicNoteError("Your account changed during this request. Return to the original account and check the same note before retrying.");
  }
}

function assertPlace(placeID: string): void {
  if (!isPublicNotePlaceID(placeID)) throw new PublicNoteError("Choose a location from the finder before publishing a note.");
}

function assertNoteID(id: string): void {
  if (!isPublicNoteID(id)) throw new PublicNoteError("This note’s request ID is invalid. Reopen the note form.");
}

function readableError(error: unknown): Error {
  if (error instanceof PublicNoteError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
  if (code === "permission-denied" || code === "unauthenticated") {
    return new PublicNoteError("This note request was not authorized. Refresh your account and retry the same note; no change has been confirmed.");
  }
  return new PublicNoteError("The note request could not be confirmed. Check your connection and retry the same note before creating another.");
}

const publicReference = (database: Firestore, placeID: string, id: string) => doc(database, "restroomPublicNotes", placeID, "notes", id);
const receiptReference = (database: Firestore, uid: string, id: string) => doc(database, "users", uid, "restroomReadyPublicNoteReceipts", id);

/** Both records must come from one server snapshot, including during a concurrent commit. */
async function readPair(database: Firestore, scope: AccountScope, placeID: string, id: string) {
  assertAccount(scope);
  const pair = await runTransaction(database, async (transaction) => {
    assertAccount(scope);
    return Promise.all([
      transaction.get(publicReference(database, placeID, id)), transaction.get(receiptReference(database, scope.uid, id)),
    ]);
  });
  assertAccount(scope);
  return pair;
}

function decodeNote(id: string, expectedPlaceID: string, data: DocumentData): PublicNote {
  if (!isPublicNoteID(id) || Object.keys(data).length !== 9 || data.schemaVersion !== 1 || data.placeID !== expectedPlaceID
    || !(data.observedAt instanceof Timestamp) || !(data.submittedAt instanceof Timestamp)) {
    throw new PublicNoteError("A visit note has invalid details and is hidden. Other valid notes can still be shown.");
  }
  const { schemaVersion, placeID, submittedAt, observedAt, ...fields } = data;
  try {
    if (!Number.isFinite(submittedAt.toMillis()) || submittedAt.toMillis() > Date.now()) throw new Error("Invalid submission time");
    const normalized = normalizePublicNoteInput({ ...fields, observedAt: observedAt.toDate() }, submittedAt.toDate());
    if (normalized.body !== data.body) throw new Error("Unnormalized public note");
    return { ...normalized, schemaVersion: 1, id, placeID, submittedAt: submittedAt.toDate() };
  } catch {
    throw new PublicNoteError("A visit note has invalid dates or fields and is hidden. Other valid notes can still be shown.");
  }
}

function validReceipt(data: DocumentData, placeID: string): boolean {
  return Object.keys(data).length === 2 && data.placeID === placeID && data.submittedAt instanceof Timestamp
    && Number.isFinite(data.submittedAt.toMillis()) && data.submittedAt.toMillis() >= Date.UTC(2000, 0, 1);
}

export function newPublicNoteID(): string {
  return doc(collection(getFirestore(requireClient().app), "restroomPublicNotes")).id;
}

/** A bounded public feed, independent of sign-in and Apple Intelligence. */
export function watchPublicNotes(placeID: string, onChange: (notes: PublicNote[]) => void, onError: (error: Error) => void): () => void {
  try {
    assertPlace(placeID);
    const feed = query(collection(getFirestore(requireClient().app), "restroomPublicNotes", placeID, "notes"),
      orderBy("submittedAt", "desc"), limit(PUBLIC_NOTE_LIMIT));
    return onSnapshot(feed, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const notes: PublicNote[] = [];
      let hidden = 0;
      for (const entry of snapshot.docs) {
        try { notes.push(decodeNote(entry.id, placeID, entry.data())); }
        catch { hidden += 1; }
      }
      onChange(notes);
      if (hidden) onError(new PublicNoteError("Some visit notes had invalid details and are hidden. Other available notes are shown."));
    }, (error) => onError(readableError(error)));
  } catch (error) {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) onError(readableError(error)); });
    return () => { cancelled = true; };
  }
}

export async function readOwnPublicNoteIDs(uid: string, placeID: string, visibleIDs: readonly string[]): Promise<string[]> {
  assertPlace(placeID);
  if (!Array.isArray(visibleIDs) || visibleIDs.length > PUBLIC_NOTE_LIMIT || visibleIDs.some((id) => !isPublicNoteID(id))) {
    throw new PublicNoteError("Refresh the visible notes before checking which ones you can remove.");
  }
  const scope = accountScope(uid);
  const database = getFirestore(scope.client.app);
  try {
    const receipts = await Promise.all([...new Set(visibleIDs)].map(async (id) => {
      const [note, snapshot] = await readPair(database, scope, placeID, id);
      assertAccount(scope);
      if (!snapshot.exists() || snapshot.data().placeID !== placeID) return null;
      if (!validReceipt(snapshot.data(), placeID) || !note.exists() || !(note.data().submittedAt instanceof Timestamp)
        || !snapshot.data().submittedAt.isEqual(note.data().submittedAt)) {
        throw new PublicNoteError("A note’s ownership could not be checked. Retry before removing it.");
      }
      decodeNote(id, placeID, note.data());
      return id;
    }));
    assertAccount(scope);
    return receipts.filter((id): id is string => id !== null);
  } catch (error) { assertAccount(scope); throw readableError(error); }
}

async function readConfirmedNote(database: Firestore, scope: AccountScope, placeID: string, id: string): Promise<PublicNote | null> {
  const [note, receipt] = await readPair(database, scope, placeID, id);
  assertAccount(scope);
  if (!note.exists() && !receipt.exists()) return null;
  if (!note.exists() || !receipt.exists() || !validReceipt(receipt.data(), placeID)
    || !(note.data().submittedAt instanceof Timestamp) || !receipt.data().submittedAt.isEqual(note.data().submittedAt)) {
    throw new PublicNoteError("An earlier request with this ID needs checking. Refresh the notes before creating another or removing anything.");
  }
  return decodeNote(id, placeID, note.data());
}

export async function createPublicNote(uid: string, placeID: string, id: string, input: PublicNoteInput): Promise<PublicNote> {
  assertPlace(placeID); assertNoteID(id);
  const normalized = normalizePublicNoteInput(input);
  const scope = accountScope(uid);
  const database = getFirestore(scope.client.app);
  const checkDraft = (note: PublicNote) => {
    if (!samePublicNoteInput(note, normalized)) throw new PublicNoteError("An earlier version of this note is already public. Refresh before starting a different note.");
    return note;
  };
  try {
    const existing = await readConfirmedNote(database, scope, placeID, id);
    if (existing) return checkDraft(existing);
    assertAccount(scope);
    const batch = writeBatch(database);
    batch.set(publicReference(database, placeID, id), {
      ...normalized, schemaVersion: 1, placeID, observedAt: Timestamp.fromDate(normalized.observedAt), submittedAt: serverTimestamp(),
    });
    batch.set(receiptReference(database, uid, id), { placeID, submittedAt: serverTimestamp() });
    assertAccount(scope);
    try { await batch.commit(); }
    catch (error) {
      assertAccount(scope);
      const recovered = await readConfirmedNote(database, scope, placeID, id);
      if (recovered) return checkDraft(recovered);
      throw error;
    }
    assertAccount(scope);
    const confirmed = await readConfirmedNote(database, scope, placeID, id);
    if (!confirmed) throw new PublicNoteError("The note save could not be confirmed. Retry this exact note before creating another.");
    return checkDraft(confirmed);
  } catch (error) { assertAccount(scope); throw readableError(error); }
}

export async function deletePublicNote(uid: string, placeID: string, id: string): Promise<void> {
  assertPlace(placeID); assertNoteID(id);
  const scope = accountScope(uid);
  const database = getFirestore(scope.client.app);
  try {
    const existing = await readConfirmedNote(database, scope, placeID, id);
    if (!existing) return;
    assertAccount(scope);
    const batch = writeBatch(database);
    batch.delete(publicReference(database, placeID, id));
    batch.delete(receiptReference(database, uid, id));
    try { await batch.commit(); }
    catch (error) {
      assertAccount(scope);
      if (await readConfirmedNote(database, scope, placeID, id)) throw error;
      return;
    }
    assertAccount(scope);
    if (await readConfirmedNote(database, scope, placeID, id)) throw new PublicNoteError("Removal could not be confirmed. Retry removing the same note.");
  } catch (error) { assertAccount(scope); throw readableError(error); }
}
