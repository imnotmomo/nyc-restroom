import {
  collection, doc, getFirestore, limit, onSnapshot, orderBy, query, runTransaction,
  serverTimestamp, Timestamp, writeBatch, type DocumentData, type Firestore,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import {
  isCommunityRestroomID, normalizeCommunityRestroomInput, normalizeRecordedCommunityRestroomInput, sameCommunityRestroomInput,
  type CommunityRestroomInput, type CommunityRestroomRecord, type LogRestroomInput,
} from "@/lib/community-restroom-model";
import { normalizePasscodeInput, type PasscodeInput } from "@/lib/passcode-model";
import { normalizeRestroomRequestEnvelope, restroomRequestCodeFingerprint, type RestroomRequestConfirmation } from "@/lib/restroom-request-model";
import type { Restroom } from "@/lib/restrooms";
export type { CommunityRestroomInput, CommunityRestroomRecord, LogRestroomInput } from "@/lib/community-restroom-model";
export { COMMUNITY_RESTROOM_BOUNDS, isCommunityRestroomID } from "@/lib/community-restroom-model";

export const COMMUNITY_FEED_LIMIT = 1000;
class CommunityRestroomError extends Error {}

function requireClient(): FirebaseClient {
  const client = getFirebaseClient();
  if (!client) throw new CommunityRestroomError(getFirebaseConfigurationError() ?? "Community restroom logging isn’t connected in this build.");
  return client;
}

function assertAccount(client: FirebaseClient, uid: string, afterRequest = false): void {
  const user = client.auth.currentUser;
  if (!uid || !user || user.isAnonymous) throw new CommunityRestroomError(afterRequest
    ? "Your account changed during this request. Return to the original account and retry the same form before submitting another request."
    : "Sign in with Google to request a new restroom. You can browse community listings without signing in.");
  if (user.uid !== uid) throw new CommunityRestroomError("Your account changed during this request. Return to the original account and retry the same form before submitting another request.");
}

function readableError(error: unknown): Error {
  if (error instanceof CommunityRestroomError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
  if (code === "permission-denied") return new CommunityRestroomError("This restroom request wasn’t authorized. Sign in again and retry with the same form. No submission has been confirmed.");
  if (code === "unavailable" || code === "deadline-exceeded") return new CommunityRestroomError("The restroom request could not be confirmed. Check your connection and retry the same form before creating another request.");
  if (code === "unauthenticated") return new CommunityRestroomError("Your account session needs to be refreshed. Sign in again before submitting the same request.");
  return new CommunityRestroomError("The restroom request could not be confirmed. Retry the same form before creating another request. Other map listings are still available.");
}

function decodeRecord(id: string, data: DocumentData): CommunityRestroomRecord {
  if (!isCommunityRestroomID(id) || ![10, 11].includes(Object.keys(data).length) || !(data.submittedAt instanceof Timestamp)
    || !Number.isFinite(data.submittedAt.toMillis()) || (data.observedOn !== null && !(data.observedOn instanceof Timestamp))) {
    throw new CommunityRestroomError("A community restroom couldn’t be read safely. Refresh or ask the team to check its format.");
  }
  if (data.observedOn instanceof Timestamp && data.observedOn.toMillis() % 86_400_000 !== 0) {
    throw new CommunityRestroomError("A community observation date couldn’t be read safely. It hasn’t been replaced with a submission date.");
  }
  const { submittedAt, observedOn, ...fields } = data;
  try {
    const normalized = normalizeRecordedCommunityRestroomInput({ ...fields, observedOn: observedOn === null ? null : observedOn.toDate().toISOString().slice(0, 10) }, submittedAt.toDate());
    return { id, ...normalized, submittedAt: submittedAt.toDate() };
  } catch {
    throw new CommunityRestroomError("A community restroom couldn’t be read safely. Refresh or ask the team to check its details.");
  }
}

export function newCommunityRestroomID(): string {
  return `community-${doc(collection(getFirestore(requireClient().app), "communityRestrooms")).id}`;
}

export function watchCommunityRestrooms(
  onChange: (records: CommunityRestroomRecord[]) => void,
  onError: (error: Error) => void,
): () => void {
  try {
    const database = getFirestore(requireClient().app);
    const feed = query(collection(database, "communityRestrooms"), orderBy("submittedAt", "desc"), limit(COMMUNITY_FEED_LIMIT));
    return onSnapshot(feed, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const records: CommunityRestroomRecord[] = [];
      let hidden = 0;
      for (const document of snapshot.docs) {
        try { records.push(decodeRecord(document.id, document.data())); }
        catch { hidden += 1; }
      }
      onChange(records);
      if (hidden > 0) onError(new CommunityRestroomError("Some visitor submissions could not be read and are hidden. Other available locations are still shown."));
    }, (error) => onError(readableError(error)));
  } catch (error) {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) onError(readableError(error)); });
    return () => { cancelled = true; };
  }
}

