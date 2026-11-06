import bundledRegistry from "@/data/research-2026/reports.json";

export const SOURCE_REPORT_CUTOFF = "2026-10-21";

export const SOURCE_FACT_FIELDS = [
  "entryRule", "passcodeRequired", "purchaseRequired", "restroomFloor", "stairsToRestroom",
  "elevatorAccess", "stepFreeAccess", "staffAssistance", "restroomLocation", "buildingAccessibility",
  "restroomAccessibility", "hours", "venueHours", "closure", "genderDesignation", "restroomType", "changingStations",
  "soap", "toiletPaper", "cleanliness",
] as const;

export type SourceFactField = typeof SOURCE_FACT_FIELDS[number];
export type SourceDateKind = "published" | "updated" | "post" | "comment" | "edition";
export type ResearchSourceType = "official" | "guide" | "news" | "discussion";
export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  publishedOn: string;
  dateKind: SourceDateKind;
  sourceType: ResearchSourceType;
  dateEvidence: string;
  limitations: string;
}
export interface SourceFact { field: SourceFactField; value: string }
export interface SourceReport {
  id: string;
  placeID: string;
  sourceID: string;
  venueLabel: string;
  reportedOn: string | null;
  observedOn: null;
  facts: SourceFact[];
  limitations: string;
}
export interface SourceRegistry { cutoff: string; sources: ResearchSource[]; reports: SourceReport[] }
export interface ResolvedSourceReport extends SourceReport { source: ResearchSource }
export type SourceFactGroup = "Entry" | "Route inside" | "Conditions & availability";

const fieldSet = new Set<string>(SOURCE_FACT_FIELDS);
const dateKinds = new Set<string>(["published", "updated", "post", "comment", "edition"]);
const sourceTypes = new Set<string>(["official", "guide", "news", "discussion"]);
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:~-]{0,159}$/;

