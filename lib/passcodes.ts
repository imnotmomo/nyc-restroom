import {
  collection, doc, getDocFromServer, getFirestore, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, Timestamp, type DocumentData, type Firestore, type WriteBatch,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import { restrooms } from "@/lib/restrooms";
import {
  isPasscodeReportID, normalizePasscodeInput, passcodeTimestampVersion, passcodeVerificationSourceForEdit, samePasscodeRevision,
  PUBLIC_PASSCODE_LIMIT, type OwnPasscode, type PasscodeInput, type PublicPasscodeReport,
} from "@/lib/passcode-model";

export { MAX_PASSCODE_LENGTH, PUBLIC_PASSCODE_LIMIT, normalizePasscodeInput } from "@/lib/passcode-model";
export type { OwnPasscode, PasscodeInput, PasscodeVisibility, PublicPasscodeReport } from "@/lib/passcode-model";

class PasscodeError extends Error {}
class PasscodeUnchanged extends Error {}
const knownPlaceIDs = new Set(restrooms.map((place) => place.id));

function requireClient(): FirebaseClient {
  const client = getFirebaseClient();
  if (!client) throw new PasscodeError(getFirebaseConfigurationError() ?? "Restroom codes aren’t connected in this build.");
  return client;
}

function assertAccount(client: FirebaseClient, uid: string, afterRequest = false): void {
  if (!uid || uid.length > 128 || uid.includes("/") || client.auth.currentUser?.uid !== uid || client.auth.currentUser.isAnonymous) {
    throw new PasscodeError(afterRequest
      ? "Your account changed while the code request was running. Reload after signing in. A completed change may belong to the previous account."
      : "Sign in with Google to save or confirm a restroom code. Public codes can be read without signing in.");
  }
}

function validatePlaceID(placeID: string): void {
  if (!knownPlaceIDs.has(placeID) && !/^community-[A-Za-z0-9]{20}$/.test(placeID)) {
    throw new PasscodeError("Choose a city or community restroom before saving a code.");
  }
}

function readableError(error: unknown): Error {
  if (error instanceof PasscodeError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
  if (code === "permission-denied") return new PasscodeError("This code request wasn’t authorized. Reload the current code after signing in before retrying. No change has been confirmed.");
  if (code === "unavailable" || code === "deadline-exceeded") return new PasscodeError("The code request couldn’t be confirmed. Check your connection and reload before retrying.");
  if (code === "unauthenticated") return new PasscodeError("Your account session needs to be refreshed. Sign in again before changing a code.");
  return new PasscodeError("Restroom codes couldn’t be loaded or saved. Please retry. The location list is still available.");
}

function timestamp(value: unknown): Timestamp {
  if (!(value instanceof Timestamp)) throw new PasscodeError("A code timestamp couldn’t be read safely. It hasn’t been replaced with a new date.");
  try { passcodeTimestampVersion(value); } catch { throw new PasscodeError("A code timestamp couldn’t be read safely. It hasn’t been replaced with a new date."); }
  return value;
}

function verification(value: unknown, updated: Timestamp): Date | null {
  if (value === null) return null;
  const verified = timestamp(value);
  if (verified.seconds < updated.seconds || (verified.seconds === updated.seconds && verified.nanoseconds < updated.nanoseconds)) {
    throw new PasscodeError("A code verification predates this version. Refresh or ask the team to check it.");
  }
  return verified.toDate();
}

function exactKeys(data: DocumentData, keys: string[]): boolean {
  return Object.keys(data).length === keys.length && keys.every((key) => Object.hasOwn(data, key));
}

function decodeOwn(placeID: string, data: DocumentData): OwnPasscode {
  if (!exactKeys(data, ["placeID", "reportID", "code", "visibility", "createdAt", "codeUpdatedAt", "lastVerifiedAt"])
    || data.placeID !== placeID || !isPasscodeReportID(data.reportID)) throw new PasscodeError("Your saved code couldn’t be read safely. It hasn’t been overwritten.");
  let input: PasscodeInput;
  try { input = normalizePasscodeInput({ code: data.code, visibility: data.visibility }); }
  catch { throw new PasscodeError("Your saved code couldn’t be read safely. It hasn’t been overwritten."); }
  if (input.code !== data.code) throw new PasscodeError("Your saved code couldn’t be read safely. It hasn’t been overwritten.");
  const created = timestamp(data.createdAt), updated = timestamp(data.codeUpdatedAt);
  if (updated.seconds < created.seconds || (updated.seconds === created.seconds && updated.nanoseconds < created.nanoseconds)) {
    throw new PasscodeError("Your code dates couldn’t be read safely. It hasn’t been overwritten.");
  }
  return { placeID, reportID: data.reportID, ...input, createdAt: created.toDate(), codeUpdatedAt: updated.toDate(), lastVerifiedAt: verification(data.lastVerifiedAt, updated), codeVersion: passcodeTimestampVersion(updated) };
}

function decodePublic(placeID: string, reportID: string, data: DocumentData): PublicPasscodeReport {
  if (!isPasscodeReportID(reportID) || data.placeID !== placeID || !exactKeys(data, ["placeID", "code", "codeUpdatedAt", "lastVerifiedAt"])) {
    throw new PasscodeError("A public code report couldn’t be read safely.");
  }
  let normalized: PasscodeInput;
  try { normalized = normalizePasscodeInput({ code: data.code, visibility: "public" }); }
  catch { throw new PasscodeError("A public code report couldn’t be read safely."); }
  if (normalized.code !== data.code) throw new PasscodeError("A public code report couldn’t be read safely.");
  const updated = timestamp(data.codeUpdatedAt);
  return { placeID, reportID, code: data.code, codeUpdatedAt: updated.toDate(), lastVerifiedAt: verification(data.lastVerifiedAt, updated), codeVersion: passcodeTimestampVersion(updated) };
}

const ownReference = (database: Firestore, uid: string, placeID: string) => doc(database, "users", uid, "restroomReadyPasscodes", placeID);
const publicReference = (database: Firestore, placeID: string, reportID: string) => doc(database, "restroomPasscodeReports", placeID, "reports", reportID);
const ownerReference = (database: Firestore, reportID: string) => doc(database, "restroomPasscodeOwners", reportID);
const favoriteReference = (database: Firestore, uid: string, placeID: string) => doc(database, "users", uid, "restroomReadySaved", placeID);
const checkReference = (database: Firestore, uid: string, reportID: string) => doc(database, "users", uid, "restroomReadyPasscodeChecks", reportID);

export function newPasscodeReportID(): string {
  return doc(collection(getFirestore(requireClient().app), "restroomPasscodeOwners")).id;
}

export function watchPublicPasscodes(placeID: string, onChange: (records: PublicPasscodeReport[]) => void, onError: (error: Error) => void): () => void {
  let active = true;
  try {
    validatePlaceID(placeID);
    const feed = query(collection(getFirestore(requireClient().app), "restroomPasscodeReports", placeID, "reports"), orderBy("codeUpdatedAt", "desc"), limit(PUBLIC_PASSCODE_LIMIT));
    const unsubscribe = onSnapshot(feed, { includeMetadataChanges: true }, (snapshot) => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const records: PublicPasscodeReport[] = [];
      let malformed = false;
      for (const item of snapshot.docs) {
        try { records.push(decodePublic(placeID, item.id, item.data())); } catch { malformed = true; }
      }
      onChange(records);
      if (malformed) onError(new PasscodeError("Some public code reports could not be read. Retry loading before using shared codes."));
    }, (error) => { if (active) onError(readableError(error)); });
    return () => { active = false; unsubscribe(); };
  } catch (error) {
    queueMicrotask(() => { if (active) onError(readableError(error)); });
    return () => { active = false; };
  }
}

export function watchOwnPasscode(uid: string, placeID: string, onChange: (record: OwnPasscode | null) => void, onError: (error: Error) => void): () => void {
  let active = true;
  try {
    validatePlaceID(placeID);
    const client = requireClient();
    assertAccount(client, uid);
    const unsubscribe = onSnapshot(ownReference(getFirestore(client.app), uid, placeID), { includeMetadataChanges: true }, (snapshot) => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      try { assertAccount(client, uid, true); onChange(snapshot.exists() ? decodeOwn(placeID, snapshot.data()) : null); }
      catch (error) { if (active) onError(readableError(error)); }
    }, (error) => { if (active) onError(readableError(error)); });
    return () => { active = false; unsubscribe(); };
  } catch (error) {
    queueMicrotask(() => { if (active) onError(readableError(error)); });
    return () => { active = false; };
  }
}

