/** Public, source-attributed card facts. No account, rating-vote or code-verification state. */
export type CardResearchSection = "hours" | "amenities" | "conditions" | "passcodes" | "entryRoute" | "ratings";
export type CardResearchScope = "restroom" | "route" | "building" | "venue";
export type CardResearchKind = "official-page" | "official-dataset" | "review" | "social-post" | "social-comment" | "inspection" | "news" | "directory" | "guide";
export interface CardResearchSource {
  id: string; label: string; title: string; url: string; kind: CardResearchKind;
  publishedOn: string | null; displayedDate: string; observedOn: string | null; retrievedAt: string; limitations: string;
}
export interface CardResearchFact {
  id: string; field: string; label: string; value: string; scope: CardResearchScope;
  sourceID: string; section: CardResearchSection; context: string;
}
export interface CardResearchComment { id: string; text: string; sourceID: string }
export interface CardResearch {
  schemaVersion: 1; placeID: string; manifestSHA256: string; generatedAt: string;
  sources: CardResearchSource[]; facts: CardResearchFact[]; comments: CardResearchComment[]; coveredCommentIDs: string[];
}

export const CARD_RESEARCH_FIELD_INFO: Readonly<Record<string, { section: CardResearchSection; label: string }>> = {
  restroomHours: { section: "hours", label: "Restroom hours" }, venueHours: { section: "hours", label: "Venue hours" },
  hours: { section: "hours", label: "Listed hours" }, seasonality: { section: "hours", label: "Seasonality" },
  entranceLocation: { section: "entryRoute", label: "Entrance" }, entranceStepFree: { section: "entryRoute", label: "Step-free entrance" },
  stairFreeRoute: { section: "entryRoute", label: "Stair-free route" }, elevatorToRestroom: { section: "entryRoute", label: "Elevator to restroom" },
  elevatorNote: { section: "entryRoute", label: "Elevator route" }, restroomFloor: { section: "entryRoute", label: "Restroom floor" },
  stairsAfterEntry: { section: "entryRoute", label: "Stairs after entry" }, entryRule: { section: "entryRoute", label: "Entry rule" },
  purchaseRequired: { section: "entryRoute", label: "Purchase requirement" }, restroomLocation: { section: "entryRoute", label: "Restroom location" },
  staffAssistance: { section: "entryRoute", label: "Staff assistance" }, venueLevel: { section: "entryRoute", label: "Venue floor" },
  accessNotes: { section: "entryRoute", label: "Access details" }, elevatorAccess: { section: "entryRoute", label: "Elevator access" },
  accessRestriction: { section: "entryRoute", label: "Access restriction" }, identity: { section: "entryRoute", label: "Source identity" },
  codeRequired: { section: "passcodes", label: "Code requirement" }, passcodeRequired: { section: "passcodes", label: "Code requirement" },
  passcode: { section: "passcodes", label: "Code reported online" },
  condition: { section: "conditions", label: "Reported condition" }, cleanliness: { section: "conditions", label: "Reported cleanliness" },
  closure: { section: "conditions", label: "Closure / access notice" }, publishedStatus: { section: "conditions", label: "Listed status" },
  inspectionDate: { section: "conditions", label: "Inspection date" }, inspectionRating: { section: "conditions", label: "Inspection grade" },
  conditionDetail: { section: "conditions", label: "Inspection findings" }, elevatorOutage: { section: "conditions", label: "Elevator notice" },
  inspectionFeatureRating: { section: "conditions", label: "Inspection feature grade" }, inspectionIssue: { section: "conditions", label: "Inspection issue" },
  soap: { section: "amenities", label: "Soap reported" }, toiletPaper: { section: "amenities", label: "Toilet paper reported" },
  changingStations: { section: "amenities", label: "Changing stations" }, restroomType: { section: "amenities", label: "Restroom type" },
  genderDesignation: { section: "amenities", label: "Restroom designation" }, buildingAccessibility: { section: "amenities", label: "Building accessibility" },
  restroomAccessibility: { section: "amenities", label: "Restroom accessibility" }, facilityAccessibility: { section: "amenities", label: "Accessibility" },
  inspectionFixtureCount: { section: "amenities", label: "Fixtures at inspection" }, sourceRating: { section: "ratings", label: "External source rating" },
};
const kinds = new Set<CardResearchKind>(["official-page", "official-dataset", "review", "social-post", "social-comment", "inspection", "news", "directory", "guide"]);
const scopes = new Set<CardResearchScope>(["restroom", "route", "building", "venue"]);
const id = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{20}$/.test(value);
const fail = (): never => { throw new Error("Research details could not be read safely."); };
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== keys.length
    || !keys.every(key => Object.hasOwn(input, key))) return fail();
  return input as Record<string, unknown>;
}
function text(input: unknown, maximum: number, empty = false): string {
  if (typeof input !== "string" || input.length > maximum || !empty && !input.trim()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(input) || /\p{Script=Han}/u.test(input)) return fail();
  return input;
}
function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < "2000-01-01") return fail();
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return fail();
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(value)) return fail();
  calendarDate(value.slice(0, 10));
  if (!Number.isFinite(Date.parse(value))) return fail();
  return value;
}
function instantOrder(value: string): bigint {
  const [whole, fraction = ""] = value.slice(0, -1).split(".");
  return BigInt(Date.parse(`${whole}Z`)) * 1_000_000n + BigInt(fraction.padEnd(9, "0"));
}
function safeURL(input: unknown): string {
  const value = text(input, 4096);
  if (!value.startsWith("https://") || /\s|\\/.test(value)) return fail();
  let url: URL; try { url = new URL(value); } catch { return fail(); }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443"
    || !host.includes(".") || /^[\d.]+$/.test(host) || /[:\[\]]/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    || [...url.searchParams.keys()].some(key => /(?:token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy)/i.test(key))) return fail();
  return value;
}
function boundedArray(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || input.length > maximum) return fail();
  return input;
}
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) fail(); }

