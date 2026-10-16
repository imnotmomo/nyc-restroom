import type { Auth } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocsFromServer,
  getFirestore,
  serverTimestamp,
  setDoc,
  Timestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError } from "@/lib/firebase-client";
import { restrooms } from "@/lib/restrooms";

export type VisitCondition = "not-reported" | "usable" | "needs-attention";
export type VisitAnswer = "not-reported" | "yes" | "no";

export interface VisitNote {
  id: string;
  placeID: string;
  observedAt: Date;
  submittedAt: Date | null;
  condition: VisitCondition;
  soap: VisitAnswer;
  toiletPaper: VisitAnswer;
  stairs: VisitAnswer;
  entryNote: string;
}

export type VisitNoteInput = Omit<VisitNote, "id" | "submittedAt">;

interface AccountScope { uid: string; auth: Auth; database: Firestore }
const placeIDs = new Set(restrooms.map((place) => place.id));
const firstObservation = Date.UTC(2000, 0, 1);
const conditions = new Set<string>(["not-reported", "usable", "needs-attention"]);
const answers = new Set<string>(["not-reported", "yes", "no"]);

class UserDataError extends Error {}

function requireAccount(uid: string): AccountScope {
  const client = getFirebaseClient();
  if (!client) {
    throw new UserDataError(getFirebaseConfigurationError() ?? "Account storage isn’t connected yet. You can still browse.");
  }
  if (!uid || uid.length > 128 || uid.includes("/") || client.auth.currentUser?.uid !== uid) {
    throw new UserDataError("Sign in to save places and private visit notes to your account.");
  }
  // The default Web SDK cache is memory-only; persistent disk caching is not enabled.
  return { uid, auth: client.auth, database: getFirestore(client.app) };
}

function assertSameAccount(scope: AccountScope): void {
  if (scope.auth.currentUser?.uid !== scope.uid) {
    throw new UserDataError("Your account changed while the request was running. Refresh your saved places after signing in. A completed write may belong to the previous account.");
  }
}

function readableError(error: unknown): Error {
  if (error instanceof UserDataError) return error;
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code).replace(/^firestore\//, "") : "";
  switch (code) {
    case "permission-denied":
      return new UserDataError("Your account can’t access Restroom Ready storage yet. The project owner needs to check the scoped Firestore rules. Your change hasn’t been confirmed.");
    case "unauthenticated":
      return new UserDataError("Your session needs to be refreshed. Sign in again, then retry your change.");
    case "unavailable":
    case "deadline-exceeded":
      return new UserDataError("Firestore couldn’t be reached. Check your connection and retry. Your change hasn’t been confirmed in the cloud.");
    case "resource-exhausted":
      return new UserDataError("Account storage is temporarily at its limit. Please try again later. Your change hasn’t been confirmed.");
    default:
      return new UserDataError("Your account data couldn’t be loaded or saved. Please try again. Browsing is still available.");
  }
}

async function inAccount<T>(uid: string, operation: (scope: AccountScope) => Promise<T>): Promise<T> {
  let scope: AccountScope;
  try { scope = requireAccount(uid); }
  catch (error) { throw readableError(error); }
  try {
    const result = await operation(scope);
    assertSameAccount(scope);
    return result;
  } catch (error) {
    assertSameAccount(scope);
    throw readableError(error);
  }
}

function validatePlaceID(placeID: string): void {
  if (!validStoredPlaceID(placeID) || (!placeIDs.has(placeID) && !/^community-[A-Za-z0-9]{20}$/.test(placeID))) {
    throw new UserDataError("This place isn’t a city or community listing. It wasn’t saved.");
  }
}

