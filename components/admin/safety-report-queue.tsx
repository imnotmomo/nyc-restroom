"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { AlertCircle, Check, ChevronRight, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase-client";
import { createModerationClient, ModerationApiError, newModerationActionID, REPORT_REASONS,
  type ModerationSafetyReport, type SafetyDecision } from "@/lib/moderation-client";
import { canConfirmSafetyReview, emptySafetyReview, safetyDecisionAllowed, safetyReviewReducer,
  type SafetyReviewState } from "./safety-review-state";

type ReportStatus = ModerationSafetyReport["status"];
type Client = ReturnType<typeof createModerationClient>;
const kindLabels: Record<ModerationSafetyReport["kind"], string> = { "public-note": "Visitor note", "unified-visit": "Visit comment", "source-comment": "Source comment", "research-comment": "Research comment", "legacy-code": "Shared entry code", "v2-code": "Shared code report" };
const isCodeReport = (item: ModerationSafetyReport) => item.kind === "legacy-code" || item.kind === "v2-code";
const decisionLabel = (decision: SafetyDecision, item: ModerationSafetyReport) => decision === "remove" && isCodeReport(item) ? "Remove public code" : decisionLabels[decision];
const decisionLabels: Record<SafetyDecision, string> = { dismiss: "Dismiss report", remove: "Remove text", "remove-and-suspend": "Remove and suspend" };
const dateTime = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
const safeError = (error: unknown) => error instanceof ModerationApiError ? error.message : "The result could not be confirmed. Retry the same action.";
const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";
function ErrorNotice({ children }: { children: React.ReactNode }) {
  return <div className="moderation-error" role="alert"><AlertCircle size={18} /><div>{children}</div></div>;
}

