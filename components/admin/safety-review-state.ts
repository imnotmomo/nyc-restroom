import { REPORT_REASONS, type ModerationSafetyReport, type SafetyDecision } from "@/lib/moderation-client";

export interface SafetyReviewAttempt {
  item: ModerationSafetyReport;
  decision: SafetyDecision;
  actionId: string;
  reason: string;
  acknowledged: boolean;
  uncertain: boolean;
}
export interface SafetyReviewState {
  attempt: SafetyReviewAttempt | null;
  open: boolean;
  busy: boolean;
  error: string | null;
}
export type SafetyReviewEvent =
  | { type: "open"; item: ModerationSafetyReport; decision: SafetyDecision; actionId: string }
  | { type: "reason"; reason: string }
  | { type: "acknowledge"; value: boolean }
  | { type: "begin" }
  | { type: "failed"; error: string; uncertain: boolean }
  | { type: "close" }
  | { type: "resume" }
  | { type: "reset" };

export const emptySafetyReview: SafetyReviewState = { attempt: null, open: false, busy: false, error: null };

export function safetyDecisionAllowed(item: ModerationSafetyReport, decision: SafetyDecision): boolean {
  if (item.status !== "pending") return false;
  if (decision === "dismiss") return true;
  if (!item.available || item.text === null) return false;
  if (decision === "remove") return true;
  return decision === "remove-and-suspend" && item.canSuspend
    && (item.kind === "public-note" || item.kind === "unified-visit"
      || item.kind === "legacy-code" || item.kind === "v2-code");
}

export function canConfirmSafetyReview(state: SafetyReviewState): boolean {
  const attempt = state.attempt;
  return Boolean(attempt && !state.busy && safetyDecisionAllowed(attempt.item, attempt.decision)
    && Object.hasOwn(REPORT_REASONS, attempt.reason)
    && (attempt.decision !== "remove-and-suspend" || attempt.acknowledged));
}

/** Pins the exact report version/action across an ambiguous network result. */
export function safetyReviewReducer(state: SafetyReviewState, event: SafetyReviewEvent): SafetyReviewState {
  switch (event.type) {
    case "open":
      if (state.busy || state.attempt?.uncertain || !safetyDecisionAllowed(event.item, event.decision)) return state;
      return { attempt: { item: { ...event.item }, decision: event.decision, actionId: event.actionId,
        reason: "", acknowledged: false, uncertain: false }, open: true, busy: false, error: null };
    case "reason":
      if (!state.attempt || state.busy || state.attempt.uncertain
        || event.reason !== "" && !Object.hasOwn(REPORT_REASONS, event.reason)) return state;
      return { ...state, attempt: { ...state.attempt, reason: event.reason }, error: null };
    case "acknowledge":
      if (!state.attempt || state.busy || state.attempt.uncertain) return state;
      return { ...state, attempt: { ...state.attempt, acknowledged: event.value } };
    case "begin":
      return canConfirmSafetyReview(state) ? { ...state, busy: true, error: null } : state;
    case "failed":
      return !state.attempt ? state : { ...state, busy: false, error: event.error,
        attempt: { ...state.attempt, uncertain: state.attempt.uncertain || event.uncertain } };
    case "close":
      if (state.busy) return state;
      return state.attempt?.uncertain ? { ...state, open: false } : emptySafetyReview;
    case "resume":
      return state.attempt?.uncertain ? { ...state, open: true } : state;
    case "reset": return emptySafetyReview;
  }
}