function invalid(): never { throw new Error("The curated source registry is invalid."); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) invalid();
}
function text(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())
    || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !idPattern.test(value)) return invalid();
  return value;
}
function placeID(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(value)) return invalid();
  return value;
}
function date(value: unknown, cutoff: string): string {
  if (typeof value !== "string" || !/^2026-\d{2}-\d{2}$/.test(value) || value > cutoff) return invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return invalid();
  return value;
}
function safeURL(value: unknown): string {
  const input = text(value, 2_048);
  if (!input.startsWith("https://") || /\s|\\/.test(input)) return invalid();
  let url: URL;
  try { url = new URL(input); } catch { return invalid(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
    || !host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")
    || /^[\d.]+$/.test(host) || host.includes(":")) return invalid();
  return input;
}

/** Validation preserves source wording and conflicts; it never derives route or availability facts. */
export function validateSourceRegistry(input: unknown): SourceRegistry {
  const raw = object(input);
  exact(raw, ["cutoff", "sources", "reports"]);
  if (raw.cutoff !== SOURCE_REPORT_CUTOFF || !Array.isArray(raw.sources) || !Array.isArray(raw.reports)
    || raw.sources.length > 1_000 || raw.reports.length > 10_000) return invalid();
  const sourceIDs = new Set<string>(), reportIDs = new Set<string>();
  const sources = raw.sources.map((item): ResearchSource => {
    const row = object(item);
    exact(row, ["id", "title", "url", "publishedOn", "dateKind", "sourceType", "dateEvidence", "limitations"]);
    const sourceID = id(row.id);
    if (sourceIDs.has(sourceID) || typeof row.dateKind !== "string" || !dateKinds.has(row.dateKind)
      || typeof row.sourceType !== "string" || !sourceTypes.has(row.sourceType)) return invalid();
    sourceIDs.add(sourceID);
    return {
      id: sourceID, title: text(row.title, 300), url: safeURL(row.url),
      publishedOn: date(row.publishedOn, SOURCE_REPORT_CUTOFF), dateKind: row.dateKind as SourceDateKind,
      sourceType: row.sourceType as ResearchSourceType, dateEvidence: text(row.dateEvidence, 2_000),
      limitations: text(row.limitations, 2_000, true),
    };
  });
  const reports = raw.reports.map((item): SourceReport => {
    const row = object(item);
    exact(row, ["id", "placeID", "sourceID", "venueLabel", "reportedOn", "observedOn", "facts", "limitations"]);
    const reportID = id(row.id), sourceID = id(row.sourceID);
    if (reportIDs.has(reportID) || !sourceIDs.has(sourceID) || row.observedOn !== null
      || !Array.isArray(row.facts) || row.facts.length === 0 || row.facts.length > 32) return invalid();
    reportIDs.add(reportID);
    const facts = row.facts.map((item): SourceFact => {
      const entry = object(item);
      exact(entry, ["field", "value"]);
      if (typeof entry.field !== "string" || !fieldSet.has(entry.field)) return invalid();
      return { field: entry.field as SourceFactField, value: text(entry.value, 1_000) };
    });
    return {
      id: reportID, placeID: placeID(row.placeID), sourceID, venueLabel: text(row.venueLabel, 240),
      reportedOn: row.reportedOn === null ? null : date(row.reportedOn, SOURCE_REPORT_CUTOFF),
      observedOn: null, facts, limitations: text(row.limitations, 2_000, true),
    };
  });
  return { cutoff: SOURCE_REPORT_CUTOFF, sources, reports };
}

export const sourceRegistry = validateSourceRegistry(bundledRegistry);

/** Exact IDs only: matching a nearby building or another branch is a separate editorial decision. */
export function sourceReportsForPlace(placeID: string, registry: SourceRegistry = sourceRegistry): ResolvedSourceReport[] {
  const sources = new Map(registry.sources.map((source) => [source.id, source]));
  return registry.reports.filter((report) => report.placeID === placeID).map((report) => {
    const source = sources.get(report.sourceID);
    if (!source) return invalid();
    return { ...report, source };
  });
}

export const SOURCE_FACT_LABELS: Record<SourceFactField, string> = {
  entryRule: "Entry permission", passcodeRequired: "Code required", purchaseRequired: "Purchase required",
  restroomFloor: "Restroom floor", stairsToRestroom: "Stairs to restroom", elevatorAccess: "Elevator — source report",
  stepFreeAccess: "Step-free route", staffAssistance: "Staff assistance", restroomLocation: "Restroom location",
  buildingAccessibility: "Building access — source description", restroomAccessibility: "Restroom features — source description",
  hours: "Restroom hours — source report", venueHours: "Venue hours — restroom hours unconfirmed", closure: "Availability report", genderDesignation: "Restroom designation",
  restroomType: "Restroom type", changingStations: "Changing stations", soap: "Soap", toiletPaper: "Toilet paper",
  cleanliness: "Condition report",
};
const entryFields = new Set<SourceFactField>(["entryRule", "passcodeRequired", "purchaseRequired"]);
const routeFields = new Set<SourceFactField>([
  "restroomFloor", "stairsToRestroom", "elevatorAccess", "stepFreeAccess", "staffAssistance",
  "restroomLocation", "buildingAccessibility", "restroomAccessibility",
]);
export function groupSourceFacts(facts: readonly SourceFact[]): { label: SourceFactGroup; facts: SourceFact[] }[] {
  const groups: { label: SourceFactGroup; facts: SourceFact[] }[] = [
    { label: "Entry", facts: [] }, { label: "Route inside", facts: [] }, { label: "Conditions & availability", facts: [] },
  ];
  for (const fact of facts) groups[entryFields.has(fact.field) ? 0 : routeFields.has(fact.field) ? 1 : 2].facts.push(fact);
  return groups.filter((group) => group.facts.length > 0);
}
export function formatSourceDate(value: string): string {
  date(value, SOURCE_REPORT_CUTOFF);
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}
export const SOURCE_DATE_LABELS: Record<SourceDateKind, string> = {
  published: "Published", updated: "Source updated", post: "Posted", comment: "Comment posted", edition: "Guide edition",
};
