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
  all: "All listings in the dated NYC source collection.",
  public: "Listed in NYC’s public-restroom directory. Entry rules, fees, and current availability may vary.",
  clean: "Requires an attributed public cleanliness rating of at least 4 out of 5. The NYC source does not provide cleanliness ratings.",
  accessible: "Facilities listed ‘Fully Accessible’ by NYC. Restroom routes and stalls are not confirmed; check access notes.",
  saved: "Places saved to your signed-in account.",
};

export type PublicCleanlinessRating = {
  average: number;
  ratingCount: number;
  sourceUrl: string;
};

export type FilterableRestroom = Pick<Restroom, "id" | "sourceRecordId" | "sourceUrl" | "facilityAccessibility"> & {
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
      return place.sourceUrl === publicDirectoryUrl
        && typeof place.sourceRecordId === "string" && place.sourceRecordId.trim().length > 0;
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
