import {
  ADDRESS_RESULT_LIMIT, ADDRESS_SEARCH_BOUNDS, decodeGeoSearchSuggestions, normalizeAddressQuery,
  validAddressCoordinates, type AddressCoordinates, type AddressSuggestion,
} from "@/lib/geocoding-model";

export { GEOCODING_ATTRIBUTION } from "@/lib/geocoding-model";
export type { AddressCoordinates, AddressSuggestion } from "@/lib/geocoding-model";
export const GEOCODING_TIMEOUT_MS = 8000;
const PROVIDER = "https://geosearch.planninglabs.nyc";
const MAX_RESPONSE_CHARACTERS = 150_000;
interface LookupOptions { signal?: AbortSignal }
class AddressLookupError extends Error {}

function cancellation(): Error {
  const error = new Error("Address lookup cancelled.");
  error.name = "AbortError";
  return error;
}

async function lookup(url: URL, options: LookupOptions, origin?: AddressCoordinates): Promise<AddressSuggestion[]> {
  if (options.signal?.aborted) throw cancellation();
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, GEOCODING_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), {
      method: "GET", signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new AddressLookupError("Address lookup is unavailable right now. Try again or enter the address and pin manually.");
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_CHARACTERS) throw new AddressLookupError("Address results could not be read. Try again or enter the address manually.");
    const body = await response.text();
    if (body.length > MAX_RESPONSE_CHARACTERS) throw new AddressLookupError("Address results could not be read. Try again or enter the address manually.");
    if (options.signal?.aborted) throw cancellation();
    if (timedOut) throw new AddressLookupError("Address lookup took too long. Try again or enter the address and pin manually.");
    return decodeGeoSearchSuggestions(JSON.parse(body), origin);
  } catch (error) {
    if (options.signal?.aborted) throw cancellation();
    if (timedOut) throw new AddressLookupError("Address lookup took too long. Try again or enter the address and pin manually.");
    if (error instanceof AddressLookupError) throw error;
    throw new AddressLookupError("Address results couldn’t be loaded. Try again or enter the address and pin manually.");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

/** Called by an explicit Search action, never automatically on each keystroke. */
export async function searchAddresses(text: string, options: LookupOptions = {}): Promise<AddressSuggestion[]> {
  const query = normalizeAddressQuery(text);
  const url = new URL("/v2/search", PROVIDER);
  url.searchParams.set("text", query);
  url.searchParams.set("size", String(ADDRESS_RESULT_LIMIT));
  url.searchParams.set("boundary.rect.min_lat", String(ADDRESS_SEARCH_BOUNDS.south));
  url.searchParams.set("boundary.rect.max_lat", String(ADDRESS_SEARCH_BOUNDS.north));
  url.searchParams.set("boundary.rect.min_lon", String(ADDRESS_SEARCH_BOUNDS.west));
  url.searchParams.set("boundary.rect.max_lon", String(ADDRESS_SEARCH_BOUNDS.east));
  return lookup(url, options);
}

/** A location action obtains a shortlist; only a visitor's selection sets the venue. */
export async function nearbyAddresses(coordinates: AddressCoordinates, options: LookupOptions = {}): Promise<AddressSuggestion[]> {
  if (!validAddressCoordinates(coordinates)) throw new AddressLookupError("Choose a location within the NYC map area, or enter the address and pin manually.");
  const url = new URL("/v2/reverse", PROVIDER);
  url.searchParams.set("point.lat", String(coordinates.latitude));
  url.searchParams.set("point.lon", String(coordinates.longitude));
  url.searchParams.set("size", String(ADDRESS_RESULT_LIMIT));
  url.searchParams.set("boundary.circle.radius", "1");
  return lookup(url, options, coordinates);
}
