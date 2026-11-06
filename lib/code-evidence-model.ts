export type CodeKind = "legacy" | "v2";
export type CodeVote = "used" | "invalid";
export type CodeVisibility = "private" | "public";
export type CodeOwnership = "own" | "other" | "unknown";
export interface CodeEvidence {
  kind: CodeKind; id: string; placeID: string; reportID: string; code: string;
  codeVersion: string; codeUpdatedAt: Date; verifiedAt: Date | null; verifiedVersion: string | null;
  visibility: CodeVisibility; ownership: CodeOwnership;
  usedCount: number | null; invalidCount: number | null; currentVote: CodeVote | null; feedbackLoaded: boolean;
  createdAt: Date | null; createdVersion: string | null;
}
export interface CodeEvidenceState {
  records: CodeEvidence[]; publicLoading: boolean; ownLoading: boolean; feedbackLoading: boolean;
  publicError: string | null; ownError: string | null; feedbackError: string | null;
}

/** Keep nanoseconds for version identity and sorting; Date rounds to milliseconds. */
export function codeVersionParts(value: string): [number, number] {
  if (typeof value !== "string" || !/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value)) throw new Error("The code version is invalid.");
  const [seconds, nanos] = value.split(":").map(Number);
  if (!Number.isSafeInteger(seconds) || seconds < 946684800 || seconds > 253402300799
    || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) throw new Error("The code version is invalid.");
  return [seconds, nanos];
}
export function compareCodeVersions(left: string, right: string): number {
  const a = codeVersionParts(left), b = codeVersionParts(right);
  return a[0] === b[0] ? Math.sign(a[1] - b[1]) : Math.sign(a[0] - b[0]);
}
function reportOrder(left: CodeEvidence, right: CodeEvidence): number {
  return -compareCodeVersions(left.codeVersion, right.codeVersion) || (left.id < right.id ? 1 : left.id > right.id ? -1 : 0);
}
function verificationKey(row:CodeEvidence):string|null {
  if(!(row.verifiedAt instanceof Date)||!Number.isFinite(row.verifiedAt.getTime())||!row.verifiedVersion)return null;
  try{codeVersionParts(row.verifiedVersion);return row.verifiedVersion;}catch{return null;}
}
export function sortedCodeEvidence(records: readonly CodeEvidence[]): CodeEvidence[] {
  return [...records].sort((left, right) => {
    const a=verificationKey(left),b=verificationKey(right);
    if (a && b) return -compareCodeVersions(a,b) || reportOrder(left, right);
    if (a || b) return a ? -1 : 1;
    return reportOrder(left, right);
  });
}
export function preferredPublicCode(records: readonly CodeEvidence[]): CodeEvidence | null {
  return sortedCodeEvidence(records.filter(row => row.visibility === "public"))[0] ?? null;
}
/** A presentation gate only: never delete history or convert a date into voter counts. */
export function visiblePublicCodeEvidence(records: readonly CodeEvidence[], feedsReady = true): CodeEvidence[] {
  const rows = sortedCodeEvidence(records.filter(row => row.visibility === "public"));
  const newest = [...rows].sort(reportOrder)[0], preferred = rows[0];
  if (!feedsReady || !newest || (newest.usedCount ?? 0) < 4) return rows;
  return rows.filter(row => row.id === newest.id || row.id === preferred.id);
}
export function ownedCodeEvidence(records: readonly CodeEvidence[]): CodeEvidence[] {
  return sortedCodeEvidence(records.filter(row => row.ownership === "own"));
}
