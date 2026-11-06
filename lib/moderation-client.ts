/** Browser-only transport for the moderator API. It never grants access locally. */
export type RequestStatus = "pending" | "approved" | "denied";
export type CommentKind = "public-note" | "unified-visit";
export type Decision = "approve" | "deny";

export const DENIAL_REASONS = {
  duplicate: "Duplicate location",
  insufficient_details: "Not enough information",
  incorrect_location: "Incorrect location",
  restricted_access: "Access restrictions",
  other: "Other",
} as const;
export const REMOVAL_REASONS = {
  personal_information: "Personal information",
  harassment: "Harassment or abusive content",
  spam: "Spam",
  misleading: "Misleading information",
  other: "Other",
} as const;

export interface ModeratorSession {
  user: { email: string; displayName: string | null };
  role: "moderator";
}
export interface ModerationListing {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  locationType: "park" | "library" | "cafe" | "restaurant" | "store" | "other";
  entryRule: "public" | "customers" | "unknown";
  stepFreeAccess: "yes" | "no" | "unknown";
  notes: string;
  observedOn: string | null;
  submittedAt: string;
  passcodeRequired?: "yes" | "no" | "unknown";
}
export interface ModerationRequest {
  id: string;
  status: RequestStatus;
  revision: number;
  submittedAt: string;
  reviewedAt: string | null;
  reason: string | null;
  listing: ModerationListing;
  hasCodeDraft: boolean;
}
export interface ModerationComment {
  id: string;
  placeID: string;
  venueName: string;
  kind: CommentKind;
  text: string;
  authorLabel: string;
  observedAt: string;
  submittedAt: string;
  revision: string;
}
export interface ModerationPage<T> { items: T[]; nextCursor: string | null }
export interface DecisionResult { id: string; status: "approved" | "denied"; revision: number; reviewedAt: string }
export interface RemovalResult { id: string; placeID: string; kind: CommentKind; status: "removed"; mode: "redacted" | "deleted" }
export type SafetyKind = CommentKind | "source-comment" | "research-comment" | "legacy-code" | "v2-code";
export type SafetyDecision = "dismiss" | "remove" | "remove-and-suspend";
export const REPORT_REASONS = { personal_information: "Personal information", harassment: "Harassment or abuse", sexual_content: "Sexual content", spam: "Spam", misleading: "Misleading information", other: "Other" } as const;
export interface ModerationSafetyReport {
  id: string; kind: SafetyKind; placeID: string; recordID: string; reason: keyof typeof REPORT_REASONS;
  status: "pending" | "resolved"; createdAt: string; reviewedAt: string | null;
  decision: SafetyDecision | null; revision: string; text: string | null; available: boolean; canSuspend: boolean;
}
export interface SafetyResolution { reportID: string; status: "resolved"; decision: SafetyDecision; mode: "redacted" | "deleted" | null }
export interface ModerationIdentity { getToken: () => Promise<string>; isCurrent: () => boolean }

const messages: Record<string, string> = {
  authentication_required: "Your session needs to be refreshed. Sign in again to continue.",
  moderator_required: "This account does not have moderator access.",
  cursor_expired: "This queue view has expired. Refresh the list to continue.",
  stale_revision: "This item changed after you opened it. Refresh the list before reviewing it again.",
  action_conflict: "This action could not be matched to the current item. Refresh the list before trying again.",
  moderation_unavailable: "The moderation service could not confirm this request. Try again.",
  not_found: "This item is no longer available. Refresh the list.",
  invalid_request: "The request could not be accepted. Refresh the item and try again.",
  invalid_response: "The dashboard could not read the response safely. Refresh and try again.",
  request_unconfirmed: "The response was not confirmed. Check your connection and retry the same action.",
  account_changed: "Your account changed. Sign in again before continuing.",
  ownership_unavailable: "The comment’s owner could not be verified. No suspension was confirmed. Refresh or dismiss the report.",
  content_not_allowed: "This text failed the public-content filter. Deny the request or request a correction.",
  reporter_required: "Sign in with Apple or Google to send a private report.",
  contribution_suspended: "Public contributions are suspended for this account. Private saved places and account deletion remain available.",
  rate_limited: "Too many reports were sent recently. Try again later.",
};
export class ModerationApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly uncertain: boolean;
  constructor(status: number, code: string) {
    super(messages[code] ?? messages.moderation_unavailable);
    this.name = "ModerationApiError";
    this.status = status;
    this.code = Object.hasOwn(messages, code) ? code : "moderation_unavailable";
    this.uncertain = status === 0 || status >= 500;
  }
}

