/** Visitor-submitted facts are reports, not a city accessibility certification. */
export const COMMUNITY_RESTROOM_BOUNDS = { south: 40.49, north: 40.93, west: -74.26, east: -73.68 } as const;
export const COMMUNITY_LOCATION_TYPES = ["park", "library", "cafe", "restaurant", "store", "other"] as const;
export type CommunityLocationType = typeof COMMUNITY_LOCATION_TYPES[number];
export type CommunityEntryRule = "public" | "customers" | "unknown";
export type CommunityStepFreeAccess = "yes" | "no" | "unknown";

export interface CommunityRestroomInput {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  locationType: CommunityLocationType;
  entryRule: CommunityEntryRule;
  stepFreeAccess: CommunityStepFreeAccess;
  notes: string;
  observedOn: string | null;
}
export type LogRestroomInput = CommunityRestroomInput;
export interface CommunityRestroomRecord extends CommunityRestroomInput { id: string; submittedAt: Date }

const keys = ["name", "address", "latitude", "longitude", "locationType", "entryRule", "stepFreeAccess", "notes", "observedOn"];
export function isCommunityRestroomID(value: unknown): value is string {
  return typeof value === "string" && /^community-[a-zA-Z0-9]{20}$/.test(value);
}

export function communityObservationDateLimit(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function isValidCommunityObservationDate(value: unknown, now = new Date()): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    && value >= "2000-01-01" && value <= communityObservationDateLimit(now);
}

export function normalizeCommunityRestroomInput(value: unknown, now = new Date()): CommunityRestroomInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Check the restroom details before saving.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== keys.length || Object.keys(data).some((key) => !keys.includes(key))) {
    throw new Error("Check the restroom details before saving. Only the listed fields can be submitted.");
  }
  const text = (field: "name" | "address" | "notes", maximum: number, required: boolean): string => {
    const input = data[field];
    if (typeof input !== "string") throw new Error(`Check the ${field === "notes" ? "access notes" : field} before saving.`);
    const normalized = field === "notes" ? input.trim() : input.trim().replace(/\s+/g, " ");
    if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
      throw new Error(`${field === "notes" ? "Access notes" : field === "name" ? "Restroom name" : "Address"} ${required ? `is required and must be ${maximum} characters or fewer` : `must be ${maximum} characters or fewer`}.`);
    }
    return normalized;
  };
  const latitude = data.latitude, longitude = data.longitude;
  if (typeof latitude !== "number" || typeof longitude !== "number" || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < COMMUNITY_RESTROOM_BOUNDS.south || latitude > COMMUNITY_RESTROOM_BOUNDS.north
    || longitude < COMMUNITY_RESTROOM_BOUNDS.west || longitude > COMMUNITY_RESTROOM_BOUNDS.east) {
    throw new Error("Choose a location within the approximate NYC map area shown by this form.");
  }
  if (!COMMUNITY_LOCATION_TYPES.includes(data.locationType as CommunityLocationType)) throw new Error("Choose a location type.");
  if (typeof data.entryRule !== "string" || !["public", "customers", "unknown"].includes(data.entryRule)) throw new Error("Choose an entry rule, or leave it as not reported.");
  if (typeof data.stepFreeAccess !== "string" || !["yes", "no", "unknown"].includes(data.stepFreeAccess)) throw new Error("Choose a step-free route report, or leave it as not reported.");
  if (!isValidCommunityObservationDate(data.observedOn, now)) throw new Error("Use a real observation date from 2000 through today, or leave the date blank.");
  return {
    name: text("name", 120, true), address: text("address", 240, true), latitude, longitude,
    locationType: data.locationType as CommunityLocationType,
    entryRule: data.entryRule as CommunityEntryRule, stepFreeAccess: data.stepFreeAccess as CommunityStepFreeAccess,
    notes: text("notes", 1000, false), observedOn: data.observedOn,
  };
}

export function sameCommunityRestroomInput(left: CommunityRestroomInput, right: CommunityRestroomInput): boolean {
  return keys.every((key) => left[key as keyof CommunityRestroomInput] === right[key as keyof CommunityRestroomInput]);
}

/** Stored dates are checked against server submission time, never the reader's clock. */
export function normalizeRecordedCommunityRestroomInput(value: unknown, submittedAt: Date): CommunityRestroomInput {
  if (!Number.isFinite(submittedAt.getTime()) || submittedAt.getTime() < Date.UTC(2000, 0, 1)) throw new Error("The submission timestamp could not be read.");
  // Adding a day puts the New York calendar cutoff on/after the server UTC day.
  const normalized = normalizeCommunityRestroomInput(value, new Date(submittedAt.getTime() + 86_400_000));
  if (normalized.observedOn !== null && new Date(`${normalized.observedOn}T00:00:00.000Z`).getTime() > submittedAt.getTime()) {
    throw new Error("The observation date is later than this report's submission time.");
  }
  return normalized;
}