/** Convert only reported facts; unknown facts remain null and never imply certification. */
export function communityRestroomToPlace(record: CommunityRestroomRecord): Restroom {
  return {
    id: record.id, name: record.name, address: record.address, latitude: record.latitude, longitude: record.longitude,
    locationType: ({ park: "Park", library: "Library", cafe: "Café", restaurant: "Restaurant", store: "Store", other: "Other" })[record.locationType],
    operator: null, publishedStatus: null, seasonality: null, hours: null, facilityAccessibility: null,
    restroomType: null, changingStations: null, accessNotes: record.notes || null, website: null,
    sourceRecordId: null, sourceRecordIds: [], sourceUrl: null, neighborhood: null,
    purchaseRequired: null,
    restroomFloor: null, stairsToRestroom: null,
    cleanliness: null, observationDate: record.observedOn,
    communitySource: { submittedAt: record.submittedAt.toISOString(), observedOn: record.observedOn, entryRule: record.entryRule, stepFreeAccess: record.stepFreeAccess, passcodeRequired: record.passcodeRequired ?? "unknown" },
  };
}

/** Confirm a coherent private request/reservation pair from one server snapshot. */
async function readConfirmedSubmission(
  database: Firestore, uid: string, id: string, assertCurrent: () => void,
  expected: CommunityRestroomInput, passcode: PasscodeInput | null, fingerprint: string | null,
): Promise<RestroomRequestConfirmation | null> {
  assertCurrent();
  const [request, receipt] = await runTransaction(database, async (transaction) => {
    assertCurrent();
    return Promise.all([
      transaction.get(doc(database, "users", uid, "restroomReadySubmissionRequests", id)),
      transaction.get(doc(database, "restroomSubmissions", id)),
    ]);
  });
  assertCurrent();
  if (!request.exists() && !receipt.exists()) return null;
  const unsafe = () => new CommunityRestroomError("An earlier request with this ID could not be confirmed safely. Keep this form and retry before creating another request.");
  if (!request.exists() || !receipt.exists()) throw unsafe();
  try {
    const data = normalizeRestroomRequestEnvelope(request.data());
    const reservation = receipt.data();
    if (Object.keys(reservation).length !== 2 || reservation.ownerUID !== uid
      || !(reservation.submittedAt instanceof Timestamp) || !(data.submittedAt instanceof Timestamp)
      || !reservation.submittedAt.isEqual(data.submittedAt)
      || Object.keys(data.listing).length !== 11 || !Object.hasOwn(data.listing, "passcodeRequired")
      || !(data.listing.submittedAt instanceof Timestamp) || !data.listing.submittedAt.isEqual(data.submittedAt)) throw unsafe();
    const record = decodeRecord(id, data.listing);
    if (!sameCommunityRestroomInput(record, expected)) {
      throw new CommunityRestroomError("An earlier version of this form was already submitted. Retry the original details to check that request.");
    }
    if (data.status === "pending") {
      if (data.codeDraft && record.passcodeRequired !== "yes") throw unsafe();
      if ((data.codeDraft === null) !== (passcode === null)
        || (data.codeDraft && passcode && (data.codeDraft.code !== passcode.code || data.codeDraft.visibility !== passcode.visibility))) {
        throw new CommunityRestroomError("An earlier version of this form was already submitted with different code details. Retry the original details to check that request.");
      }
    } else {
      if ((data.codeFingerprint !== null && record.passcodeRequired !== "yes")
        || !(data.reviewedAt instanceof Timestamp) || data.reviewedAt.seconds < data.submittedAt.seconds
        || (data.reviewedAt.seconds === data.submittedAt.seconds && data.reviewedAt.nanoseconds < data.submittedAt.nanoseconds)) throw unsafe();
      if (data.codeFingerprint !== fingerprint) {
        throw new CommunityRestroomError("An earlier version of this form was already reviewed with different code details. Retry the original details to check that request.");
      }
    }
    return {
      id, status: data.status, revision: data.revision, submittedAt: data.submittedAt.toDate(),
      reviewedAt: data.reviewedAt instanceof Timestamp ? data.reviewedAt.toDate() : null, reason: data.reason,
    };
  } catch (error) {
    if (error instanceof CommunityRestroomError) throw error;
    throw unsafe();
  }
}

