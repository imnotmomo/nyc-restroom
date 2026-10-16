import dataset from "@/data/nyc-restrooms/restrooms.json";

export type Coordinates = { latitude: number; longitude: number };

export interface Restroom extends Coordinates {
  id: string;
  name: string;
  locationType: string | null;
  operator: string | null;
  publishedStatus: string | null;
  seasonality: string | null;
  hours: string | null;
  facilityAccessibility: string | null;
  restroomType: string | null;
  changingStations: string | null;
  accessNotes: string | null;
  website: string | null;
  sourceRecordId: string | null;
  sourceRecordIds: string[];
  sourceUrl: string | null;
  address: string | null;
  neighborhood: string | null;
  purchaseRequired: boolean | null;
  restroomFloor: string | null;
  stairsToRestroom: string | null;
  cleanliness: string | null;
  observationDate: string | null;
}

export const restrooms: readonly Restroom[] = dataset.restrooms;
export const datasetSource = dataset.source;
export const COLUMBIA: Coordinates = { latitude: 40.8075, longitude: -73.9626 };

export function isWithinCollection(location: Coordinates): boolean {
  const { south, north, west, east } = datasetSource.bounds;
  return location.latitude >= south && location.latitude <= north
    && location.longitude >= west && location.longitude <= east;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("en-US");
}

export function matchesRestroom(restroom: Restroom, query: string): boolean {
  const search = normalized(query.trim());
  if (!search) return true;
  return [restroom.name, restroom.operator, restroom.locationType, restroom.address, restroom.neighborhood, restroom.accessNotes]
    .some((value) => value !== null && normalized(value).includes(search));
}

export function distanceMeters(from: Coordinates, to: Coordinates): number {
  if (![from.latitude, from.longitude, to.latitude, to.longitude].every(Number.isFinite)
    || Math.abs(from.latitude) > 90 || Math.abs(to.latitude) > 90
    || Math.abs(from.longitude) > 180 || Math.abs(to.longitude) > 180) return Infinity;
  const radians = Math.PI / 180;
  const a = Math.sin((to.latitude - from.latitude) * radians / 2) ** 2
    + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians)
    * Math.sin((to.longitude - from.longitude) * radians / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a)));
}

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "Distance unavailable";
  return meters < 1_000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1_000).toFixed(1)} km`;
}

export function walkingDirections(restroom: Restroom, origin?: Coordinates): string {
  const params = new URLSearchParams({ api: "1", destination: `${restroom.latitude},${restroom.longitude}`, travelmode: "walking" });
  if (origin) params.set("origin", `${origin.latitude},${origin.longitude}`);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function fact(value: string | null | undefined): string {
  return value?.trim() ? value : "Not reported";
}

export const sourceDateLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
  .format(new Date(datasetSource.dataUpdatedAt));
