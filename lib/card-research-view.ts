import type { CardResearch, CardResearchFact, CardResearchSource } from "@/lib/card-research-model";

/** Preserve published schedules and restrictions without interpreting opening times. */
export function knownCardHours(value: string | null | undefined): string | null {
  const hours = value?.trim();
  return !hours || /^(?:unknown|hours unknown|not[ -]reported|not available|n\/a)$/i.test(hours) ? null : hours;
}

/** Known conflicts remain visible. Venue/building facts cannot erase a restroom-specific unknown. */
export function showOriginalCardFact(profile: CardResearch | null, fields: readonly string[], value: string | null | undefined,
  unknown: boolean, scopes: readonly string[] = ["restroom", "route", "building", "venue"]): boolean {
  const matches = profile?.facts.filter(fact => fields.includes(fact.field) && scopes.includes(fact.scope)) ?? [];
  if (!matches.length) return true;
  if (unknown) return false;
  return !matches.some(fact => fact.value.trim() === value?.trim());
}

export function cardResearchFactLabel(fact: CardResearchFact): string {
  if (fact.field === "venueHours") return "Venue hours";
  if (fact.field === "facilityAccessibility") return "Building accessibility — directory";
  if (fact.field === "sourceRating") return fact.scope === "venue" ? "Venue rating — source" : "Restroom rating — source";
  return fact.label;
}

/** Only plain source text is displayed; it never becomes a code report, rating vote or filter input. */
export function cardResearchFactValue(fact: CardResearchFact, source?: CardResearchSource): string {
  if (fact.field === "closure" && source?.kind === "inspection") {
    if (fact.value === "No") return "Not marked closed at inspection";
    if (fact.value === "Yes") return "Marked closed at inspection";
  }
  if (["entranceStepFree", "stairFreeRoute", "elevatorToRestroom", "codeRequired", "passcodeRequired", "purchaseRequired", "soap", "toiletPaper"].includes(fact.field)) {
    if (fact.value === "yes") return "Yes — reported";
    if (fact.value === "no") return "No — reported";
    if (fact.value === "unknown") return "Not reported";
  }
  return fact.value;
}

/** Keep the dated condition summary visible; full fixture/feature/issue rows stay in their own section. */
export function partitionCardResearchFacts(facts: readonly CardResearchFact[]): { primary: CardResearchFact[]; details: CardResearchFact[] } {
  const detailFields = new Set(["inspectionFixtureCount", "inspectionFeatureRating", "inspectionIssue"]);
  return { primary: facts.filter(fact => !detailFields.has(fact.field)), details: facts.filter(fact => detailFields.has(fact.field)) };
}
