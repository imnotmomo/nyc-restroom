import {
  collection, getFirestore, limit, onSnapshot, orderBy, query, Timestamp,
} from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase-client";

export const PUBLIC_SOURCE_COMMENT_LIMIT = 10;
export type SourceCommentDateStatus = "explicit-year" | "resolved-relative" | "unknown-year" | "unknown";
export interface SourceComment {
  id: string;
  placeID: string;
  sourceID: string;
  sourceKind: "post" | "comment";
  text: string;
  displayName: "Anonymous user";
  publishedOn: string | null;
  displayedDate: string;
  dateStatus: SourceCommentDateStatus;
  sourceURL: string | null;
  sourceTitle: string;
  capturedAt: Date;
  observedOn: null;
  verified: false;
  limitations: string;
  submittedAt: Date;
}

const keys = ["placeID", "sourceID", "sourceKind", "text", "displayName", "publishedOn", "displayedDate", "dateStatus",
  "sourceURL", "sourceTitle", "capturedAt", "observedOn", "verified", "limitations", "submittedAt"] as const;
const dateStatuses = new Set<string>(["explicit-year", "resolved-relative", "unknown-year", "unknown"]);
const idPattern = /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/;
const invalid = (): never => { throw new Error("An imported source note has invalid details and is hidden."); };

export function isSourceCommentPlaceID(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) || /\p{Script=Han}/u.test(value)) return invalid();
  return value;
}
function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01") return invalid();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid();
  return value;
}
function instant(value: unknown): Date {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return invalid();
  calendarDate(value.slice(0, 10));
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() < Date.UTC(2000, 0, 1)) return invalid();
  return parsed;
}
function safeURL(value: unknown): string | null {
  if (value === null) return null;
  const input = text(value, 4096);
  if (!input.startsWith("https://") || /\s|\\/.test(input)) return invalid();
  let url: URL;
  try { url = new URL(input); } catch { return invalid(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !host.includes(".") || /^[\d.]+$/.test(host) || /[:\[\]]/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    || [...url.searchParams.keys()].some((key) => /(?:token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy)/i.test(key))) return invalid();
  return input;
}

/** Exact public schema only. Source publication, capture and import dates remain independent. */
export function decodeSourceComment(id: string, expectedPlaceID: string, input: unknown): SourceComment {
  if (!/^[a-f0-9]{20}$/.test(id) || !isSourceCommentPlaceID(expectedPlaceID)
    || input === null || typeof input !== "object" || Array.isArray(input)) return invalid();
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))
    || row.placeID !== expectedPlaceID || !isSourceCommentPlaceID(row.sourceID)
    || (row.sourceKind !== "post" && row.sourceKind !== "comment")
    || row.displayName !== "Anonymous user" || row.observedOn !== null || row.verified !== false
    || typeof row.dateStatus !== "string" || !dateStatuses.has(row.dateStatus)
    || !(row.submittedAt instanceof Timestamp)) return invalid();
  const submittedAt = row.submittedAt.toDate(), capturedAt = instant(row.capturedAt);
  if (!Number.isFinite(submittedAt.getTime()) || submittedAt.getTime() < Date.UTC(2000, 0, 1)
    || capturedAt.getTime() > submittedAt.getTime()) return invalid();
  const unknownYear = row.dateStatus === "unknown-year" || row.dateStatus === "unknown";
  if (unknownYear ? row.publishedOn !== null : row.publishedOn === null) return invalid();
  const publishedOn = row.publishedOn === null ? null : calendarDate(row.publishedOn);
  if (publishedOn && publishedOn > (row.capturedAt as string).slice(0, 10)) return invalid();
  return {
    id, placeID: expectedPlaceID, sourceID: row.sourceID, sourceKind: row.sourceKind, text: text(row.text, 1000), displayName: "Anonymous user",
    publishedOn, displayedDate: text(row.displayedDate, 500, true), dateStatus: row.dateStatus as SourceCommentDateStatus,
    sourceURL: safeURL(row.sourceURL), sourceTitle: text(row.sourceTitle, 300), capturedAt,
    observedOn: null, verified: false, limitations: text(row.limitations, 4000), submittedAt,
  };
}

export function formatSourceCommentDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${calendarDate(value)}T00:00:00.000Z`));
}
export function formatSourceCommentInstant(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return invalid();
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric",
    minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).format(value);
}

/** Attribution comes from the validated link, never a source username or title guess. */
export function sourceCommentAttribution(comment: Pick<SourceComment, "sourceURL" | "sourceKind">): string {
  if (!comment.sourceURL) return comment.sourceKind === "comment" ? "Source comment" : "Source publication";
  const host = new URL(safeURL(comment.sourceURL)!).hostname.toLowerCase().replace(/\.$/, "");
  const domain = (name: string) => host === name || host.endsWith(`.${name}`);
  if (domain("xiaohongshu.com") || domain("xhslink.com")) return "From Xiaohongshu";
  if (domain("reddit.com") || domain("redd.it")) return "From Reddit";
  if (domain("facebook.com") || domain("fb.com")) return "From Facebook";
  if (domain("google.com") || host === "maps.app.goo.gl") return "From Google";
  if (domain("nycgovparks.org")) return "From NYC Parks";
  if (host === "data.cityofnewyork.us") return "From NYC Open Data";
  return "From source website";
}

function readableError(): Error {
  return new Error("Source notes could not load. Retry when your connection is ready; the listing is still available.");
}

/** Public, per-place, latest-ten reads. No account, private provenance or writes are required. */
export function watchSourceComments(placeID: string, onChange: (records: SourceComment[]) => void, onError: (error: Error) => void): () => void {
  let active = true;
  try {
    if (!isSourceCommentPlaceID(placeID)) throw readableError();
    const client = getFirebaseClient();
    if (!client) throw readableError();
    const feed = query(collection(getFirestore(client.app), "restroomSourceComments", placeID, "comments"),
      orderBy("submittedAt", "desc"), limit(PUBLIC_SOURCE_COMMENT_LIMIT));
    const unsubscribe = onSnapshot(feed, { includeMetadataChanges: true }, (snapshot) => {
      if (!active || snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) return;
      const records: SourceComment[] = [];
      let hidden = false;
      for (const entry of snapshot.docs) {
        try { records.push(decodeSourceComment(entry.id, placeID, entry.data())); } catch { hidden = true; }
      }
      onChange(records);
      if (hidden) onError(new Error("Some source notes had invalid details and are hidden. Other available notes are shown."));
    }, () => { if (active) onError(readableError()); });
    return () => { active = false; unsubscribe(); };
  } catch {
    queueMicrotask(() => { if (active) onError(readableError()); });
    return () => { active = false; };
  }
}