function invalid(): never { throw new ModerationApiError(502, "invalid_response"); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) invalid();
}
function text(value: unknown, maximum: number, empty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) return invalid();
  return value;
}
function choice<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) return invalid();
  return value as T;
}
function timestamp(value: unknown, dateOnly = false): string {
  const result = text(value, 40);
  if (!(dateOnly ? /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z)?$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/).test(result)
    || !Number.isFinite(Date.parse(result))) return invalid();
  return result;
}
function componentID(value: unknown): string {
  const id = text(value, 160);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return invalid();
  return id;
}
function publicPlaceID(value: unknown): string {
  const id = text(value, 128); if (!/^[A-Za-z0-9][A-Za-z0-9:._~-]*$/.test(id)) return invalid(); return id;
}
function sourceRecordID(value: unknown): string {
  const id = text(value, 160); if (!/^[A-Za-z0-9][A-Za-z0-9:._~-]*$/.test(id)) return invalid(); return id;
}
function requestID(value: unknown): string {
  const id = componentID(value);
  if (!/^community-[A-Za-z0-9]{20}$/.test(id)) return invalid();
  return id;
}
function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return invalid();
  return value;
}

export function decodeModeratorSession(value: unknown): ModeratorSession {
  const data = record(value); keys(data, ["user", "role"]);
  const user = record(data.user); keys(user, ["email", "displayName"]);
  return { role: choice(data.role, ["moderator"]), user: { email: text(user.email, 320), displayName: user.displayName === null ? null : text(user.displayName, 160, true) } };
}
export function decodeModerationRequest(value: unknown): ModerationRequest {
  const data = record(value); keys(data, ["id", "status", "revision", "submittedAt", "reviewedAt", "reason", "listing", "hasCodeDraft"]);
  const listing = record(data.listing);
  keys(listing, ["name", "address", "latitude", "longitude", "locationType", "entryRule", "stepFreeAccess", "notes", "observedOn", "submittedAt"], ["passcodeRequired"]);
  if (typeof listing.latitude !== "number" || !Number.isFinite(listing.latitude) || listing.latitude < 40.49 || listing.latitude > 40.93
    || typeof listing.longitude !== "number" || !Number.isFinite(listing.longitude) || listing.longitude < -74.26 || listing.longitude > -73.68 || typeof data.hasCodeDraft !== "boolean") return invalid();
  const submittedAt = timestamp(data.submittedAt);
  if (timestamp(listing.submittedAt) !== submittedAt) return invalid();
  const status = choice(data.status, ["pending", "approved", "denied"]);
  const reviewedAt = data.reviewedAt === null ? null : timestamp(data.reviewedAt);
  const reason = data.reason === null ? null : text(data.reason, 40, true);
  if (status === "pending" ? reviewedAt !== null || reason !== null : reviewedAt === null) return invalid();
  if (status === "denied" && !Object.hasOwn(DENIAL_REASONS, reason ?? "")) return invalid();
  return {
    id: requestID(data.id), status, revision: revision(data.revision), submittedAt, reviewedAt, reason,
    hasCodeDraft: data.hasCodeDraft,
    listing: {
      name: text(listing.name, 200), address: text(listing.address, 400), latitude: listing.latitude, longitude: listing.longitude,
      locationType: choice(listing.locationType, ["park", "library", "cafe", "restaurant", "store", "other"]),
      entryRule: choice(listing.entryRule, ["public", "customers", "unknown"]), stepFreeAccess: choice(listing.stepFreeAccess, ["yes", "no", "unknown"]),
      notes: text(listing.notes, 2_000, true), observedOn: listing.observedOn === null ? null : timestamp(listing.observedOn, true), submittedAt,
      ...(Object.hasOwn(listing, "passcodeRequired") ? { passcodeRequired: choice(listing.passcodeRequired, ["yes", "no", "unknown"] as const) } : {}),
    },
  };
}
export function decodeModerationComment(value: unknown): ModerationComment {
  const data = record(value); keys(data, ["id", "placeID", "venueName", "kind", "text", "authorLabel", "observedAt", "submittedAt", "revision"]);
  return { id: componentID(data.id), placeID: publicPlaceID(data.placeID), venueName: text(data.venueName, 300), kind: choice(data.kind, ["public-note", "unified-visit"]),
    text: text(data.text, 2_000), authorLabel: text(data.authorLabel, 160), observedAt: timestamp(data.observedAt), submittedAt: timestamp(data.submittedAt), revision: text(data.revision, 160) };
}
export function decodeModerationSafetyReport(value: unknown): ModerationSafetyReport {
  const data = record(value); keys(data, ["id", "kind", "placeID", "recordID", "reason", "status", "createdAt", "reviewedAt", "decision", "revision", "text", "available", "canSuspend"]);
  const id = componentID(data.id); assertActionID(id);
  const kind = choice(data.kind, ["public-note", "unified-visit", "source-comment", "research-comment", "legacy-code", "v2-code"] as const);
  if (typeof data.available !== "boolean" || typeof data.canSuspend !== "boolean" || data.canSuspend && (!data.available || kind === "source-comment" || kind === "research-comment")) return invalid();
  const status = choice(data.status, ["pending", "resolved"] as const), reviewedAt = data.reviewedAt === null ? null : timestamp(data.reviewedAt);
  const decision = data.decision === null ? null : choice(data.decision, ["dismiss", "remove", "remove-and-suspend"] as const);
  if (status === "pending" ? reviewedAt !== null || decision !== null : reviewedAt === null || decision === null) return invalid();
  const rev = text(data.revision, 40); if (!/^\d{1,12}:\d{1,9}$/.test(rev)) return invalid();
  return { id, kind, placeID: publicPlaceID(data.placeID), recordID: sourceRecordID(data.recordID), reason: choice(data.reason, Object.keys(REPORT_REASONS) as (keyof typeof REPORT_REASONS)[]), status,
    createdAt: timestamp(data.createdAt), reviewedAt, decision, revision: rev, text: data.text === null ? null : text(data.text, 2000), available: data.available, canSuspend: data.canSuspend };
}
export function decodeModerationPage<T>(value: unknown, decode: (item: unknown) => T): ModerationPage<T> {
  const data = record(value); keys(data, ["items", "nextCursor"]);
  if (!Array.isArray(data.items) || data.items.length > 25) return invalid();
  return { items: data.items.map(decode), nextCursor: data.nextCursor === null ? null : text(data.nextCursor, 4_096) };
}
export function newModerationActionID(): string { return globalThis.crypto.randomUUID(); }

