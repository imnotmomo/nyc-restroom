/** Legacy structured observations exclude identity and text; unified reports have a separate strict read schema. */
export type ReportAnswer = "not-reported" | "yes" | "no";
export type ReportEntryRule = "not-reported" | "public" | "customers";
export type ReportFloor = "not-reported" | "entrance" | "below" | "above";
export type ReportCondition = "not-reported" | "usable" | "needs-attention";

export interface VisitReportInput {
  observedAt: Date;
  entryRule: ReportEntryRule;
  purchaseRequired: ReportAnswer;
  codeRequired: ReportAnswer;
  stairs: ReportAnswer;
  soap: ReportAnswer;
  toiletPaper: ReportAnswer;
  floor: ReportFloor;
  condition: ReportCondition;
}

export interface VisitReport extends VisitReportInput {
  id: string;
  placeID: string;
  submittedAt: Date | null;
}

export interface UnifiedVisitReport extends VisitReport {
  schemaVersion: 1;
  submittedAt: Date;
  comment: string;
  anonymous: boolean;
  authorName: string | null;
  elevatorPresent?: ReportAnswer;
  automaticDoorPresent?: ReportAnswer;
}
export interface VisitReportEvidence {
  source: "legacy" | "unified";
  key: string;
  report: VisitReport;
  comment: string;
  authorName: string | null;
}

export const PUBLIC_VISIT_REPORT_LIMIT = 10;
const inputKeys = ["observedAt", "entryRule", "purchaseRequired", "codeRequired", "stairs", "soap", "toiletPaper", "floor", "condition"] as const;
const answerKeys = ["purchaseRequired", "codeRequired", "stairs", "soap", "toiletPaper"] as const;

export function isVisitReportID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9]{20}$/.test(value);
}

export function isVisitReportPlaceID(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$/.test(value)
    && (!value.startsWith("community-") || /^community-[A-Za-z0-9]{20}$/.test(value));
}

export function normalizeVisitReportInput(value: unknown, now = new Date()): VisitReportInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Check the visit observation before sharing.");
  const data = value as Record<string, unknown>;
  if (Object.keys(data).length !== inputKeys.length || !inputKeys.every((key) => Object.hasOwn(data, key))) {
    throw new Error("Share only the listed observation fields. Names, notes and code values do not belong in a public report.");
  }
  if (!(data.observedAt instanceof Date) || !Number.isFinite(data.observedAt.getTime())
    || !Number.isFinite(now.getTime()) || data.observedAt.getTime() < Date.UTC(2000, 0, 1) || data.observedAt.getTime() > now.getTime()) {
    throw new Error("Choose the actual time you visited, between January 1, 2000 and now.");
  }
  if (!["not-reported", "public", "customers"].includes(data.entryRule as string)
    || !["not-reported", "entrance", "below", "above"].includes(data.floor as string)
    || !["not-reported", "usable", "needs-attention"].includes(data.condition as string)
    || answerKeys.some((key) => !["not-reported", "yes", "no"].includes(data[key] as string))) {
    throw new Error("Choose the listed answers, or leave details you did not observe as Not reported.");
  }
  if (inputKeys.filter((key) => key !== "observedAt").every((key) => data[key] === "not-reported")) {
    throw new Error("Report at least one detail you actually observed. Leave everything else as Not reported.");
  }
  return {
    observedAt: new Date(data.observedAt.getTime()), entryRule: data.entryRule as ReportEntryRule,
    purchaseRequired: data.purchaseRequired as ReportAnswer, codeRequired: data.codeRequired as ReportAnswer,
    stairs: data.stairs as ReportAnswer, soap: data.soap as ReportAnswer, toiletPaper: data.toiletPaper as ReportAnswer,
    floor: data.floor as ReportFloor, condition: data.condition as ReportCondition,
  };
}

export function sameVisitReportInput(left: VisitReportInput, right: VisitReportInput): boolean {
  return left.observedAt.getTime() === right.observedAt.getTime()
    && inputKeys.filter((key) => key !== "observedAt").every((key) => left[key] === right[key]);
}