function SafetyDialog({ state, dispatch, submit }: { state: SafetyReviewState; dispatch: React.Dispatch<Parameters<typeof safetyReviewReducer>[1]>; submit: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const attempt = state.attempt;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (state.open && !dialog.open) dialog.showModal();
    if (!state.open && dialog.open) dialog.close();
  }, [state.open]);
  return <dialog ref={ref} className="moderation-dialog" aria-labelledby="safety-action-title" aria-describedby="safety-action-description"
    onCancel={event => { event.preventDefault(); dispatch({ type: "close" }); }}>
    {attempt && <div className="moderation-dialog-inner" aria-busy={state.busy}>
      <div className="moderation-dialog-header"><h2 id="safety-action-title">{decisionLabel(attempt.decision, attempt.item)}?</h2><button type="button" className="moderation-icon-button" aria-label="Close report confirmation" disabled={state.busy} onClick={() => dispatch({ type: "close" })}><X size={20} /></button></div>
      <p className="moderation-dialog-target">{kindLabels[attempt.item.kind]} · {REPORT_REASONS[attempt.item.reason]}</p>
      <p id="safety-action-description" className="moderation-faint">{attempt.decision === "dismiss"
        ? "Close this report without removing text or changing an account’s contribution access."
        : attempt.decision === "remove"
        ? isCodeReport(attempt.item) ? "Remove this exact public code version. The contributor’s private code remains unchanged." : "Remove the exact reported text and its public attribution. Any structured visit details remain."
        : isCodeReport(attempt.item) ? "Remove this public code version and suspend its author’s future public contributions. Private codes, Saved places and account deletion remain available." : "Remove the exact reported text and its public attribution, and suspend its author from creating or editing public contributions. Browsing, private Saved places and account deletion remain available."}</p>
      {attempt.item.text !== null && <blockquote className="moderation-confirm-comment">{attempt.item.text}</blockquote>}
      <div className="moderation-reason-field"><label htmlFor="safety-action-reason">Reason for this decision</label><select id="safety-action-reason" value={attempt.reason} disabled={state.busy || attempt.uncertain} onChange={event => dispatch({ type: "reason", reason: event.target.value })} required><option value="">Choose a reason</option>{Object.entries(REPORT_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {attempt.decision === "remove-and-suspend" && <label className="moderation-safety-acknowledge"><input type="checkbox" checked={attempt.acknowledged} disabled={state.busy || attempt.uncertain} onChange={event => dispatch({ type: "acknowledge", value: event.target.checked })} /><span>I understand this also suspends the author’s future public contributions.</span></label>}
      {state.error && <ErrorNotice>{state.error}</ErrorNotice>}
      {attempt.uncertain && <p className="moderation-retry-note">The result is unconfirmed. Retry keeps the same report version, decision and reason.</p>}
      <div className="moderation-dialog-actions"><button type="button" className="moderation-button moderation-secondary" disabled={state.busy} onClick={() => dispatch({ type: "close" })}>{attempt.uncertain ? "Return to queue" : "Cancel"}</button><button type="button" className={`moderation-button ${attempt.decision === "dismiss" ? "moderation-primary" : "moderation-danger"}`} disabled={!canConfirmSafetyReview(state)} onClick={submit}>{state.busy ? <><RefreshCw size={17} className="moderation-spin" />Confirming…</> : attempt.uncertain ? "Retry same action" : decisionLabel(attempt.decision, attempt.item)}</button></div>
    </div>}
  </dialog>;
}

/** Private queue. Kept mounted across tabs so uncertain review receipts survive. */
export function SafetyReportQueue({ active, user, client, externallyLocked, onAccessFailure, onLockChange, onBusyChange }: {
  active: boolean; user: User; client: Client; externallyLocked: boolean;
  onAccessFailure: (error: unknown) => boolean; onLockChange: (value: boolean) => void; onBusyChange: (value: boolean) => void;
}) {
  const [status, setStatus] = useState<ReportStatus>("pending");
  const [items, setItems] = useState<ModerationSafetyReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewWarning, setReviewWarning] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [review, dispatch] = useReducer(safetyReviewReducer, emptySafetyReview);
  const controllers = useRef(new Set<AbortController>());
  const generation = useRef(0);
  const operation = useRef<object | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const isCurrent = useCallback(() => getFirebaseClient()?.auth.currentUser === user, [user]);
  const locked = externallyLocked || review.busy || Boolean(review.attempt?.uncertain);
  useEffect(() => { onLockChange(review.busy || Boolean(review.attempt?.uncertain)); onBusyChange(review.busy); }, [review.busy, review.attempt?.uncertain, onLockChange, onBusyChange]);
  useEffect(() => () => {
    generation.current += 1; operation.current = null;
    controllers.current.forEach(controller => controller.abort()); controllers.current.clear();
    onLockChange(false); onBusyChange(false);
  }, [user, onLockChange, onBusyChange]);
  useEffect(() => {
    if (!active) return;
    const current = ++generation.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setItems([]); setCursor(null); setSelection(null); setLoading(true); setLoadingMore(false); setError(null);
    void client.reports(status, null, controller.signal).then(page => {
      if (controller.signal.aborted || generation.current !== current || !isCurrent()) return;
      setItems([...new Map(page.items.map(item => [item.id, item])).values()]); setCursor(page.nextCursor);
    }).catch(error => {
      if (controller.signal.aborted || generation.current !== current || !isCurrent() || isAbort(error)) return;
      if (!onAccessFailure(error)) setError(safeError(error));
    }).finally(() => { controllers.current.delete(controller); if (generation.current === current && isCurrent()) setLoading(false); });
    return () => { controller.abort(); controllers.current.delete(controller); generation.current += 1; };
  }, [active, user, client, status, refresh, isCurrent, onAccessFailure]);
  const visible = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return items.filter(item => `${kindLabels[item.kind]} ${REPORT_REASONS[item.reason]} ${item.text ?? ""}`.toLocaleLowerCase().includes(search));
  }, [items, query]);
  const selected = visible.find(item => item.id === selection) ?? visible[0] ?? null;
  useEffect(() => { if (moveFocus.current) { heading.current?.focus(); moveFocus.current = false; } }, [selected?.id]);

  function refreshQueue() {
    generation.current += 1; setReviewWarning(null); setLoading(true); setRefresh(value => value + 1);
  }
  function changeStatus(next: ReportStatus) {
    if (status === next) return;
    generation.current += 1; setStatus(next); setItems([]); setCursor(null); setSelection(null); setQuery(""); setError(null); setNotice(null); setReviewWarning(null); setLoading(true);
  }
  async function loadMore() {
    if (!cursor || loading || loadingMore || !isCurrent()) return;
    const current = generation.current;
    const controller = new AbortController(); controllers.current.add(controller);
    setLoadingMore(true); setError(null);
    try {
      const page = await client.reports(status, cursor, controller.signal);
      if (controller.signal.aborted || generation.current !== current || !isCurrent()) return;
      setItems(previous => [...new Map([...previous, ...page.items].map(item => [item.id, item])).values()]); setCursor(page.nextCursor);
    } catch (error) {
      if (controller.signal.aborted || generation.current !== current || !isCurrent() || isAbort(error)) return;
      if (!onAccessFailure(error)) { setError(safeError(error)); if (error instanceof ModerationApiError && error.status === 410) setCursor(null); }
    } finally { controllers.current.delete(controller); if (generation.current === current && isCurrent()) setLoadingMore(false); }
  }
  async function resolve() {
    if (!canConfirmSafetyReview(review) || externallyLocked || operation.current || !isCurrent() || !review.attempt) return;
    const attempt = review.attempt, currentOperation = {}; operation.current = currentOperation;
    const controller = new AbortController(); controllers.current.add(controller); dispatch({ type: "begin" });
    try {
      const result = await client.resolveReport(attempt.item, attempt.decision, attempt.reason, attempt.actionId, controller.signal);
      if (controller.signal.aborted || !isCurrent() || operation.current !== currentOperation) return;
      dispatch({ type: "reset" }); setItems(previous => previous.filter(item => item.id !== result.reportID));
      const removed = isCodeReport(attempt.item) ? "Reported public code removed." : "Reported text removed.";
      setNotice(result.decision === "dismiss" ? "Report dismissed. No content or account access changed."
        : result.decision === "remove-and-suspend" ? `${removed} The author’s public contributions are suspended.`
        : isCodeReport(attempt.item) ? `${removed} Private codes remain unchanged.`
        : `${removed} Any structured visit details remain.`);
      refreshQueue();
    } catch (error) {
      if (controller.signal.aborted || !isCurrent() || operation.current !== currentOperation || isAbort(error)) return;
      if (onAccessFailure(error)) return;
      if (error instanceof ModerationApiError && [404, 409].includes(error.status)) {
        dispatch({ type: "reset" }); setReviewWarning(error.message); generation.current += 1; setLoading(true); setRefresh(value => value + 1);
      } else dispatch({ type: "failed", error: safeError(error), uncertain: !(error instanceof ModerationApiError) || error.uncertain });
    } finally { controllers.current.delete(controller); if (operation.current === currentOperation) operation.current = null; }
  }
  function begin(item: ModerationSafetyReport, decision: SafetyDecision) {
    if (!locked) dispatch({ type: "open", item, decision, actionId: newModerationActionID() });
  }

  return <section hidden={!active} aria-label="Private content reports" className="moderation-safety">
    <div className="moderation-page-heading"><div><p className="moderation-eyebrow">Content safety</p><h1>Content reports</h1><p>Private reports about public content. Decisions apply to the reported version.</p></div><button type="button" className="moderation-button moderation-secondary" disabled={loading || loadingMore || review.busy} onClick={refreshQueue}><RefreshCw size={17} className={loading ? "moderation-spin" : ""} />Refresh</button></div>
    <nav className="moderation-safety-status" aria-label="Content report status">{(["pending", "resolved"] as const).map(value => <button type="button" key={value} className={`moderation-button ${status === value ? "moderation-primary" : "moderation-secondary"}`} aria-pressed={status === value} onClick={() => changeStatus(value)}>{value === "pending" ? "Pending reports" : "Resolved reports"}</button>)}</nav>
    {notice && <div className="moderation-success" role="status"><Check size={18} /><span>{notice}</span><button type="button" className="moderation-icon-button" aria-label="Dismiss report update" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {externallyLocked && <div className="moderation-pending-action" role="status"><AlertCircle size={18} /><span>An action in another queue needs confirmation before a new review.</span></div>}
    {review.attempt?.uncertain && !review.open && <div className="moderation-pending-action" role="status"><AlertCircle size={18} /><span>A report decision still needs confirmation.</span><button type="button" onClick={() => dispatch({ type: "resume" })}>Resume the same action</button></div>}
    {error && <ErrorNotice>{error}</ErrorNotice>}{reviewWarning && <ErrorNotice>{reviewWarning}</ErrorNotice>}
    <div className="moderation-toolbar"><label className="moderation-search"><Search size={18} /><span className="moderation-sr-only">Filter loaded content reports</span><input type="search" value={query} disabled={loading} placeholder="Filter loaded reasons or text" onChange={event => setQuery(event.target.value)} /></label>{!loading && <span className="moderation-loaded">{query.trim() ? `${visible.length} matching · ` : ""}{items.length} loaded</span>}</div>
    {loading ? <div className="moderation-loading-panel" role="status"><RefreshCw size={20} className="moderation-spin" />Loading reports…</div>
      : error && !items.length ? <div className="moderation-empty"><AlertCircle size={26} /><h2>Reports unavailable</h2><p>Retry to load this private queue.</p><button type="button" className="moderation-button moderation-secondary" onClick={refreshQueue}>Try again</button></div>
      : !visible.length ? <div className="moderation-empty"><ShieldAlert size={27} /><h2>{query.trim() ? "No matching loaded reports" : cursor ? "No reports on this page" : "No reports here"}</h2><p>{query.trim() ? "Clear the filter or load more reports." : cursor ? "Load more to continue through the queue." : "Content reports with this status will appear here."}</p></div>
      : <div className="moderation-queue-layout"><section className="moderation-queue" aria-label="Loaded content reports"><ul>{visible.map(item => <li key={item.id}><button type="button" className={`moderation-queue-row${selected?.id === item.id ? " moderation-row-selected" : ""}`} aria-pressed={selected?.id === item.id} onClick={() => { moveFocus.current = true; setSelection(item.id); }}><span className="moderation-row-top"><strong>{REPORT_REASONS[item.reason]}</strong><ChevronRight size={15} /></span><span className="moderation-row-address">{kindLabels[item.kind]}</span><span className="moderation-comment-excerpt">{item.text ?? "Reported version unavailable"}</span><span className="moderation-row-meta">Reported {dateTime(item.createdAt)}</span></button></li>)}</ul></section>
        {selected && <article className="moderation-review" aria-label="Reported content details"><div className="moderation-review-heading"><p className="moderation-eyebrow">{kindLabels[selected.kind]}</p><h2 ref={heading} tabIndex={-1}>{REPORT_REASONS[selected.reason]}</h2><p className="moderation-address">{selected.status === "pending" ? "Pending report" : "Resolved report"}</p></div><div className="moderation-review-body"><dl className="moderation-dates"><div><dt>Reported</dt><dd>{dateTime(selected.createdAt)}</dd></div><div><dt>Reviewed</dt><dd>{selected.reviewedAt ? dateTime(selected.reviewedAt) : "Not yet reviewed"}</dd></div></dl><section className="moderation-section"><h3>{isCodeReport(selected) ? "Reported public code" : "Reported text"}</h3>{selected.available && selected.text !== null ? <blockquote className="moderation-comment-text">{selected.text}</blockquote> : <p className="moderation-original-text moderation-faint">This reported version is no longer available. You can dismiss the report; removal and suspension are unavailable.</p>}</section>{selected.decision && <p className="moderation-decision-record">Decision: {decisionLabel(selected.decision, selected)}</p>}{(selected.kind === "source-comment" || selected.kind === "research-comment") && <p className="moderation-attached">Imported source text can be removed. No author account will be suspended.</p>}<a className="moderation-safety-place-link" href={`/find/?place=${encodeURIComponent(selected.placeID)}`} target="_blank" rel="noreferrer">Open restroom in finder</a></div>
          {selected.status === "pending" && <div className="moderation-review-actions"><div><button type="button" className="moderation-button moderation-secondary" disabled={locked} onClick={() => begin(selected, "dismiss")}>Dismiss report</button><button type="button" className="moderation-button moderation-danger-outline" disabled={locked || !safetyDecisionAllowed(selected, "remove")} onClick={() => begin(selected, "remove")}>{decisionLabel("remove", selected)}</button>{safetyDecisionAllowed(selected, "remove-and-suspend") && <button type="button" className="moderation-button moderation-danger-outline" disabled={locked} onClick={() => begin(selected, "remove-and-suspend")}>Remove and suspend</button>}</div></div>}
        </article>}
      </div>}
    {cursor && <div className="moderation-pagination"><button type="button" className="moderation-button moderation-secondary" disabled={loading || loadingMore} onClick={() => { void loadMore(); }}>{loadingMore ? "Loading…" : "Load more reports"}</button><p>Filtering searches only reports loaded on this page.</p></div>}
    <SafetyDialog state={review} dispatch={dispatch} submit={() => { void resolve(); }} />
  </section>;
}
