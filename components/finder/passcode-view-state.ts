import { isPasscodeReportID, normalizePasscodeInput, type PasscodeInput } from "@/lib/passcode-model";
import type { CodeEvidence } from "@/lib/code-evidence-model";

export interface CodeReportAttempt { id: string; input: PasscodeInput }

/** An unconfirmed publish retries its original immutable identity and payload. */
export function prepareCodeReportAttempt(previous: CodeReportAttempt | null, input: PasscodeInput, newID: () => string): CodeReportAttempt {
  if (previous) return previous;
  const normalized = normalizePasscodeInput(input);
  const id = newID();
  if (!isPasscodeReportID(id)) throw new Error("The code report could not be prepared. Please retry.");
  return { id, input: normalized };
}

/** A missing ownership or feedback read is never permission to vote. */
export function canGiveCodeFeedback(record: CodeEvidence, ready: boolean): boolean {
  return ready && record.visibility === "public" && record.ownership === "other" && record.feedbackLoaded;
}

export function codeVerificationLabel(record: Pick<CodeEvidence, "verifiedAt" | "usedCount" | "feedbackLoaded" | "visibility">): string {
  if (record.verifiedAt) return "Verified";
  if (record.visibility === "private") return "Not yet verified";
  if (!record.feedbackLoaded) return "Verification not loaded";
  return record.usedCount !== null && record.usedCount > 0 ? "Verification date unknown" : "Not yet verified";
}
