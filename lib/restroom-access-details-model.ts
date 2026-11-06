export type AccessAnswer = "yes" | "no" | "unknown";

/** A separately sourced report; original listing facts and dates stay intact. */
export interface RestroomAccessDetails {
  schemaVersion: 1;
  placeID: string;
  restroomHours: string | null;
  entranceLocation: string | null;
  entranceStepFree: AccessAnswer;
  stairFreeRoute: AccessAnswer;
  elevatorToRestroom: AccessAnswer;
  elevatorNote: string | null;
  restroomFloor: string | null;
  stairsAfterEntry: number | null;
  sourceTitle: string;
  reportedAt: Date;
  observedOn: Date | null;
  updatedAt: Date;
  limitations: string;
}

export const ACCESS_DETAILS_FEED_LIMIT = 1000;
const fields = ["schemaVersion", "placeID", "restroomHours", "entranceLocation", "entranceStepFree", "stairFreeRoute", "elevatorToRestroom", "elevatorNote", "restroomFloor", "stairsAfterEntry", "sourceTitle", "reportedAt", "observedOn", "updatedAt", "limitations"] as const;
const invalidReport = () => new Error("An hours and entrance report could not be read safely. Retry or ask the team to check its format.");

function text(value: unknown, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw invalidReport();
  return value;
}

function answer(value: unknown): AccessAnswer {
  if (value !== "yes" && value !== "no" && value !== "unknown") throw invalidReport();
  return value;
}

/** The SDK supplies a Timestamp-only reader; the model does not coerce strings or numbers into dates. */
export function decodeRestroomAccessDetails(id: string, raw: unknown, readTimestamp: (value: unknown) => Date | null): RestroomAccessDetails {
  if (!/^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(id) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw invalidReport();
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).length !== fields.length || !fields.every((key) => Object.hasOwn(data, key)) || data.schemaVersion !== 1 || data.placeID !== id) throw invalidReport();
  const timestamp = (value: unknown): Date => {
    const date = readTimestamp(value);
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw invalidReport();
    return new Date(date.getTime());
  };
  const reportedAt = timestamp(data.reportedAt);
  const updatedAt = timestamp(data.updatedAt);
  const observedOn = data.observedOn === null ? null : timestamp(data.observedOn);
  if (reportedAt > updatedAt || (observedOn && observedOn > reportedAt)) throw invalidReport();
  const stairs = data.stairsAfterEntry;
  if (stairs !== null && (typeof stairs !== "number" || !Number.isInteger(stairs) || stairs < 0 || stairs > 200)) throw invalidReport();
  const entranceStepFree = answer(data.entranceStepFree);
  const stairFreeRoute = answer(data.stairFreeRoute);
  if (stairFreeRoute === "yes" && (entranceStepFree === "no" || (typeof stairs === "number" && stairs > 0))) throw invalidReport();
  return {
    schemaVersion: 1, placeID: id,
    restroomHours: text(data.restroomHours, 160, true), entranceLocation: text(data.entranceLocation, 500, true),
    entranceStepFree, stairFreeRoute, elevatorToRestroom: answer(data.elevatorToRestroom),
    elevatorNote: text(data.elevatorNote, 300, true), restroomFloor: text(data.restroomFloor, 80, true), stairsAfterEntry: stairs as number | null,
    sourceTitle: text(data.sourceTitle, 160)!, reportedAt, observedOn, updatedAt, limitations: text(data.limitations, 1000)!,
  };
}

type AccessPlace = { id: string; accessDetails?: RestroomAccessDetails; communitySource?: { stepFreeAccess: AccessAnswer } };

/** Unknown and negative sidecar answers own the status; city accessibility never supplies it. */
export function stairFreeRouteStatus(place: AccessPlace): AccessAnswer {
  if (place.accessDetails?.placeID === place.id) {
    const details = place.accessDetails;
    if (details.stairFreeRoute === "yes" && (details.entranceStepFree === "no" || (details.stairsAfterEntry !== null && details.stairsAfterEntry > 0))) return "unknown";
    return details.stairFreeRoute;
  }
  return place.communitySource?.stepFreeAccess ?? "unknown";
}

export function elevatorToRestroomStatus(place: Pick<AccessPlace, "id" | "accessDetails">): AccessAnswer {
  return place.accessDetails?.placeID === place.id ? place.accessDetails.elevatorToRestroom : "unknown";
}

/** Sidecars never create places, match names or overwrite the original source fields. */
export function attachRestroomAccessDetails<T extends { id: string }>(places: readonly T[], records: readonly RestroomAccessDetails[]): (T & { accessDetails?: RestroomAccessDetails })[] {
  const byID = new Map(records.map((record) => [record.placeID, record]));
  return places.map((place) => byID.has(place.id) ? { ...place, accessDetails: byID.get(place.id) } : place);
}

export function accessDetailsDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export function accessDetailsProvenance(details: RestroomAccessDetails): string {
  return `${details.sourceTitle} · Reported ${accessDetailsDate(details.reportedAt)} · ${details.observedOn ? `Observed ${accessDetailsDate(details.observedOn)}` : "Observation date not reported"}`;
}

/** Only reported structured values are added to the compact card. */
export function accessDetailsCardFacts(details: RestroomAccessDetails): { label: string; value: string }[] {
  const facts: { label: string; value: string }[] = [];
  if (details.restroomHours) facts.push({ label: "Restroom hours", value: details.restroomHours });
  if (details.entranceLocation) facts.push({ label: "Entrance", value: details.entranceLocation });
  facts.push({ label: "Stair-free route", value: details.stairFreeRoute === "unknown" ? "Not reported" : details.stairFreeRoute === "yes" ? "Yes — reported" : "No — reported" });
  if (details.restroomFloor) facts.push({ label: "Restroom floor", value: details.restroomFloor });
  if (details.stairsAfterEntry !== null) facts.push({ label: "Stairs after entry", value: String(details.stairsAfterEntry) });
  if (details.elevatorToRestroom !== "unknown") facts.push({ label: "Elevator to restroom", value: details.elevatorToRestroom === "yes" ? "Yes — reported" : "No — reported" });
  if (details.elevatorNote) facts.push({ label: "Elevator route", value: details.elevatorNote });
  return facts;
}