function assertActionID(value: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ModerationApiError(400, "invalid_request");
}
function safeErrorCode(status: number, value: unknown): string {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const code = data.error;
  if (typeof code === "string" && Object.hasOwn(messages, code)) return code;
  return ({ 400: "invalid_request", 401: "authentication_required", 403: "moderator_required", 404: "not_found", 409: "stale_revision", 410: "cursor_expired" } as Record<number, string>)[status] ?? "moderation_unavailable";
}

export function createModerationClient(identity: ModerationIdentity, transport: typeof fetch = fetch) {
  const sameAccount = () => { if (!identity.isCurrent()) throw new ModerationApiError(0, "account_changed"); };
  async function request<T>(path: string, decode: (value: unknown) => T, signal?: AbortSignal, body?: unknown): Promise<T> {
    sameAccount();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(cancel, 20_000);
    try {
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      const token = await identity.getToken(); sameAccount();
      if (controller.signal.aborted) throw new DOMException("Request cancelled", "AbortError");
      const response = await transport(`/api/moderation/${path}`, {
        method: body === undefined ? "GET" : "POST", signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      sameAccount();
      const raw = await response.text(); sameAccount();
      if (raw.length > 1_000_000) invalid();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { if (!response.ok) throw new ModerationApiError(response.status, safeErrorCode(response.status, null)); return invalid(); }
      if (!response.ok) throw new ModerationApiError(response.status, safeErrorCode(response.status, data));
      return decode(data);
    } catch (error) {
      sameAccount();
      if (signal?.aborted) throw new DOMException("Request cancelled", "AbortError");
      if (error instanceof ModerationApiError) throw error;
      throw new ModerationApiError(0, "request_unconfirmed");
    } finally {
      clearTimeout(timeout); signal?.removeEventListener("abort", cancel);
    }
  }
  const pageQuery = (cursor?: string | null) => {
    const query = new URLSearchParams({ limit: "25" });
    if (cursor) query.set("cursor", text(cursor, 4_096));
    return query;
  };
  return {
    session: (signal?: AbortSignal) => request("session", decodeModeratorSession, signal),
    requests: (status: RequestStatus, cursor?: string | null, signal?: AbortSignal) => {
      const query = pageQuery(cursor); query.set("status", choice(status, ["pending", "approved", "denied"]));
      return request(`requests?${query}`, value => decodeModerationPage(value, decodeModerationRequest), signal);
    },
    comments: (cursor?: string | null, signal?: AbortSignal) => request(`comments?${pageQuery(cursor)}`, value => decodeModerationPage(value, decodeModerationComment), signal),
    reports: (status: "pending" | "resolved", cursor?: string | null, signal?: AbortSignal) => {
      const query = pageQuery(cursor); query.set("status", choice(status, ["pending", "resolved"]));
      return request(`reports?${query}`, value => decodeModerationPage(value, decodeModerationSafetyReport), signal);
    },
    resolveReport: (item: ModerationSafetyReport, decision: SafetyDecision, reason: string, actionId: string, signal?: AbortSignal) => {
      assertActionID(actionId); assertActionID(item.id);
      if (!Object.hasOwn(REPORT_REASONS, reason) || decision !== "dismiss" && !item.available || decision === "remove-and-suspend" && !item.canSuspend) throw new ModerationApiError(400, "invalid_request");
      return request(`reports/${encodeURIComponent(item.id)}/resolve`, value => {
        const data = record(value); keys(data, ["reportID", "status", "decision", "mode"]);
        const result: SafetyResolution = { reportID: componentID(data.reportID), status: choice(data.status, ["resolved"]), decision: choice(data.decision, ["dismiss", "remove", "remove-and-suspend"]), mode: data.mode === null ? null : choice(data.mode, ["redacted", "deleted"] as const) };
        if (result.reportID !== item.id || result.decision !== decision || (decision === "dismiss" ? result.mode !== null : result.mode === null)) return invalid(); return result;
      }, signal, { decision, revision: item.revision, reason, actionId });
    },
    decide: (item: ModerationRequest, decision: Decision, reason: string, actionId: string, signal?: AbortSignal) => {
      assertActionID(actionId);
      if (decision === "approve" ? reason !== "" : !Object.hasOwn(DENIAL_REASONS, reason)) throw new ModerationApiError(400, "invalid_request");
      return request(`requests/${encodeURIComponent(requestID(item.id))}/decision`, value => {
        const data = record(value); keys(data, ["id", "status", "revision", "reviewedAt"]);
        const result: DecisionResult = { id: requestID(data.id), status: choice(data.status, ["approved", "denied"]), revision: revision(data.revision), reviewedAt: timestamp(data.reviewedAt) };
        if (result.id !== item.id || result.status !== (decision === "approve" ? "approved" : "denied") || result.revision <= item.revision) return invalid();
        return result;
      }, signal, { decision, revision: revision(item.revision), reason, actionId });
    },
    removeComment: (item: ModerationComment, reason: string, actionId: string, signal?: AbortSignal) => {
      assertActionID(actionId);
      if (!Object.hasOwn(REMOVAL_REASONS, reason)) throw new ModerationApiError(400, "invalid_request");
      const kind = choice(item.kind, ["public-note", "unified-visit"]);
      return request(`comments/${kind}/${encodeURIComponent(publicPlaceID(item.placeID))}/${encodeURIComponent(componentID(item.id))}/remove`, value => {
        const data = record(value); keys(data, ["id", "placeID", "kind", "status", "mode"]);
        const result: RemovalResult = { id: componentID(data.id), placeID: publicPlaceID(data.placeID), kind: choice(data.kind, ["public-note", "unified-visit"]), status: choice(data.status, ["removed"]), mode: choice(data.mode, ["redacted", "deleted"]) };
        if (result.id !== item.id || result.placeID !== item.placeID || result.kind !== item.kind) return invalid();
        return result;
      }, signal, { revision: text(item.revision, 160), reason, actionId });
    },
  };
}