/** Server-only readback shared with atomic new-location recovery. */
export async function readOwnPasscode(uid: string, placeID: string): Promise<OwnPasscode | null> {
  validatePlaceID(placeID);
  const client = requireClient();
  assertAccount(client, uid);
  try {
    const own = await getDocFromServer(ownReference(getFirestore(client.app), uid, placeID));
    assertAccount(client, uid, true);
    return own.exists() ? decodeOwn(placeID, own.data()) : null;
  } catch (error) { assertAccount(client, uid, true); throw readableError(error); }
}

function requireExpected(current: OwnPasscode | null, expected: OwnPasscode | null): void {
  if (!samePasscodeRevision(current, expected)) throw new PasscodeError("Your saved code or who can see it changed. Load the current version before saving or deleting it.");
}

function sameTimestamp(left: unknown, right: unknown): boolean {
  return left === null && right === null || left instanceof Timestamp && right instanceof Timestamp && left.isEqual(right);
}

async function confirmSavedCode(client: FirebaseClient, uid: string, placeID: string, input: PasscodeInput): Promise<OwnPasscode> {
  const database = getFirestore(client.app);
  const own = await getDocFromServer(ownReference(database, uid, placeID));
  assertAccount(client, uid, true);
  if (!own.exists()) throw new PasscodeError("The code save couldn’t be confirmed. Reload before retrying.");
  const record = decodeOwn(placeID, own.data());
  if (record.code !== input.code || record.visibility !== input.visibility) throw new PasscodeError("The saved code changed before it could refresh. Load the current version before trying again.");
  const owner = await getDocFromServer(ownerReference(database, record.reportID));
  assertAccount(client, uid, true);
  if (!owner.exists() || !exactKeys(owner.data(), ["ownerUID", "placeID", "createdAt"])
    || owner.data().ownerUID !== uid || owner.data().placeID !== placeID || !sameTimestamp(owner.data().createdAt, own.data().createdAt)) {
    throw new PasscodeError("The code save receipt couldn’t be confirmed. Reload before retrying.");
  }
  if (record.visibility === "public") {
    const shared = await getDocFromServer(publicReference(database, placeID, record.reportID));
    assertAccount(client, uid, true);
    if (!shared.exists()) throw new PasscodeError("The public code save couldn’t be confirmed. Reload before retrying.");
    const report = decodePublic(placeID, record.reportID, shared.data());
    if (report.code !== record.code || report.codeVersion !== record.codeVersion) throw new PasscodeError("The public code changed before it could refresh. Load the current version before trying again.");
  } else {
    const shared = await getDocFromServer(publicReference(database, placeID, record.reportID));
    assertAccount(client, uid, true);
    if (shared.exists()) throw new PasscodeError("Your code's privacy couldn’t be confirmed. Reload before trying again.");
    const saved = await getDocFromServer(favoriteReference(database, uid, placeID));
    assertAccount(client, uid, true);
    if (!saved.exists() || saved.data().placeID !== placeID) throw new PasscodeError("Your code was saved, but the saved-place confirmation is unavailable. Reload before retrying.");
  }
  return record;
}

