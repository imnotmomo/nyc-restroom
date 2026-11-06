import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase-client";
import { decodeCardResearch, type CardResearch } from "@/lib/card-research-model";

export interface CardResearchFeed {
  placeID: string;
  profile: CardResearch | null;
  loading: boolean;
  error: string | null;
}

export function emptyCardResearchFeed(placeID: string): CardResearchFeed {
  return { placeID, profile: null, loading: true, error: null };
}

/** A prior place's known data must never appear while a new selected-place read starts. */
export function selectedCardResearchFeed(feed: CardResearchFeed, placeID: string): CardResearchFeed {
  return feed.placeID === placeID && (!feed.profile || feed.profile.placeID === placeID) ? feed : emptyCardResearchFeed(placeID);
}

export function coveredCardResearchCommentIDs(feed: CardResearchFeed, placeID: string): readonly string[] {
  const current = selectedCardResearchFeed(feed, placeID);
  return current.profile && !current.loading && !current.error ? current.profile.coveredCommentIDs : [];
}

/** GET-only public document listener. No collection query, account data or client writes. */
export function watchCardResearch(placeID: string, onChange: (profile: CardResearch | null) => void, onError: (error: Error) => void): () => void {
  let active = true;
  const failed = () => new Error("Additional listing details could not load. Existing details are still shown; retry when your connection is ready.");
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(placeID)) throw failed();
    const client = getFirebaseClient();
    if (!client) throw failed();
    const reference = doc(getFirestore(client.app), "restroomResearchProfiles", placeID);
    const unsubscribe = onSnapshot(reference, { includeMetadataChanges: true }, snapshot => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      try { onChange(snapshot.exists() ? decodeCardResearch(placeID, snapshot.data()) : null); }
      catch { if (active) onError(failed()); }
    }, () => { if (active) onError(failed()); });
    return () => { active = false; unsubscribe(); };
  } catch {
    queueMicrotask(() => { if (active) onError(failed()); });
    return () => { active = false; };
  }
}
