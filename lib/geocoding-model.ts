export const ADDRESS_RESULT_LIMIT = 6;
export const MAX_ADDRESS_QUERY_LENGTH = 240;
export const NEARBY_ADDRESS_RADIUS_METERS = 1000;
/** Matches the approximate public-submission rectangle; it is not a city boundary. */
export const ADDRESS_SEARCH_BOUNDS = { south: 40.49, north: 40.93, west: -74.26, east: -73.68 } as const;
export const GEOCODING_ATTRIBUTION = { label: "NYC Planning GeoSearch", url: "https://geosearch.planninglabs.nyc/" } as const;

export interface AddressCoordinates { latitude: number; longitude: number }
export interface AddressSuggestion extends AddressCoordinates {
  id: string;
  label: string;
  source: "NYC GeoSearch";
  distanceMeters?: number;
}

export function validAddressCoordinates(value: unknown): value is AddressCoordinates {
  if (value === null || typeof value !== "object") return false;
  const coordinates = value as Record<string, unknown>;
  return typeof coordinates.latitude === "number" && Number.isFinite(coordinates.latitude)
    && typeof coordinates.longitude === "number" && Number.isFinite(coordinates.longitude)
    && coordinates.latitude >= ADDRESS_SEARCH_BOUNDS.south && coordinates.latitude <= ADDRESS_SEARCH_BOUNDS.north
    && coordinates.longitude >= ADDRESS_SEARCH_BOUNDS.west && coordinates.longitude <= ADDRESS_SEARCH_BOUNDS.east;
}

export function normalizeAddressQuery(value: unknown): string {
  if (typeof value !== "string" || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
    throw new Error("Enter an NYC street address or place to search.");
  }
  const query = value.trim().replace(/\s+/g, " ");
  if (query.length < 3 || query.length > MAX_ADDRESS_QUERY_LENGTH) throw new Error("Enter an NYC address or place with 3–240 characters, or enter the address manually below.");
  return query;
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function distanceMeters(from: AddressCoordinates, to: AddressCoordinates): number {
  const radians = Math.PI / 180;
  const a = Math.sin((to.latitude - from.latitude) * radians / 2) ** 2
    + Math.cos(from.latitude * radians) * Math.cos(to.latitude * radians)
    * Math.sin((to.longitude - from.longitude) * radians / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, a))), Math.sqrt(Math.max(0, 1 - a))));
}

function fallbackID(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  return `geosearch-${(hash >>> 0).toString(16)}`;
}

/** Provider results are address suggestions, never evidence that a restroom exists. */
export function decodeGeoSearchSuggestions(value: unknown, origin?: AddressCoordinates): AddressSuggestion[] {
  const response = object(value);
  if (!response || response.type !== "FeatureCollection" || !Array.isArray(response.features)) {
    throw new Error("Address results could not be read. Try searching again or enter the address manually.");
  }
  if (origin !== undefined && !validAddressCoordinates(origin)) throw new Error("Choose a location within the NYC map area before looking nearby.");
  const suggestions: AddressSuggestion[] = [];
  const identities = new Set<string>(), locations = new Set<string>();
  // A provider response cannot make rendering or deduplication unbounded.
  for (const item of response.features.slice(0, 100)) {
    const feature = object(item), geometry = object(feature?.geometry), properties = object(feature?.properties);
    if (feature?.type !== "Feature" || geometry?.type !== "Point" || !Array.isArray(geometry.coordinates)
      || geometry.coordinates.length < 2 || !properties || typeof properties.label !== "string") continue;
    const coordinates = { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
    if (!validAddressCoordinates(coordinates)) continue;
    const distance = origin ? distanceMeters(origin, coordinates) : undefined;
    if (distance !== undefined && distance > NEARBY_ADDRESS_RADIUS_METERS) continue;
    const label = properties.label.trim().replace(/\s+/g, " ");
    if (!label || label.length > MAX_ADDRESS_QUERY_LENGTH || /[\u0000-\u001F\u007F]/.test(label)) continue;
    const locationKey = `${coordinates.latitude}|${coordinates.longitude}|${label.toLocaleLowerCase("en-US")}`;
    const id = typeof properties.gid === "string" && properties.gid.length > 0 && properties.gid.length <= 256
      && !/[\u0000-\u001F\u007F]/.test(properties.gid) ? properties.gid : fallbackID(locationKey);
    if (identities.has(id) || locations.has(locationKey)) continue;
    identities.add(id); locations.add(locationKey);
    suggestions.push({ id, label, ...coordinates, source: "NYC GeoSearch", ...(distance !== undefined ? { distanceMeters: distance } : {}) });
    if (suggestions.length === ADDRESS_RESULT_LIMIT) break;
  }
  return suggestions;
}
