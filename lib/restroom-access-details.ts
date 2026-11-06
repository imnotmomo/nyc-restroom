import { collection, getFirestore, limit, onSnapshot, orderBy, query, Timestamp } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase-client";
import { ACCESS_DETAILS_FEED_LIMIT, decodeRestroomAccessDetails, type RestroomAccessDetails } from "@/lib/restroom-access-details-model";

/** Public, bounded, administrator-written reports; clients never write this collection. */
export function watchRestroomAccessDetails(onChange: (records: RestroomAccessDetails[]) => void, onError: (error: Error) => void): () => void {
  let active = true;
  try {
    const client = getFirebaseClient();
    if (!client) throw new Error("Hours and entrance reports are not connected in this build.");
    const feed = query(collection(getFirestore(client.app), "restroomAccessDetails"), orderBy("updatedAt", "desc"), limit(ACCESS_DETAILS_FEED_LIMIT));
    const unsubscribe = onSnapshot(feed, { includeMetadataChanges: true }, (snapshot) => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      try {
        const records = snapshot.docs.map((document) => decodeRestroomAccessDetails(document.id, document.data(), (value) => value instanceof Timestamp ? value.toDate() : null));
        if (active) onChange(records);
      } catch {
        if (active) onError(new Error("Hours and entrance reports could not be read safely. Retry loading them before using Stair Free."));
      }
    }, () => { if (active) onError(new Error("Hours and entrance reports could not load. Retry loading them before using Stair Free.")); });
    return () => { active = false; unsubscribe(); };
  } catch {
    queueMicrotask(() => { if (active) onError(new Error("Hours and entrance reports could not load. Retry loading them before using Stair Free.")); });
    return () => { active = false; };
  }
}