/** Read-only contract. This never relaxes the legacy form's eleven-field wire writes. */
export function normalizeUnifiedVisitReport(id: string, expectedPlaceID: string, value: unknown, now = new Date()): UnifiedVisitReport {
  const invalid = () => new Error("A unified visit report has invalid details and is hidden. Other valid reports can still be shown.");
  if (!isVisitReportID(id) || !isVisitReportPlaceID(expectedPlaceID)
    || value === null || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  const keys = ["schemaVersion", "placeID", "observedAt", "submittedAt", "entryRule", "purchaseRequired", "codeRequired", "stairs", "soap", "toiletPaper", "floor", "condition", "comment", "anonymous", "authorName"];
  const amenityKeys = ["elevatorPresent", "automaticDoorPresent"] as const;
  if (!keys.every(key => Object.hasOwn(data, key)) || Object.keys(data).some(key => !keys.includes(key) && !amenityKeys.includes(key as typeof amenityKeys[number]))
    || data.schemaVersion !== 1 || data.placeID !== expectedPlaceID || typeof data.anonymous !== "boolean") throw invalid();
  if (!(data.observedAt instanceof Date) || !(data.submittedAt instanceof Date)
    || !Number.isFinite(data.observedAt.getTime()) || !Number.isFinite(data.submittedAt.getTime()) || !Number.isFinite(now.getTime())
    || data.observedAt.getTime() < Date.UTC(2000, 0, 1) || data.observedAt.getTime() > data.submittedAt.getTime()
    || data.submittedAt.getTime() > now.getTime()) throw invalid();
  if (!["not-reported", "public", "customers"].includes(data.entryRule as string)
    || !["not-reported", "entrance", "below", "above"].includes(data.floor as string)
    || !["not-reported", "usable", "needs-attention"].includes(data.condition as string)
    || answerKeys.some(key => !["not-reported", "yes", "no"].includes(data[key] as string))
    || amenityKeys.some(key => Object.hasOwn(data, key) && !["not-reported", "yes", "no"].includes(data[key] as string))) throw invalid();
  if (typeof data.comment !== "string" || data.comment !== data.comment.trim() || data.comment.length > 1_000
    || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(data.comment)) throw invalid();
  if (data.anonymous ? data.authorName !== null : typeof data.authorName !== "string"
    || data.authorName.length > 120
    || !/[^\s\p{Z}\u0085]/u.test(data.authorName) || /[\x00-\x1F\x7F]/.test(data.authorName)) throw invalid();
  if (!/[^\s\p{Z}\u0085]/u.test(data.comment) && inputKeys.filter(key => key !== "observedAt").every(key => data[key] === "not-reported")
    && amenityKeys.every(key => !Object.hasOwn(data, key) || data[key] === "not-reported")) throw invalid();
  return {
    id, schemaVersion: 1, placeID: expectedPlaceID, observedAt: new Date(data.observedAt.getTime()), submittedAt: new Date(data.submittedAt.getTime()),
    entryRule: data.entryRule as ReportEntryRule, purchaseRequired: data.purchaseRequired as ReportAnswer, codeRequired: data.codeRequired as ReportAnswer,
    stairs: data.stairs as ReportAnswer, soap: data.soap as ReportAnswer, toiletPaper: data.toiletPaper as ReportAnswer,
    floor: data.floor as ReportFloor, condition: data.condition as ReportCondition,
    comment: data.comment, anonymous: data.anonymous, authorName: data.authorName as string | null,
    ...(Object.hasOwn(data, "elevatorPresent") ? { elevatorPresent: data.elevatorPresent as ReportAnswer } : {}),
    ...(Object.hasOwn(data, "automaticDoorPresent") ? { automaticDoorPresent: data.automaticDoorPresent as ReportAnswer } : {}),
  };
}

/** A raw ID reused by another source never inherits legacy ownership or replaces its observation. */
export function mergeVisitReportEvidence(placeID: string, legacy: readonly VisitReport[], unified: readonly UnifiedVisitReport[]): VisitReportEvidence[] {
  const compare = (left: VisitReport, right: VisitReport) => right.observedAt.getTime() - left.observedAt.getTime()
    || (right.submittedAt?.getTime() ?? 0) - (left.submittedAt?.getTime() ?? 0) || left.id.localeCompare(right.id);
  const bounded = <T extends VisitReport>(rows: readonly T[]) => [...new Map(rows.filter(row => row.placeID === placeID).map(row => [row.id, row])).values()].sort(compare).slice(0, PUBLIC_VISIT_REPORT_LIMIT);
  const rows: VisitReportEvidence[] = [
    ...bounded(legacy).map(report => ({ source: "legacy" as const, key: `legacy:${report.id}`, report, comment: "", authorName: null })),
    ...bounded(unified).map(report => ({ source: "unified" as const, key: `unified:${report.id}`, report, comment: report.comment, authorName: report.anonymous ? null : report.authorName })),
  ];
  return rows.sort((left, right) => compare(left.report, right.report) || left.key.localeCompare(right.key));
}
