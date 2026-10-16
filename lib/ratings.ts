import {
  collection, doc, getDocFromServer, getFirestore, increment, onSnapshot,
  query, runTransaction, serverTimestamp, Timestamp, where,
  type DocumentData,
} from "firebase/firestore";
import { getFirebaseClient, getFirebaseConfigurationError, type FirebaseClient } from "@/lib/firebase-client";
import { applyRatingChange, isValidRatingTotals, isValidStars } from "@/lib/rating-model";
import { restrooms } from "@/lib/restrooms";

export interface RatingSummary {
  placeID: string;
  ratingCount: number;
  ratingSum: number;
  average: number;
  updatedAt: Date;
}

export interface OwnRating { stars: number; updatedAt: Date }
const knownPlaceIDs = new Set(restrooms.map((place) => place.id));
class RatingError extends Error {}
class RatingUnchanged extends Error {}

function requireClient(): FirebaseClient {
  const client = getFirebaseClient();
  if (!client) throw new RatingError(getFirebaseConfigurationError() ?? "Public ratings aren’t connected in this build.");
  return client;
}

function assertAccount(client: FirebaseClient, uid: string, afterRequest = false): void {
  if (!uid || client.auth.currentUser?.uid !== uid) {
    throw new RatingError(afterRequest
      ? "Your account changed while the rating request was running. Refresh after signing in. A completed rating may belong to the previous account."
      : "Sign in to add, change, or remove your cleanliness rating.");
  }
  if (client.auth.currentUser.isAnonymous) throw new RatingError("Use a signed-in account to rate a restroom. Anonymous accounts can still browse public ratings.");
}

function validatePlaceID(placeID: string): void {
  if (!knownPlaceIDs.has(placeID)) throw new RatingError("This restroom isn’t in the current NYC source collection. Its rating wasn’t changed.");
}

function readTimestamp(value: unknown): Date {
  if (!(value instanceof Timestamp) || !Number.isFinite(value.toMillis())) {
    throw new RatingError("Some rating data couldn’t be read. Please refresh or ask the team to check its format.");
  }
  return value.toDate();
}

function decodeTotals(data: DocumentData): { ratingCount: number; ratingSum: number; updatedAt: Date } {
  if (!isValidRatingTotals({ ratingCount: data.ratingCount, ratingSum: data.ratingSum })) {
    throw new RatingError("The public rating totals couldn’t be read safely. Please refresh before trying again.");
  }
  return { ratingCount: data.ratingCount, ratingSum: data.ratingSum, updatedAt: readTimestamp(data.updatedAt) };
}

function decodeVote(data: DocumentData): OwnRating {
  if (!isValidStars(data.stars)) throw new RatingError("Your saved rating couldn’t be read safely. It hasn’t been overwritten.");
  return { stars: data.stars, updatedAt: readTimestamp(data.updatedAt) };
}

function readableError(error: unknown): Error {
  if (error instanceof RatingError) return error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
  if (code === "permission-denied") return new RatingError("The rating request wasn’t authorized. Sign in again, or ask the team to check the rating permissions. No change has been confirmed.");
  if (code === "unavailable" || code === "deadline-exceeded") return new RatingError("Ratings couldn’t connect to Firestore. Check your connection and try again. No new rating has been confirmed.");
  if (code === "unauthenticated") return new RatingError("Your account session needs to be refreshed. Sign in again before changing a rating.");
  return new RatingError("Ratings couldn’t be loaded or saved. Please try again. The location list is still available.");
}

