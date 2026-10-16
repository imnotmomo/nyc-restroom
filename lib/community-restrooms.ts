import {
  collection, doc, getDocFromServer, getFirestore, limit, onSnapshot, orderBy, query,
  serverTimestamp, Timestamp, writeBatch, type DocumentData, type Firestore,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import {
  isCommunityRestroomID, normalizeCommunityRestroomInput, normalizeRecordedCommunityRestroomInput, sameCommunityRestroomInput,
  type CommunityRestroomInput, type CommunityRestroomRecord,
} from "@/lib/community-restroom-model";
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
  if (!uid || client.auth.currentUser?.uid !== uid) throw new CommunityRestroomError(afterRequest
    ? "Your account changed while this restroom was being saved. Search the map after signing in before submitting it again."
    : "Sign in with Google to log a new restroom.");
  if (client.auth.currentUser.isAnonymous) throw new CommunityRestroomError("Sign in with Google to log a new restroom. You can browse community listings without signing in.");
}

function readableError(error: unknown): Error {
  if (error instanceof CommunityRestroomError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
  if (code === "permission-denied") return new CommunityRestroomError("This restroom request wasn’t authorized. Sign in again and retry with the same form. No save has been confirmed.");
  if (code === "unavailable" || code === "deadline-exceeded") return new CommunityRestroomError("The restroom save couldn’t be confirmed. Check your connection and retry this form so the same request is checked before another save.");
  if (code === "unauthenticated") return new CommunityRestroomError("Your account session needs to be refreshed. Sign in again before logging a restroom.");
  return new CommunityRestroomError("Community restrooms couldn’t be loaded or saved. Please retry. The NYC source listings are still available.");
}

function decodeRecord(id: string, data: DocumentData): CommunityRestroomRecord {
  if (!isCommunityRestroomID(id) || Object.keys(data).length !== 10 || !(data.submittedAt instanceof Timestamp)
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
    communitySource: { submittedAt: record.submittedAt.toISOString(), observedOn: record.observedOn, entryRule: record.entryRule, stepFreeAccess: record.stepFreeAccess },
  };
}

async function readConfirmedSubmission(database: Firestore, client: FirebaseClient, uid: string, id: string): Promise<CommunityRestroomRecord | null> {
  const listing = await getDocFromServer(doc(database, "communityRestrooms", id));
  assertAccount(client, uid, true);
  const receipt = await getDocFromServer(doc(database, "restroomSubmissions", id));
  assertAccount(client, uid, true);
  if (!listing.exists() && !receipt.exists()) return null;
  if (!listing.exists() || !receipt.exists() || receipt.data().ownerUID !== uid
    || Object.keys(receipt.data()).length !== 2 || !(receipt.data().submittedAt instanceof Timestamp)) {
    throw new CommunityRestroomError("An earlier request with this ID needs to be checked. Search the map before logging this restroom again.");
  }
  const record = decodeRecord(listing.id, listing.data());
  if (!receipt.data().submittedAt.isEqual(listing.data().submittedAt)) throw new CommunityRestroomError("This restroom’s save receipt couldn’t be confirmed. Search the map before submitting it again.");
  const summary = await getDocFromServer(doc(database, "restroomRatingSummaries", id));
  assertAccount(client, uid, true);
  if (!summary.exists()) throw new CommunityRestroomError("The listing was saved, but its rating setup couldn’t be confirmed. Search the map before logging it again.");
  return record;
}

export async function createCommunityRestroom(uid: string, input: CommunityRestroomInput, id = newCommunityRestroomID()): Promise<CommunityRestroomRecord> {
  const normalized = normalizeCommunityRestroomInput(input);
  if (!isCommunityRestroomID(id)) throw new CommunityRestroomError("This form’s request ID is invalid. Reopen the form before submitting.");
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  try {
    const existing = await readConfirmedSubmission(database, client, uid, id);
    if (existing) {
      if (!sameCommunityRestroomInput(existing, normalized)) throw new CommunityRestroomError("An earlier version of this form was already saved. Close the form and find that restroom on the map before logging it again.");
      return existing;
    }
    assertAccount(client, uid, true);
    const batch = writeBatch(database);
    batch.set(doc(database, "communityRestrooms", id), {
      ...normalized, observedOn: normalized.observedOn === null ? null : Timestamp.fromDate(new Date(`${normalized.observedOn}T00:00:00.000Z`)), submittedAt: serverTimestamp(),
    });
    batch.set(doc(database, "restroomSubmissions", id), { ownerUID: uid, submittedAt: serverTimestamp() });
    batch.set(doc(database, "restroomRatingSummaries", id), { ratingCount: 0, ratingSum: 0, updatedAt: serverTimestamp() });
    assertAccount(client, uid, true);
    try { await batch.commit(); }
    catch (error) {
      assertAccount(client, uid, true);
      // A repeated in-flight request can commit first. Only a matching server receipt is success.
      const recovered = await readConfirmedSubmission(database, client, uid, id);
      if (!recovered) throw error;
      if (!sameCommunityRestroomInput(recovered, normalized)) throw new CommunityRestroomError("An earlier version of this form was already saved. Close the form and find that restroom on the map before logging it again.");
      return recovered;
    }
    assertAccount(client, uid, true);
    const confirmed = await readConfirmedSubmission(database, client, uid, id);
    if (!confirmed || !sameCommunityRestroomInput(confirmed, normalized)) throw new CommunityRestroomError("The restroom save couldn’t be confirmed. Retry this form before creating a new request.");
    return confirmed;
  } catch (error) { assertAccount(client, uid, true); throw readableError(error); }
}