/** Appends to the same new-restroom batch; private content never enters its public listing. */
export function appendInitialPasscodeWrites(batch: WriteBatch, database: Firestore, uid: string, placeID: string, input: PasscodeInput, reportID = newPasscodeReportID()): string {
  const normalized = normalizePasscodeInput(input);
  if (!isPasscodeReportID(reportID)) throw new PasscodeError("This code request ID is invalid. Reopen the form before saving.");
  batch.set(ownerReference(database, reportID), { ownerUID: uid, placeID, createdAt: serverTimestamp() });
  batch.set(ownReference(database, uid, placeID), {
    placeID, reportID, ...normalized, createdAt: serverTimestamp(), codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null,
  });
  if (normalized.visibility === "private") batch.set(favoriteReference(database, uid, placeID), { placeID, savedAt: serverTimestamp() });
  else batch.set(publicReference(database, placeID, reportID), { placeID, code: normalized.code, codeUpdatedAt: serverTimestamp(), lastVerifiedAt: null });
  return reportID;
}

export async function confirmInitialPasscode(uid: string, placeID: string, input: PasscodeInput): Promise<OwnPasscode> {
  const client = requireClient();
  assertAccount(client, uid);
  try { return await confirmSavedCode(client, uid, placeID, normalizePasscodeInput(input)); }
  catch (error) { assertAccount(client, uid, true); throw readableError(error); }
}

