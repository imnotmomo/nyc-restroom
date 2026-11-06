export type PublicNoteAnswer = "not-reported" | "yes" | "no";
export type PublicNoteCondition = "not-reported" | "usable" | "needs-attention";

export interface PublicNoteInput {
  observedAt: Date;
  body: string;
  condition: PublicNoteCondition;
  soap: PublicNoteAnswer;
  toiletPaper: PublicNoteAnswer;
  stairs: PublicNoteAnswer;
}

export interface PublicNote extends PublicNoteInput {
  schemaVersion: 1;
  id: string;
  placeID: string;
  submittedAt: Date;
}

export const PUBLIC_NOTE_LIMIT = 10;
export const PUBLIC_NOTE_BODY_LIMIT = 1_000;
const inputKeys = ["observedAt", "body", "condition", "soap", "toiletPaper", "stairs"] as const;
const answers = ["not-reported", "yes", "no"];

export function isPublicNoteID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{20}$/.test(value);
}

export function isPublicNotePlaceID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$/.test(value)
    && (!value.startsWith("community-") || /^community-[A-Za-z0-9]{20}$/.test(value));
}

/** Only this public schema is accepted. Account identity is never a note field. */
export function normalizePublicNoteInput(value: unknown, now = new Date()): PublicNoteInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Check the visit note before publishing.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== inputKeys.length || !inputKeys.every((key) => Object.hasOwn(data, key))) {
    throw new Error("Publish only the listed note and observation fields.");
  }
  if (!(data.observedAt instanceof Date) || !Number.isFinite(data.observedAt.getTime())
    || !Number.isFinite(now.getTime()) || data.observedAt.getTime() < Date.UTC(2000, 0, 1)
    || data.observedAt.getTime() > now.getTime()) {
    throw new Error("Choose the actual time you visited, between January 1, 2000 and now.");
  }
  if (typeof data.body !== "string" || data.body.trim().length > PUBLIC_NOTE_BODY_LIMIT) {
    throw new Error("Keep your note within 1,000 characters.");
  }
  if (!["not-reported", "usable", "needs-attention"].includes(data.condition as string)
    || [data.soap, data.toiletPaper, data.stairs].some((answer) => typeof answer !== "string" || !answers.includes(answer))) {
    throw new Error("Choose the listed answers, or leave details you did not observe as Not reported.");
  }
  const body = data.body.trim();
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(body)) {
    throw new Error("Remove unsupported control characters from your note.");
  }
  if (!/[^\s\p{Z}\u0085]/u.test(body) && [data.condition, data.soap, data.toiletPaper, data.stairs].every((answer) => answer === "not-reported")) {
    throw new Error("Write a note or report at least one detail you actually observed.");
  }
  return {
    observedAt: new Date(data.observedAt.getTime()), body, condition: data.condition as PublicNoteCondition,
    soap: data.soap as PublicNoteAnswer, toiletPaper: data.toiletPaper as PublicNoteAnswer, stairs: data.stairs as PublicNoteAnswer,
  };
}

export function samePublicNoteInput(left: PublicNoteInput, right: PublicNoteInput): boolean {
  return left.observedAt.getTime() === right.observedAt.getTime()
    && inputKeys.filter((key) => key !== "observedAt").every((key) => left[key] === right[key]);
}
