/** A shared reported status; route details and original source facts remain separate. */
export type AccessibilityStatus = "reported" | "unknown";
export const ACCESSIBILITY_VALUES = { reported: "Reported accessible", unknown: "Not confirmed" } as const;

export function accessibilityStatus(place: { facilityAccessibility?: unknown; communitySource?: unknown }): AccessibilityStatus {
  // A supplied community report is authoritative for this location, including unknowns.
  if (Object.hasOwn(place, "communitySource")) {
    const report = place.communitySource;
    return report !== null && typeof report === "object" && !Array.isArray(report)
      && "stepFreeAccess" in report && report.stepFreeAccess === "yes" ? "reported" : "unknown";
  }
  return place.facilityAccessibility === "Fully Accessible" ? "reported" : "unknown";
}
