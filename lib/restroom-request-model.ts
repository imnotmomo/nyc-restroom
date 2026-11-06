import { normalizePasscodeInput, type PasscodeInput } from "@/lib/passcode-model";

export type RestroomRequestStatus = "pending" | "approved" | "denied";
export const RESTROOM_REQUEST_DENIAL_REASONS = ["duplicate", "insufficient_details", "incorrect_location", "restricted_access", "other"] as const;
export type RestroomRequestDenialReason = typeof RESTROOM_REQUEST_DENIAL_REASONS[number];

/** Safe confirmation metadata. Raw draft codes and their private commitments stay out of UI results. */
export interface RestroomRequestConfirmation {
  id: string;
  status: RestroomRequestStatus;
  revision: 1 | 2;
  submittedAt: Date;
  reviewedAt: Date | null;
  reason: RestroomRequestDenialReason | "";
}

const pendingKeys = ["schemaVersion", "status", "revision", "submittedAt", "listing", "codeDraft"];
const terminalKeys = [...pendingKeys, "reviewedAt", "reason", "codeFingerprint"];
interface RequestEnvelope {
  status: RestroomRequestStatus;
  revision: 1 | 2;
  submittedAt: unknown;
  listing: Record<string, unknown>;
  codeDraft: PasscodeInput | null;
  reviewedAt: unknown;
  reason: RestroomRequestDenialReason | "";
  codeFingerprint: string | null;
}

/** Validate metadata separately from the SDK's exact Timestamp and immutable-listing checks. */
export function normalizeRestroomRequestEnvelope(value: unknown): RequestEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request metadata");
  const data = value as Record<string, unknown>;
  const pending = data.status === "pending";
  const keys = pending ? pendingKeys : terminalKeys;
  if (Object.keys(data).length !== keys.length || !keys.every((key) => Object.hasOwn(data, key))
    || data.schemaVersion !== 1 || data.revision !== (pending ? 1 : 2)
    || typeof data.status !== "string" || !["pending", "approved", "denied"].includes(data.status)
    || !data.listing || typeof data.listing !== "object" || Array.isArray(data.listing)) throw new Error("Invalid request metadata");
  let codeDraft: PasscodeInput | null = null;
  if (pending && data.codeDraft !== null) {
    codeDraft = normalizePasscodeInput(data.codeDraft);
    if (codeDraft.code !== (data.codeDraft as Record<string, unknown>).code) throw new Error("Invalid request code");
  }
  if (!pending && (data.codeDraft !== null
    || (data.codeFingerprint !== null && (typeof data.codeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(data.codeFingerprint)))
    || (data.status === "approved" ? data.reason !== "" : !RESTROOM_REQUEST_DENIAL_REASONS.includes(data.reason as RestroomRequestDenialReason)))) {
    throw new Error("Invalid reviewed request metadata");
  }
  return {
    status: data.status as RestroomRequestStatus, revision: pending ? 1 : 2,
    submittedAt: data.submittedAt, listing: data.listing as Record<string, unknown>, codeDraft,
    reviewedAt: pending ? null : data.reviewedAt,
    reason: pending ? "" : data.reason as RestroomRequestDenialReason | "",
    codeFingerprint: pending ? null : data.codeFingerprint as string | null,
  };
}

/** Owner-private retry commitment, matching the native and server contract byte for byte. */
export async function restroomRequestCodeFingerprint(input: PasscodeInput | null): Promise<string | null> {
  if (input === null) return null;
  const code = normalizePasscodeInput(input);
  const bytes = new TextEncoder().encode(`rr-request-code-v1\u0000${code.visibility}\u0000${code.code}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function restroomRequestStatusMessage(request: RestroomRequestConfirmation): string {
  if (request.status === "pending") return "Submitted for review. This restroom will appear on the map after approval.";
  if (request.status === "approved") return "Your request was approved. The listing will appear when the map refreshes.";
  const reason = ({ duplicate: "a duplicate location", insufficient_details: "missing details", incorrect_location: "an incorrect location", restricted_access: "restricted access", other: "the submitted details" })[request.reason as RestroomRequestDenialReason];
  return `Your request was not approved after review of ${reason ?? "the submitted details"}. Nothing new was published from this request.`;
}