export async function createCommunityRestroom(uid: string, input: LogRestroomInput, id = newCommunityRestroomID()): Promise<RestroomRequestConfirmation> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw new CommunityRestroomError("Check the restroom details before submitting.");
  // Keep code content and privacy out of the immutable venue payload and public map.
  const { passcode: passcodeDraft, ...listingInput } = input;
  const normalized = normalizeCommunityRestroomInput(listingInput);
  let passcode: PasscodeInput | null;
  try { passcode = passcodeDraft === undefined ? null : normalizePasscodeInput(passcodeDraft); }
  catch { throw new CommunityRestroomError("Check the optional code and who can see it. Use 1–40 standard keyboard characters."); }
  if (passcode && normalized.passcodeRequired !== "yes") throw new CommunityRestroomError("Choose Code required before adding an optional code.");
  if (!isCommunityRestroomID(id)) throw new CommunityRestroomError("This form’s request ID is invalid. Reopen the form before submitting.");
  const client = requireClient();
  assertAccount(client, uid);
  const sessionUser = client.auth.currentUser;
  const assertCurrent = () => {
    assertAccount(client, uid, true);
    if (client.auth.currentUser !== sessionUser) throw new CommunityRestroomError("Your account changed during this request. Return to the original account and retry the same form before submitting another request.");
  };
  const database = getFirestore(client.app);
  try {
    const fingerprint = await restroomRequestCodeFingerprint(passcode);
    assertCurrent();
    const confirm = () => readConfirmedSubmission(database, uid, id, assertCurrent, normalized, passcode, fingerprint);
    const existing = await confirm();
    if (existing) return existing;
    assertCurrent();
    const batch = writeBatch(database);
    const submittedAt = serverTimestamp();
    batch.set(doc(database, "users", uid, "restroomReadySubmissionRequests", id), {
      schemaVersion: 1, status: "pending", revision: 1, submittedAt,
      listing: { ...normalized, observedOn: normalized.observedOn === null ? null : Timestamp.fromDate(new Date(`${normalized.observedOn}T00:00:00.000Z`)), submittedAt },
      codeDraft: passcode,
    });
    batch.set(doc(database, "restroomSubmissions", id), { ownerUID: uid, submittedAt });
    assertCurrent();
    try { await batch.commit(); }
    catch (error) {
      assertCurrent();
      // Lost acknowledgements and concurrent retries succeed only for the exact original pair.
      const recovered = await confirm();
      if (!recovered) throw error;
      return recovered;
    }
    assertCurrent();
    const confirmed = await confirm();
    if (!confirmed) throw new CommunityRestroomError("The restroom request could not be confirmed. Retry this form before creating another request.");
    return confirmed;
  } catch (error) { assertCurrent(); throw readableError(error); }
}