export function decodeCardResearch(placeID: string, input: unknown): CardResearch {
  if (!/^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$/.test(placeID)) return fail();
  const row = exact(input, ["schemaVersion", "placeID", "manifestSHA256", "generatedAt", "sources", "facts", "comments", "coveredCommentIDs"]);
  if (row.schemaVersion !== 1 || row.placeID !== placeID || typeof row.manifestSHA256 !== "string" || !/^[a-f0-9]{64}$/.test(row.manifestSHA256)) return fail();
  const generatedAt = instant(row.generatedAt);
  const sources = boundedArray(row.sources, 16).map(input => {
    const value = exact(input, ["id", "label", "title", "url", "kind", "publishedOn", "displayedDate", "observedOn", "retrievedAt", "limitations"]);
    if (!id(value.id) || !kinds.has(value.kind as CardResearchKind)) return fail();
    const publishedOn = value.publishedOn === null ? null : calendarDate(value.publishedOn);
    const observedOn = value.observedOn === null ? null : calendarDate(value.observedOn);
    const retrievedAt = instant(value.retrievedAt);
    if (instantOrder(retrievedAt) > instantOrder(generatedAt) || publishedOn && publishedOn > retrievedAt.slice(0, 10)
      || observedOn && observedOn > retrievedAt.slice(0, 10) || value.kind === "inspection" && !observedOn
      || ["inspection", "official-dataset"].includes(value.kind as string) && publishedOn !== null) return fail();
    return { id: value.id, label: text(value.label, 80), title: text(value.title, 300), url: safeURL(value.url), kind: value.kind as CardResearchKind,
      publishedOn, displayedDate: text(value.displayedDate, 500, true), observedOn, retrievedAt, limitations: text(value.limitations, 4000) };
  });
  unique(sources.map(source => source.id));
  const sourceIDs = new Set(sources.map(source => source.id));
  const facts = boundedArray(row.facts, 128).map(input => {
    const value = exact(input, ["id", "field", "label", "value", "scope", "sourceID", "section", "context"]);
    if (!id(value.id) || typeof value.field !== "string" || !Object.hasOwn(CARD_RESEARCH_FIELD_INFO, value.field)
      || !scopes.has(value.scope as CardResearchScope) || !id(value.sourceID) || !sourceIDs.has(value.sourceID)
      || value.section !== CARD_RESEARCH_FIELD_INFO[value.field].section
      || value.field === "venueHours" && value.scope !== "venue" || value.field === "buildingAccessibility" && value.scope !== "building"
      || value.field === "sourceRating" && value.scope !== "venue" && value.scope !== "restroom") return fail();
    return { id: value.id, field: value.field, label: text(value.label, 100), value: text(value.value, 3000), scope: value.scope as CardResearchScope,
      sourceID: value.sourceID, section: value.section as CardResearchSection, context: text(value.context, 100, true) };
  });
  unique(facts.map(fact => fact.id));
  const comments = boundedArray(row.comments, 32).map(input => {
    const value = exact(input, ["id", "text", "sourceID"]);
    if (!id(value.id) || !id(value.sourceID) || !sourceIDs.has(value.sourceID)) return fail();
    const source = sources.find(source => source.id === value.sourceID)!;
    if (!["review", "social-post", "social-comment"].includes(source.kind)) return fail();
    return { id: value.id, text: text(value.text, 1500), sourceID: value.sourceID };
  });
  unique(comments.map(comment => comment.id));
  const coveredCommentIDs = boundedArray(row.coveredCommentIDs, 32).map(value => {
    if (!id(value) || !sourceIDs.has(value)) return fail(); return value;
  });
  unique(coveredCommentIDs);
  if (!sources.length || !facts.length && !comments.length || new TextEncoder().encode(JSON.stringify(input)).byteLength > 131_072) return fail();
  return { schemaVersion: 1, placeID, manifestSHA256: row.manifestSHA256, generatedAt, sources, facts, comments, coveredCommentIDs };
}

export function formatCardResearchDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${calendarDate(value)}T00:00:00.000Z`));
}
export function cardResearchCaption(source: CardResearchSource): string {
  if (source.observedOn) return `From ${source.label} · ${source.kind === "inspection" ? "Inspected" : "Observed"} ${formatCardResearchDate(source.observedOn)}`;
  if (source.publishedOn) return `From ${source.label} · ${formatCardResearchDate(source.publishedOn)}`;
  return `From ${source.label} · Date unknown`;
}
export function factsForSection(profile: CardResearch, section: CardResearchSection): CardResearchFact[] {
  return profile.facts.filter(fact => fact.section === section);
}
export function sourceForFact(profile: CardResearch, fact: CardResearchFact): CardResearchSource {
  const source = profile.sources.find(source => source.id === fact.sourceID);
  if (!source) return fail(); return source;
}
