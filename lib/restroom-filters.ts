import type { Restroom } from "@/lib/restrooms";
import { accessibilityStatus } from "@/lib/accessibility";
import { stairFreeRouteStatus } from "@/lib/restroom-access-details-model";

export type RestroomFilter = "all" | "public" | "no-code" | "clean" | "accessible" | "stair-free" | "saved";

export const FILTER_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "public", label: "Public" },
  { value: "no-code", label: "No code" },
  { value: "clean", label: "Clean (4★+)" },
  { value: "accessible", label: "Accessible" },
  { value: "stair-free", label: "Stair Free" },
  { value: "saved", label: "Saved" },
] as const satisfies readonly { value: RestroomFilter; label: string }[];

export const FILTER_HELP: Readonly<Record<RestroomFilter, string>> = {
  all: "The dated NYC source collection and recent visitor-submitted locations. Neither confirms current availability.",
  public: "NYC directory listings and visitor-reported public entry. Entry rules, fees, and current availability may vary; check each source.",
  "no-code": "Locations explicitly reported as not requiring a code in the original community location submission. Later visit reports stay separate. Unknown requirements and missing code reports are excluded. Check entry permission and the observation date; this is not current verification.",
  clean: "Community cleanliness ratings averaging at least 4 out of 5. Unrated locations are excluded; ratings do not confirm current conditions.",
  accessible: "Locations reported as accessible. Check route details and source dates; stall features and current availability are not confirmed.",
  "stair-free": "Locations with an explicit report of a stair-free route from the street to the restroom. An Accessible label or elevator alone does not establish the complete route. Check the report date and entrance details.",
  saved: "Places saved to your signed-in account.",
};

export type PublicCleanlinessRating = {
  average: number;
  ratingCount: number;
  sourceUrl: string;
};

export type FilterableRestroom = Pick<Restroom, "id" | "sourceRecordId" | "sourceUrl" | "facilityAccessibility" | "communitySource" | "accessDetails"> & {
  cleanlinessRating?: PublicCleanlinessRating | null;
};

const publicDirectoryUrl = "https://data.cityofnewyork.us/City-Government/Public-Restrooms/i7jb-7jku";

function hasPublicRatingSource(value: unknown): boolean {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value.trim())) return false;
  try {
    const source = new URL(value.trim());
    return (source.protocol === "https:" || source.protocol === "http:")
      && source.hostname.length > 0 && !source.username && !source.password;
  } catch {
    return false;
  }
}

export function matchesRestroomFilter(place: FilterableRestroom, filter: RestroomFilter, savedIDs: ReadonlySet<string>): boolean {
  switch (filter) {
    case "all":
      return true;
    case "public":
      return (place.sourceUrl === publicDirectoryUrl
        && typeof place.sourceRecordId === "string" && place.sourceRecordId.trim().length > 0)
        || place.communitySource?.entryRule === "public";
    case "no-code":
      return place.communitySource?.passcodeRequired === "no";
    case "clean": {
      const rating = place.cleanlinessRating;
      return rating !== null && rating !== undefined
        && Number.isFinite(rating.average) && rating.average >= 4 && rating.average <= 5
        && Number.isInteger(rating.ratingCount) && rating.ratingCount > 0
        && hasPublicRatingSource(rating.sourceUrl);
    }
    case "accessible":
      return accessibilityStatus(place) === "reported";
    case "stair-free":
      return stairFreeRouteStatus(place) === "yes";
    case "saved":
      return savedIDs.has(place.id);
    default:
      return false;
  }
}
