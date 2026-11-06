import type { Restroom } from "@/lib/restrooms";

export interface FinderCardFact { label: string; value: string; unknown: boolean }
export interface CommunityCardSummary { facts: FinderCardFact[]; observation: string; submission: string }

/** Card facts use only public listing fields, never private notes or code reports. */
export function communityCardSummary(place: Pick<Restroom, "communitySource" | "cleanliness" | "accessDetails">): CommunityCardSummary | null {
  const report = place.communitySource;
  if (!report) return null;
  const entry = { public: "Public entry reported", customers: "Customers only reported", unknown: "Not reported" };
  const code = { yes: "Code required · reported", no: "No code required · reported", unknown: "Not reported" };
  const route = { yes: "Step-free reported", no: "Not step-free reported", unknown: "Not reported" };
  const codeRequired = report.passcodeRequired ?? "unknown";
  const submitted = new Date(report.submittedAt);
  return {
    facts: [
      { label: "Entry", value: entry[report.entryRule], unknown: report.entryRule === "unknown" },
      { label: "Code", value: code[codeRequired], unknown: codeRequired === "unknown" },
      ...(!place.accessDetails ? [{ label: "Route", value: route[report.stepFreeAccess], unknown: report.stepFreeAccess === "unknown" }] : []),
      { label: "Conditions", value: place.cleanliness?.trim() || "Not reported", unknown: !place.cleanliness?.trim() },
    ],
    observation: report.observedOn ? `Observed on ${report.observedOn}` : "Observation date not reported",
    submission: Number.isFinite(submitted.getTime())
      ? `Submitted ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(submitted)}`
      : "Submission date not reported",
  };
}

export type FinderPlaceLink = { status: "none" } | { status: "invalid" } | { status: "valid"; placeID: string };

/** Only a bounded public ID is accepted; URL text never becomes a fact or error message. */
export function readFinderPlaceLink(search: string): FinderPlaceLink {
  const parameters = new URLSearchParams(search);
  const ids = parameters.getAll("place");
  if (ids.length === 0) return { status: "none" };
  if (ids.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(ids[0])) return { status: "invalid" };
  return { status: "valid", placeID: ids[0] };
}

export function resolveFinderPlaceLink(placeID: string, publicIDs: ReadonlySet<string>, communityLoading: boolean): "found" | "pending" | "missing" {
  if (publicIDs.has(placeID)) return "found";
  return /^community-[A-Za-z0-9]{20}$/.test(placeID) && communityLoading ? "pending" : "missing";
}