export function watchRatingSummaries(
  onChange: (summaries: Record<string, RatingSummary>) => void,
  onError: (error: Error) => void,
): () => void {
  try {
    const database = getFirestore(requireClient().app);
    const summaries = query(collection(database, "restroomRatingSummaries"), where("ratingCount", ">", 0));
    return onSnapshot(summaries, { includeMetadataChanges: true }, (snapshot) => {
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      try {
        const result: Record<string, RatingSummary> = {};
        for (const document of snapshot.docs) {
          if (!knownPlaceIDs.has(document.id)) continue;
          const totals = decodeTotals(document.data());
          if (totals.ratingCount <= 0) throw new RatingError("A public rating summary is incomplete. Please refresh.");
          result[document.id] = { placeID: document.id, ...totals, average: totals.ratingSum / totals.ratingCount };
        }
        onChange(result);
      } catch (error) { onError(readableError(error)); }
    }, (error) => onError(readableError(error)));
  } catch (error) {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) onError(readableError(error)); });
    return () => { cancelled = true; };
  }
}

export async function readOwnRating(uid: string, placeID: string): Promise<OwnRating | null> {
  validatePlaceID(placeID);
  const client = requireClient();
  assertAccount(client, uid);
  try {
    const snapshot = await getDocFromServer(doc(getFirestore(client.app), "restroomRatingSummaries", placeID, "ratings", uid));
    assertAccount(client, uid, true);
    return snapshot.exists() ? decodeVote(snapshot.data()) : null;
  } catch (error) { assertAccount(client, uid, true); throw readableError(error); }
}

export async function setRating(uid: string, placeID: string, stars: number | null): Promise<void> {
  validatePlaceID(placeID);
  if (stars !== null && !isValidStars(stars)) throw new RatingError("Choose a whole-number cleanliness rating from 1 to 5 stars.");
  const client = requireClient();
  assertAccount(client, uid);
  const database = getFirestore(client.app);
  const summary = doc(database, "restroomRatingSummaries", placeID);
  const ownVote = doc(summary, "ratings", uid);
  for (let attempt = 0; attempt < 3; attempt++) {
    let attemptedWrite = false;
    let previousStars: number | null = null;
    let previousSummaryVersion: Timestamp | null = null;
    try {
      await runTransaction(database, async (transaction) => {
        assertAccount(client, uid, true);
        const previousSummary = await transaction.get(summary);
        assertAccount(client, uid, true);
        const previousVote = await transaction.get(ownVote);
        assertAccount(client, uid, true);
        if (!previousSummary.exists()) throw new RatingError("Ratings for this source listing haven’t been initialized yet. Your rating wasn’t saved.");
        const totals = decodeTotals(previousSummary.data());
        previousSummaryVersion = previousSummary.data().updatedAt as Timestamp;
        previousStars = previousVote.exists() ? decodeVote(previousVote.data()).stars : null;
        if (previousStars === stars) throw new RatingUnchanged();
        const next = applyRatingChange(totals, previousStars, stars);
        attemptedWrite = true;
        transaction.update(summary, {
          ratingCount: increment(next.ratingCount - totals.ratingCount),
          ratingSum: increment(next.ratingSum - totals.ratingSum),
          updatedAt: serverTimestamp(),
        });
        if (stars === null) transaction.delete(ownVote);
        else transaction.set(ownVote, { stars, updatedAt: serverTimestamp() });
        assertAccount(client, uid, true);
      });
      assertAccount(client, uid, true);
      return;
    } catch (error) {
      assertAccount(client, uid, true);
      if (error instanceof RatingUnchanged) return;
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code).replace(/^firestore\//, "") : "";
      if (attempt < 2 && attemptedWrite && code === "permission-denied") {
        // Rules may see a competing edit before the SDK sees its version conflict.
        const [freshSummary, freshVote] = await Promise.all([getDocFromServer(summary), getDocFromServer(ownVote)]);
        assertAccount(client, uid, true);
        if (!freshSummary.exists()) throw readableError(error);
        decodeTotals(freshSummary.data());
        const latestStars = freshVote.exists() ? decodeVote(freshVote.data()).stars : null;
        if (latestStars === stars) return;
        const latestVersion = freshSummary.data().updatedAt as Timestamp;
        if (latestStars !== previousStars || (previousSummaryVersion && !latestVersion.isEqual(previousSummaryVersion))) continue;
      }
      throw readableError(error);
    }
  }
}