function validStoredPlaceID(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

function malformedRecord(): never {
  throw new UserDataError("Some saved account data couldn’t be read. It hasn’t been overwritten. Ask the team to check the record format.");
}

function dateFromTimestamp(value: unknown): Date {
  if (!(value instanceof Timestamp)) return malformedRecord();
  const date = value.toDate();
  if (!Number.isFinite(date.getTime())) return malformedRecord();
  return date;
}

function decodeNote(snapshot: QueryDocumentSnapshot<DocumentData>): VisitNote {
  const data = snapshot.data();
  if (!/^[A-Za-z0-9]{20}$/.test(snapshot.id)
    || !validStoredPlaceID(data.placeID)
    || typeof data.condition !== "string" || !conditions.has(data.condition)
    || typeof data.soap !== "string" || !answers.has(data.soap)
    || typeof data.toiletPaper !== "string" || !answers.has(data.toiletPaper)
    || typeof data.stairs !== "string" || !answers.has(data.stairs)
    || typeof data.entryNote !== "string" || data.entryNote.length > 1_000) return malformedRecord();
  const observedAt = dateFromTimestamp(data.observedAt);
  if (observedAt.getTime() < firstObservation) return malformedRecord();
  const submittedAt = data.submittedAt == null ? null : dateFromTimestamp(data.submittedAt);
  return {
    id: snapshot.id,
    placeID: data.placeID,
    observedAt,
    submittedAt,
    condition: data.condition as VisitCondition,
    soap: data.soap as VisitAnswer,
    toiletPaper: data.toiletPaper as VisitAnswer,
    stairs: data.stairs as VisitAnswer,
    entryNote: data.entryNote,
  };
}

export async function readLibrary(uid: string): Promise<{ favoriteIDs: string[]; notes: VisitNote[] }> {
  return inAccount(uid, async (scope) => {
    const saved = await getDocsFromServer(collection(scope.database, "users", uid, "restroomReadySaved"));
    assertSameAccount(scope);
    const notes = await getDocsFromServer(collection(scope.database, "users", uid, "restroomReadyNotes"));
    assertSameAccount(scope);
    const favoriteIDs = saved.docs.map((snapshot) => {
      const data = snapshot.data();
      if (data.placeID !== snapshot.id || !validStoredPlaceID(snapshot.id)) return malformedRecord();
      dateFromTimestamp(data.savedAt);
      return snapshot.id;
    });
    return { favoriteIDs, notes: notes.docs.map(decodeNote).sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()) };
  });
}

export async function setFavorite(uid: string, placeID: string, saved: boolean): Promise<void> {
  validatePlaceID(placeID);
  return inAccount(uid, async (scope) => {
    const reference = doc(scope.database, "users", uid, "restroomReadySaved", placeID);
    if (saved) await setDoc(reference, { placeID, savedAt: serverTimestamp() });
    else await deleteDoc(reference);
  });
}

export async function saveVisitNote(uid: string, input: VisitNoteInput): Promise<void> {
  validatePlaceID(input.placeID);
  const observed = input.observedAt instanceof Date ? input.observedAt.getTime() : NaN;
  if (!Number.isFinite(observed) || observed < firstObservation || observed > Date.now()) {
    throw new UserDataError("Choose a visit date between January 1, 2000 and now. Future observations can’t be saved.");
  }
  if (!conditions.has(input.condition) || ![input.soap, input.toiletPaper, input.stairs].every((answer) => answers.has(answer))) {
    throw new UserDataError("Choose one of the listed answers for each visit detail.");
  }
  if (typeof input.entryNote !== "string" || input.entryNote.trim().length > 1_000) {
    throw new UserDataError("Keep your entry note within 1,000 characters.");
  }
  return inAccount(uid, async (scope) => {
    await addDoc(collection(scope.database, "users", uid, "restroomReadyNotes"), {
      placeID: input.placeID,
      observedAt: Timestamp.fromDate(input.observedAt),
      submittedAt: serverTimestamp(),
      condition: input.condition,
      soap: input.soap,
      toiletPaper: input.toiletPaper,
      stairs: input.stairs,
      entryNote: input.entryNote.trim(),
    });
  });
}

export async function deleteVisitNote(uid: string, noteID: string): Promise<void> {
  if (!/^[A-Za-z0-9]{20}$/.test(noteID)) throw new UserDataError("This visit note has an invalid record ID. It wasn’t deleted.");
  return inAccount(uid, async (scope) => {
    await deleteDoc(doc(scope.database, "users", uid, "restroomReadyNotes", noteID));
  });
}
