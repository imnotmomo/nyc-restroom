/** Isolated example state. Nothing in this module reads or writes application data. */
export type DemoFilter = "all" | "public" | "clean" | "accessible" | "saved";
export type DemoVisibility = "private" | "public";
export interface DemoCode { code: string; visibility: DemoVisibility; updatedAt: string; verifiedAt: string | null }
export interface DemoVenue {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  isPublic: boolean;
  isAccessible: boolean;
  sampleRatingSum: number;
  sampleRatingCount: number;
  ownRating: number | null;
  saved: boolean;
  code: DemoCode | null;
  note: string;
  added: boolean;
}
export interface DemoState { venues: DemoVenue[]; nextID: number }
export interface DemoVenueInput {
  name: string; address: string; latitude: number; longitude: number;
  isPublic: boolean; isAccessible: boolean; code?: string; visibility?: DemoVisibility;
}
export const DEMO_ADDRESS_SOURCE = "https://www.target.com/sl/manhattan-herald-square/3277";
export const DEMO_SEED_TIME = "2026-10-01T16:00:00.000Z";

export function createDemoState(): DemoState {
  return { nextID: 1, venues: [{
    id: "demo-target-herald-square", name: "Target Herald Square", address: "112 W 34th St, New York, NY 10120",
    latitude: 40.749814, longitude: -73.989081, isPublic: true, isAccessible: true,
    sampleRatingSum: 9, sampleRatingCount: 2, ownRating: null, saved: false,
    code: { code: "3434", visibility: "public", updatedAt: DEMO_SEED_TIME, verifiedAt: null }, note: "", added: false,
  }] };
}

export function demoRating(venue: DemoVenue): { average: number | null; count: number } {
  const count = venue.sampleRatingCount + (venue.ownRating === null ? 0 : 1);
  return { average: count ? (venue.sampleRatingSum + (venue.ownRating ?? 0)) / count : null, count };
}

export function matchesDemoFilter(venue: DemoVenue, filter: DemoFilter): boolean {
  switch (filter) {
    case "public": return venue.isPublic;
    case "accessible": return venue.isAccessible;
    case "saved": return venue.saved;
    case "clean": return (demoRating(venue).average ?? 0) >= 4;
    default: return true;
  }
}

function updateVenue(state: DemoState, id: string, update: (venue: DemoVenue) => DemoVenue): DemoState {
  if (!state.venues.some((venue) => venue.id === id)) throw new Error("Choose a sample location first.");
  return { ...state, venues: state.venues.map((venue) => venue.id === id ? update(venue) : venue) };
}

export function rateDemoVenue(state: DemoState, id: string, rating: number | null): DemoState {
  if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) throw new Error("Choose 1–5 stars.");
  return updateVenue(state, id, (venue) => ({ ...venue, ownRating: rating }));
}

export function toggleDemoSaved(state: DemoState, id: string): DemoState {
  return updateVenue(state, id, (venue) => ({ ...venue, saved: !venue.saved }));
}

function normalizeCode(value: string): string {
  if (typeof value !== "string" || /[^\x20-\x7e]/.test(value) || !value.trim() || value.trim().length > 40) throw new Error("Use 1–40 standard letters, numbers, or symbols.");
  return value.trim();
}

function actionTime(now: string): string {
  if (!Number.isFinite(Date.parse(now))) throw new Error("The demo action time is unavailable.");
  return new Date(now).toISOString();
}

export function saveDemoCode(state: DemoState, id: string, value: string, visibility: DemoVisibility, now: string): DemoState {
  const code = normalizeCode(value);
  if (visibility !== "private" && visibility !== "public") throw new Error("Choose Only me or Everyone.");
  const time = actionTime(now);
  return updateVenue(state, id, (venue) => {
    const unchanged = venue.code?.code === code;
    return { ...venue, saved: visibility === "private" || venue.saved, code: {
      code, visibility, updatedAt: unchanged ? venue.code!.updatedAt : time, verifiedAt: unchanged ? venue.code!.verifiedAt : null,
    } };
  });
}

export function verifyDemoCode(state: DemoState, id: string, now: string): DemoState {
  const time = actionTime(now);
  return updateVenue(state, id, (venue) => {
    if (!venue.code) throw new Error("Save a sample code before verifying it.");
    return { ...venue, saved: venue.code.visibility === "private" || venue.saved, code: { ...venue.code, verifiedAt: time } };
  });
}

export function deleteDemoCode(state: DemoState, id: string): DemoState {
  return updateVenue(state, id, (venue) => ({ ...venue, code: null }));
}

export function saveDemoNote(state: DemoState, id: string, note: string): DemoState {
  if (note.length > 1000) throw new Error("Keep your demo note to 1,000 characters.");
  return updateVenue(state, id, (venue) => ({ ...venue, note: note.trim() }));
}

export function addDemoVenue(state: DemoState, input: DemoVenueInput, now: string): DemoState {
  const name = input.name.trim(), address = input.address.trim();
  if (!name || name.length > 120 || !address || address.length > 240) throw new Error("Enter a name and address within the field limits.");
  if (![input.latitude, input.longitude].every(Number.isFinite) || input.latitude < 40.49 || input.latitude > 40.93 || input.longitude < -74.26 || input.longitude > -73.68) throw new Error("Choose coordinates within the NYC area.");
  let venue: DemoVenue = {
    id: `demo-added-${state.nextID}`, name, address, latitude: input.latitude, longitude: input.longitude,
    isPublic: input.isPublic, isAccessible: input.isAccessible, sampleRatingSum: 0, sampleRatingCount: 0,
    ownRating: null, saved: false, code: null, note: "", added: true,
  };
  if (input.code?.trim()) {
    const visibility = input.visibility ?? "private";
    if (visibility !== "private" && visibility !== "public") throw new Error("Choose Only me or Everyone.");
    venue = { ...venue, saved: visibility === "private", code: { code: normalizeCode(input.code), visibility, updatedAt: actionTime(now), verifiedAt: null } };
  }
  return { nextID: state.nextID + 1, venues: [...state.venues, venue] };
}
