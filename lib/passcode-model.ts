export const MAX_PASSCODE_LENGTH = 40;
export const PUBLIC_PASSCODE_LIMIT = 10;
export type PasscodeVisibility = "private" | "public";

export interface PasscodeInput { code: string; visibility: PasscodeVisibility }
export interface OwnPasscode extends PasscodeInput {
  placeID: string;
  reportID: string;
  createdAt: Date;
  codeUpdatedAt: Date;
  lastVerifiedAt: Date | null;
  /** Exact Firestore timestamp identity; display dates lose submillisecond precision. */
  codeVersion: string;
}
export interface PublicPasscodeReport {
  placeID: string;
  reportID: string;
  code: string;
  codeUpdatedAt: Date;
  lastVerifiedAt: Date | null;
  codeVersion: string;
}

export function isPasscodeReportID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{20}$/.test(value);
}

export function normalizePasscodeInput(value: unknown): PasscodeInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Check the code and who can see it before saving.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || !Object.hasOwn(data, "code") || !Object.hasOwn(data, "visibility")) {
    throw new Error("Check the code and who can see it before saving.");
  }
  if (typeof data.code !== "string" || /[^\x20-\x7E]/.test(data.code)) {
    throw new Error("Use a code with letters, numbers, spaces, or standard keyboard symbols. Line breaks are not supported.");
  }
  const code = data.code.trim();
  if (!code || code.length > MAX_PASSCODE_LENGTH) throw new Error(`Use a code with 1–${MAX_PASSCODE_LENGTH} characters.`);
  if (data.visibility !== "private" && data.visibility !== "public") throw new Error("Choose Only me or Everyone before saving the code.");
  return { code, visibility: data.visibility };
}

export function passcodeTimestampVersion(value: { seconds: number; nanoseconds: number }): string {
  if (!Number.isSafeInteger(value.seconds) || value.seconds < 946684800
    || !Number.isInteger(value.nanoseconds) || value.nanoseconds < 0 || value.nanoseconds >= 1_000_000_000) {
    throw new Error("The code timestamp could not be read safely.");
  }
  return `${value.seconds}:${value.nanoseconds}`;
}

/** Verification updates do not invalidate a pending edit; code or privacy changes do. */
export function samePasscodeRevision(current: OwnPasscode | null, expected: OwnPasscode | null): boolean {
  if (current === null || expected === null) return current === expected;
  return current.placeID === expected.placeID && current.reportID === expected.reportID
    && current.codeVersion === expected.codeVersion && current.visibility === expected.visibility;
}

export function passcodeVerificationSourceForEdit(
  current: Pick<OwnPasscode, "code" | "visibility"> | null,
  input: PasscodeInput,
): PasscodeVisibility | null {
  if (!current || current.code !== input.code) return null;
  return current.visibility;
}