export async function savePasscode(uid: string, placeID: string, input: PasscodeInput, expected: OwnPasscode | null): Promise<OwnPasscode> {
  validatePlaceID(placeID);
  let normalized: PasscodeInput;
  try { normalized = normalizePasscodeInput(input); } catch { throw new PasscodeError("Check the code and who can see it before saving. Use 1–40 standard keyboard characters."); }
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app), candidateID = newPasscodeReportID();
  let attemptedWrite = false;
  try {
    await runTransaction(database, async (transaction) => {
      let hasWrites = false;
      assertAccount(client, uid, true);
      const own = await transaction.get(ownReference(database, uid, placeID));
      assertAccount(client, uid, true);
      const current = own.exists() ? decodeOwn(placeID, own.data()) : null;
      requireExpected(current, expected);
      const reportID = current?.reportID ?? candidateID;
      const shared = await transaction.get(publicReference(database, placeID, reportID));
      assertAccount(client, uid, true);
      const saved = normalized.visibility === "private" ? await transaction.get(favoriteReference(database, uid, placeID)) : null;
      assertAccount(client, uid, true);
      if (current?.visibility === "public") {
        if (!shared.exists()) throw new PasscodeError("Your public code could not be confirmed. Reload before changing it.");
        const report = decodePublic(placeID, reportID, shared.data());
        if (report.code !== current.code || report.codeVersion !== current.codeVersion) throw new PasscodeError("Your public code changed. Load the current version before saving.");
      } else if (shared.exists()) throw new PasscodeError("The code's visibility could not be confirmed. Reload before changing it.");
      const sameCode = current?.code === normalized.code;
      const verificationSource = passcodeVerificationSourceForEdit(current, normalized);
      const verified = verificationSource === "public" ? shared.data()!.lastVerifiedAt : verificationSource === "private" ? own.data()!.lastVerifiedAt : null;
      const updated = sameCode ? own.data()!.codeUpdatedAt : serverTimestamp();
      const ownChanged = !current || !sameCode || current.visibility !== normalized.visibility || !sameTimestamp(own.data()!.lastVerifiedAt, verified);
      if (ownChanged) {
        attemptedWrite = true; hasWrites = true;
        transaction.set(ownReference(database, uid, placeID), {
          placeID, reportID, ...normalized, createdAt: current ? own.data()!.createdAt : serverTimestamp(), codeUpdatedAt: updated, lastVerifiedAt: verified,
        });
      }
      if (!current) {
        attemptedWrite = true; hasWrites = true;
        transaction.set(ownerReference(database, reportID), { ownerUID: uid, placeID, createdAt: serverTimestamp() });
      }
      if (normalized.visibility === "public" && (!current || current.visibility !== "public" || !sameCode)) {
        attemptedWrite = true; hasWrites = true;
        transaction.set(publicReference(database, placeID, reportID), { placeID, code: normalized.code, codeUpdatedAt: updated, lastVerifiedAt: verified });
      } else if (normalized.visibility === "private" && shared.exists()) {
        attemptedWrite = true; hasWrites = true;
        transaction.delete(publicReference(database, placeID, reportID));
      }
      if (normalized.visibility === "private" && !saved?.exists()) {
        attemptedWrite = true; hasWrites = true;
        transaction.set(favoriteReference(database, uid, placeID), { placeID, savedAt: serverTimestamp() });
      }
      assertAccount(client, uid, true);
      if (!hasWrites) throw new PasscodeUnchanged();
    });
    assertAccount(client, uid, true);
    return await confirmSavedCode(client, uid, placeID, normalized);
  } catch (error) {
    assertAccount(client, uid, true);
    if (error instanceof PasscodeUnchanged) return await confirmSavedCode(client, uid, placeID, normalized);
    if (attemptedWrite && !(error instanceof PasscodeError)) {
      try { return await confirmSavedCode(client, uid, placeID, normalized); } catch { assertAccount(client, uid, true); }
    }
    throw readableError(error);
  }
}

export async function deleteOwnPasscode(uid: string, placeID: string, expected: OwnPasscode): Promise<void> {
  validatePlaceID(placeID);
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  async function confirmAbsent(): Promise<void> {
    const owner = await getDocFromServer(ownerReference(database, expected.reportID));
    assertAccount(client, uid, true);
    const shared = await getDocFromServer(publicReference(database, placeID, expected.reportID));
    assertAccount(client, uid, true);
    const own = await getDocFromServer(ownReference(database, uid, placeID));
    assertAccount(client, uid, true);
    if (own.exists() || owner.exists() || shared.exists()) throw new PasscodeError("A code is still saved for this place. Load the current version before trying again.");
  }
  try {
    await runTransaction(database, async (transaction) => {
      assertAccount(client, uid, true);
      const own = await transaction.get(ownReference(database, uid, placeID));
      assertAccount(client, uid, true);
      if (!own.exists()) {
        const [owner, shared] = await Promise.all([transaction.get(ownerReference(database, expected.reportID)), transaction.get(publicReference(database, placeID, expected.reportID))]);
        assertAccount(client, uid, true);
        if (owner.exists() || shared.exists()) throw new PasscodeError("This code's removal could not be confirmed. Reload before trying again.");
        throw new PasscodeUnchanged();
      }
      const current = decodeOwn(placeID, own.data());
      requireExpected(current, expected);
      transaction.delete(ownReference(database, uid, placeID));
      transaction.delete(ownerReference(database, current.reportID));
      if (current.visibility === "public") transaction.delete(publicReference(database, placeID, current.reportID));
      assertAccount(client, uid, true);
    });
    assertAccount(client, uid, true);
    await confirmAbsent();
  } catch (error) {
    assertAccount(client, uid, true);
    if (error instanceof PasscodeUnchanged) { await confirmAbsent(); return; }
    throw readableError(error);
  }
}

