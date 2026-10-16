import type { Restroom } from "@/lib/restrooms";

export type RestroomFilter = "all" | "public" | "clean" | "accessible" | "saved";

export const FILTER_OPTIONS = [
  { value: "all", label: "ALL" },
  { value: "public", label: "Public" },
  { value: "clean", label: "Clean (4★+)" },
  { value: "accessible", label: "Accessible" },
  { value: "saved", label: "Saved" },
] as const satisfies readonly { value: RestroomFilter; label: string }[];

export const FILTER_HELP: Readonly<Record<RestroomFilter, string>> = {
  all: "The dated NYC source collection and recent visitor-submitted locations. Neither confirms current availability.",
  public: "NYC directory listings and visitor-reported public entry. Entry rules, fees, and current availability may vary; check each source.",
  clean: "Community cleanliness ratings averaging at least 4 out of 5. Unrated locations are excluded; ratings do not confirm current conditions.",
  accessible: "Facilities listed ‘Fully Accessible’ by NYC. Restroom routes and stalls are not confirmed; check access notes.",
  saved: "Places saved to your signed-in account.",
};

export type PublicCleanlinessRating = {
  average: number;
  ratingCount: number;
  sourceUrl: string;
};

export type FilterableRestroom = Pick<Restroom, "id" | "sourceRecordId" | "sourceUrl" | "facilityAccessibility" | "communitySource"> & {
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
    case "clean": {
      const rating = place.cleanlinessRating;
      return rating !== null && rating !== undefined
        && Number.isFinite(rating.average) && rating.average >= 4 && rating.average <= 5
        && Number.isInteger(rating.ratingCount) && rating.ratingCount > 0
        && hasPublicRatingSource(rating.sourceUrl);
    }
    case "accessible":
      return place.facilityAccessibility === "Fully Accessible";
    case "saved":
      return savedIDs.has(place.id);
    default:
      return false;
  }
}