export async function verifyOwnPasscode(uid: string, placeID: string, expected: OwnPasscode): Promise<OwnPasscode> {
  validatePlaceID(placeID);
  if (expected.placeID !== placeID) throw new PasscodeError("Choose the current restroom code before confirming it.");
  if (expected.visibility === "public") {
    await verifyPublicPasscode(uid, expected);
    const own = await readOwnPasscode(uid, placeID);
    if (!own) throw new PasscodeError("Your saved code changed before it could refresh. Reload the current version.");
    requireExpected(own, expected);
    return own;
  }
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  try {
    await runTransaction(database, async (transaction) => {
      assertAccount(client, uid, true);
      const own = await transaction.get(ownReference(database, uid, placeID));
      assertAccount(client, uid, true);
      const current = own.exists() ? decodeOwn(placeID, own.data()) : null;
      requireExpected(current, expected);
      if (!current || current.visibility !== "private") throw new PasscodeError("This code's visibility changed. Reload before confirming it.");
      const saved = await transaction.get(favoriteReference(database, uid, placeID));
      assertAccount(client, uid, true);
      transaction.update(ownReference(database, uid, placeID), { lastVerifiedAt: serverTimestamp() });
      if (!saved.exists()) transaction.set(favoriteReference(database, uid, placeID), { placeID, savedAt: serverTimestamp() });
      assertAccount(client, uid, true);
    });
    assertAccount(client, uid, true);
    const confirmed = await confirmSavedCode(client, uid, placeID, { code: expected.code, visibility: "private" });
    requireExpected(confirmed, expected);
    return confirmed;
  } catch (error) { assertAccount(client, uid, true); throw readableError(error); }
}

export async function verifyPublicPasscode(uid: string, expected: PublicPasscodeReport): Promise<PublicPasscodeReport> {
  validatePlaceID(expected.placeID);
  if (!isPasscodeReportID(expected.reportID)) throw new PasscodeError("Choose a current public code before confirming it.");
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  try {
    await runTransaction(database, async (transaction) => {
      assertAccount(client, uid, true);
      const shared = await transaction.get(publicReference(database, expected.placeID, expected.reportID));
      assertAccount(client, uid, true);
      if (!shared.exists()) throw new PasscodeError("This code is no longer public. Reload the current reports.");
      const current = decodePublic(expected.placeID, expected.reportID, shared.data());
      if (current.codeVersion !== expected.codeVersion || current.code !== expected.code) throw new PasscodeError("This code changed after you opened it. Reload before confirming that it worked.");
      transaction.update(publicReference(database, expected.placeID, expected.reportID), { lastVerifiedAt: serverTimestamp() });
      transaction.set(checkReference(database, uid, expected.reportID), { placeID: expected.placeID, codeUpdatedAt: shared.data().codeUpdatedAt, verifiedAt: serverTimestamp() });
      assertAccount(client, uid, true);
    });
    assertAccount(client, uid, true);
    const shared = await getDocFromServer(publicReference(database, expected.placeID, expected.reportID));
    assertAccount(client, uid, true);
    if (!shared.exists()) throw new PasscodeError("The code was confirmed, but it is no longer public. Reload the current reports.");
    const result = decodePublic(expected.placeID, expected.reportID, shared.data());
    if (result.codeVersion !== expected.codeVersion) throw new PasscodeError("The code changed after your confirmation. Its new version has not been confirmed by this action.");
    const check = await getDocFromServer(checkReference(database, uid, expected.reportID));
    assertAccount(client, uid, true);
    if (!check.exists() || !exactKeys(check.data(), ["placeID", "codeUpdatedAt", "verifiedAt"])
      || check.data().placeID !== expected.placeID || !sameTimestamp(check.data().codeUpdatedAt, shared.data().codeUpdatedAt)
      || !(check.data().verifiedAt instanceof Timestamp)) throw new PasscodeError("Your confirmation receipt couldn’t be refreshed. Reload before trying again.");
    return result;
  } catch (error) { assertAccount(client, uid, true); throw readableError(error); }
}
