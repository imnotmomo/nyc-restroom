"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Globe2, KeyRound, LockKeyhole, Pencil, Plus, Trash2, X } from "lucide-react";
import { MAX_PASSCODE_LENGTH, type PasscodeInput } from "@/lib/passcode-model";
import { ownedCodeEvidence, sortedCodeEvidence, visiblePublicCodeEvidence } from "@/lib/code-evidence-model";
import type { CodeEvidence, CodeEvidenceState, CodeVote } from "@/lib/code-reports";
import { canGiveCodeFeedback, codeVerificationLabel, prepareCodeReportAttempt, type CodeReportAttempt } from "@/components/finder/passcode-view-state";

export interface RestroomPasscodesProps {
  placeID: string;
  uid: string | null;
  accountLoading: boolean;
  accountGeneration?: object;
  authBusy?: boolean;
  evidence: CodeEvidenceState;
  actionError?: string | null;
  authError?: string | null;
  busy?: boolean;
  onSignIn: () => void;
  newReportID: () => string;
  onReport: (attempt: CodeReportAttempt) => Promise<boolean>;
  onVisibility: (expected: CodeEvidence, visibility: PasscodeInput["visibility"]) => Promise<boolean>;
  onDelete: (expected: CodeEvidence) => Promise<boolean>;
  onVerifyPrivate: (expected: CodeEvidence) => Promise<boolean>;
  onFeedback: (expected: CodeEvidence, vote: CodeVote) => Promise<boolean>;
  onRetry: () => void;
}

/** Shared with the existing new-restroom form; its initial legacy code stays compatible. */
export function PasscodeVisibilityChoices({ id, value, onChange, disabled = false }: {
  id: string;
  value: PasscodeInput["visibility"];
  onChange: (value: PasscodeInput["visibility"]) => void;
  disabled?: boolean;
}) {
  return <fieldset className="finder-passcode-visibility" disabled={disabled}>
    <legend>Who can see this code?</legend>
    <label className={`finder-passcode-choice${value === "private" ? " is-selected" : ""}`} htmlFor={`${id}-private`}>
      <input id={`${id}-private`} type="radio" name={`${id}-visibility`} value="private" checked={value === "private"} onChange={() => onChange("private")} />
      <span><strong><LockKeyhole size={15} aria-hidden="true" />Only me</strong><span>Only your signed-in account can read it.</span></span>
    </label>
    <label className={`finder-passcode-choice${value === "public" ? " is-selected" : ""}`} htmlFor={`${id}-public`}>
      <input id={`${id}-public`} type="radio" name={`${id}-visibility`} value="public" checked={value === "public"} onChange={() => onChange("public")} />
      <span><strong><Globe2 size={15} aria-hidden="true" />Everyone</strong><span>Anyone visiting this listing can read it.</span></span>
    </label>
  </fieldset>;
}

function ReportTime({ value }: { value: Date }) {
  if (!Number.isFinite(value.getTime())) return <>Date not available</>;
  return <time dateTime={value.toISOString()}>{new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(value)}</time>;
}

function CodeDates({ record }: { record: CodeEvidence }) {
  return <dl className="finder-passcode-dates">
    <div><dt>Reported</dt><dd><ReportTime value={record.codeUpdatedAt} /></dd></div>
    <div><dt>Last verified</dt><dd>{record.verifiedAt ? <ReportTime value={record.verifiedAt} /> : codeVerificationLabel(record)}</dd></div>
  </dl>;
}

type Context = { scope: string; generation?: object };
type ScopeState = {
  owner: Context;
  editing: boolean;
  code: string;
  visibility: PasscodeInput["visibility"];
  reportID: string | null;
  attempt: CodeReportAttempt | null;
  visibilityEdit: { expected: CodeEvidence; visibility: PasscodeInput["visibility"] } | null;
  confirmingDelete: CodeEvidence | null;
  pending: string | null;
  error: string | null;
  message: string | null;
};
function emptyState(owner: Context): ScopeState {
  return { owner, editing: false, code: "", visibility: "private", reportID: null, attempt: null, visibilityEdit: null, confirmingDelete: null, pending: null, error: null, message: null };
}

export function RestroomPasscodes({ placeID, uid, accountLoading, accountGeneration, authBusy = false, evidence, actionError = null,
  authError = null, busy = false, onSignIn, newReportID, onReport, onVisibility, onDelete, onVerifyPrivate, onFeedback, onRetry,
}: RestroomPasscodesProps) {
  const id = useId();
  const scope = JSON.stringify([uid, placeID]);
  const context = useRef<Context>({ scope, generation: accountGeneration });
  if (context.current.scope !== scope || context.current.generation !== accountGeneration) context.current = { scope, generation: accountGeneration };
  const owner = context.current;
  const [storedState, setStoredState] = useState(() => emptyState(owner));
  const state = storedState.owner === owner ? storedState : emptyState(owner);
  const inFlight = useRef<object | null>(null);
  const mounted = useRef(true);
  const records = evidence.records.filter((record) => record.placeID === placeID);
  const feedsReady = !evidence.publicLoading && !evidence.feedbackLoading && !evidence.publicError && !evidence.feedbackError;
  const reports = visiblePublicCodeEvidence(records, Boolean(feedsReady));
  const ownReports = uid ? ownedCodeEvidence(records) : [];
  const isBusy = busy || state.pending !== null;
  const writeLocked = !uid || accountLoading || authBusy || isBusy;
  const ownLocked = writeLocked || evidence.ownLoading || Boolean(evidence.ownError);
  const draftLocked = ownLocked || Boolean(state.attempt);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current = null; };
  }, []);
  useEffect(() => { setStoredState(emptyState(owner)); inFlight.current = null; }, [owner]);

  function update(patch: Partial<ScopeState>) {
    setStoredState((previous) => ({ ...(previous.owner === owner ? previous : emptyState(owner)), ...patch, owner }));
  }
  async function perform(kind: string, action: () => Promise<boolean>, message: string, closeEditor = false) {
    if (writeLocked || inFlight.current) return;
    const operation = {};
    const started = owner;
    const isCurrent = () => mounted.current && context.current === started && inFlight.current === operation;
    inFlight.current = operation;
    update({ pending: kind, error: null, message: null });
    try {
      const confirmed = await action();
      if (!isCurrent()) return;
      if (confirmed) {
        if (closeEditor) setStoredState({ ...emptyState(owner), message });
        else update({ message, confirmingDelete: null, visibilityEdit: null });
      } else update({ error: "That change could not be confirmed. Your draft is still here; retry when your connection is ready." });
    } catch {
      if (isCurrent()) update({ error: "That change could not be confirmed. Your draft is still here; retry when your connection is ready." });
    } finally {
      if (isCurrent()) { inFlight.current = null; update({ pending: null }); }
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (ownLocked || inFlight.current) return;
    let attempt: CodeReportAttempt;
    try { attempt = prepareCodeReportAttempt(state.attempt, { code: state.code, visibility: state.visibility }, () => state.reportID ?? newReportID()); }
    catch (error) { update({ error: error instanceof Error ? error.message : "Check the code before reporting it." }); return; }
    update({ attempt });
    await perform("report", () => onReport(attempt), "Your new code report was saved.", true);
  }

  function publicReport(record: CodeEvidence, preferred: boolean) {
    const feedbackReady = canGiveCodeFeedback(record, !writeLocked && !evidence.publicLoading && !evidence.publicError);
    const feedbackPending = state.pending === `used:${record.id}` || state.pending === `invalid:${record.id}`;
    return <article className="finder-passcode-report" key={record.id}>
      <p className="finder-passcode-label"><Globe2 size={14} aria-hidden="true" />{preferred && feedsReady ? record.verifiedAt ? "Latest verified code" : "Latest reported code" : "Shared code report"}{record.ownership === "own" ? " · Your report" : ""}</p>
      <code className="finder-passcode-value">{record.code}</code>
      <CodeDates record={record} />
      {!record.feedbackLoaded ? <p className="finder-passcode-status" role="status">{evidence.feedbackError ? "Code feedback is unavailable." : "Loading code feedback…"}</p>
        : <p className="finder-passcode-status">Successful use: {record.usedCount ?? "Not reported"} · Didn’t work: {record.invalidCount ?? "Not reported"}</p>}
      <div className="finder-passcode-actions" aria-label="Report your experience with this code">
        <button type="button" className="finder-secondary-button" disabled={!feedbackReady || feedbackPending} aria-pressed={record.currentVote === "used"} onClick={() => void perform(`used:${record.id}`, () => onFeedback(record, "used"), "Your successful-use report was confirmed.")}><Check size={16} aria-hidden="true" />{state.pending === `used:${record.id}` ? "Confirming…" : "I used this code"}</button>
        <button type="button" className="finder-secondary-button" disabled={!feedbackReady || feedbackPending} aria-pressed={record.currentVote === "invalid"} onClick={() => void perform(`invalid:${record.id}`, () => onFeedback(record, "invalid"), "Your code feedback was confirmed.")}><X size={16} aria-hidden="true" />{state.pending === `invalid:${record.id}` ? "Confirming…" : "Code didn’t work"}</button>
      </div>
      {uid && record.ownership === "own" && <p className="finder-passcode-status">Other visitors can confirm your shared code. Your own use does not count toward its confirmations.</p>}
      {uid && record.ownership === "unknown" && <p className="finder-passcode-status">Your report controls have not loaded. Retry before giving feedback.</p>}
    </article>;
  }
  function ownReport(record: CodeEvidence) {
    const editing = state.visibilityEdit?.expected.id === record.id ? state.visibilityEdit : null;
    const deleting = state.confirmingDelete?.id === record.id;
    return <article className="finder-passcode-own" key={record.id}>
      <div className="finder-passcode-own-heading"><h4>Your code report</h4><span className={`finder-passcode-badge${record.visibility === "private" ? " is-private" : ""}`}>{record.visibility === "private" ? <LockKeyhole size={13} aria-hidden="true" /> : <Globe2 size={13} aria-hidden="true" />}{record.visibility === "private" ? "Only me" : "Everyone"}</span></div>
      <code className="finder-passcode-value">{record.code}</code>
      <CodeDates record={record} />
      {!editing && !deleting && <div className="finder-passcode-actions">
        <button type="button" className="finder-secondary-button" disabled={ownLocked} onClick={() => update({ visibilityEdit: { expected: record, visibility: record.visibility }, confirmingDelete: null, error: null, message: null })}><Pencil size={15} aria-hidden="true" />Change visibility</button>
        {record.visibility === "private" && <button type="button" className="finder-secondary-button" disabled={ownLocked} onClick={() => void perform(`private:${record.id}`, () => onVerifyPrivate(record), "Successful use recorded for your private code.")}><Check size={16} aria-hidden="true" />I used this code</button>}
        <button type="button" className="finder-passcode-delete" disabled={ownLocked} onClick={() => update({ confirmingDelete: record, visibilityEdit: null, error: null, message: null })}><Trash2 size={15} aria-hidden="true" />Delete my report</button>
      </div>}
      {editing && <form className="finder-passcode-form" onSubmit={(event) => { event.preventDefault(); if (!ownLocked) void perform(`visibility:${record.id}`, () => onVisibility(editing.expected, editing.visibility), "Your code visibility was changed."); }}>
        <p className="finder-passcode-status">The code stays unchanged. Report a new code to keep earlier reports available.</p>
        <PasscodeVisibilityChoices id={`${id}-visibility-${record.id.replace(":", "-")}`} value={editing.visibility} onChange={(visibility) => update({ visibilityEdit: { ...editing, visibility } })} disabled={ownLocked} />
        <div className="finder-passcode-actions"><button type="submit" className="finder-primary-button" disabled={ownLocked || editing.visibility === editing.expected.visibility}>Save visibility</button><button type="button" className="finder-secondary-button" disabled={isBusy} onClick={() => update({ visibilityEdit: null })}>Cancel</button></div>
      </form>}
      {deleting && <div className="finder-passcode-delete-confirm"><p>Delete this code report{record.visibility === "public" ? " and remove its public code" : ""}? Your saved place stays saved.</p><div className="finder-passcode-actions"><button type="button" className="finder-passcode-delete" disabled={ownLocked} onClick={() => void perform(`delete:${record.id}`, () => onDelete(state.confirmingDelete!), "Your code report was deleted.")}>{state.pending === `delete:${record.id}` ? "Deleting…" : "Delete code report"}</button><button type="button" className="finder-secondary-button" disabled={isBusy} onClick={() => update({ confirmingDelete: null })}>Keep report</button></div></div>}
    </article>;
  }

  return <section className="finder-passcodes" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><KeyRound size={19} aria-hidden="true" />Passcodes</h3>
    <p className="finder-field-note">Dated visitor reports do not confirm entry permission or that a code works now. Report successful use only after trying the code.</p>
    <div className="finder-passcode-public">
      {evidence.publicLoading && <p className="finder-passcode-status" role="status">Loading shared codes…</p>}
      {evidence.publicError && <p className="finder-form-error" role="alert">{evidence.publicError}</p>}
      {!evidence.publicLoading && !evidence.publicError && reports.length === 0 && <p className="finder-passcode-status">No public code reported.</p>}
      {reports[0] && publicReport(reports[0], true)}
      {reports.length > 1 && <details className="finder-passcode-older"><summary>Other code reports ({reports.length - 1})</summary>{reports.slice(1).map((record) => publicReport(record, false))}</details>}
      {reports.length > 0 && <p className="finder-passcode-status">The latest successful-use verification comes first; otherwise the latest report does. Four confirmations on the newest report hide older codes; the latest verified code stays.</p>}
    </div>
    {evidence.feedbackError && <p className="finder-form-error" role="alert">{evidence.feedbackError}</p>}
    {!uid && <div className="finder-passcode-sign-in"><p>Sign in to report a code or give feedback. Signing in does not submit a report.</p><button type="button" className="finder-secondary-button" disabled={accountLoading || authBusy} onClick={onSignIn}>{accountLoading || authBusy ? "Connecting account…" : "Sign in with Google"}<ArrowUpRight size={16} aria-hidden="true" /></button></div>}
    {uid && <>
      <div className="finder-passcode-actions"><button type="button" className="finder-primary-button" disabled={ownLocked || state.editing} onClick={() => { try { update({ editing: true, reportID: state.reportID ?? newReportID(), error: null, message: null }); } catch { update({ error: "The code form could not be prepared. Retry when your connection is ready." }); } }}><Plus size={16} aria-hidden="true" />Report a new code</button></div>
      {state.editing && <form className="finder-passcode-form" onSubmit={(event) => void submit(event)} noValidate>
        <h4>Report a new code</h4>
        {state.attempt && <p className="finder-passcode-status" role="status">This exact report is kept while its save is unconfirmed. Retry checks the same report.</p>}
        <div className="finder-passcode-field"><label htmlFor={`${id}-code`}>Restroom code</label><input id={`${id}-code`} name="restroomPasscode" type="text" value={state.code} maxLength={MAX_PASSCODE_LENGTH} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={draftLocked} aria-describedby={`${id}-code-help`} onChange={(event) => update({ code: event.target.value, error: null, message: null })} /><p id={`${id}-code-help`}>Up to {MAX_PASSCODE_LENGTH} standard letters, numbers, or symbols. Share only a code you are allowed to share.</p></div>
        <PasscodeVisibilityChoices id={`${id}-new-visibility`} value={state.visibility} onChange={(visibility) => update({ visibility, error: null, message: null })} disabled={draftLocked} />
        <p className="finder-passcode-save-note">{state.visibility === "private" ? "Only your account can read this code. A confirmed private report also saves this place." : "Everyone will be able to read this code."} Earlier reports stay unchanged.</p>
        <div className="finder-passcode-actions"><button type="submit" className="finder-primary-button" disabled={ownLocked}>{state.pending === "report" ? "Confirming…" : state.attempt ? "Retry code report" : "Save new code report"}</button><button type="button" className="finder-secondary-button" disabled={isBusy} onClick={() => update({ editing: false })}>Hide form</button></div>
      </form>}
      {evidence.ownLoading && <p className="finder-passcode-status" role="status">Loading your code reports…</p>}
      {evidence.ownError && <p className="finder-form-error" role="alert">{evidence.ownError}</p>}
      {ownReports.length > 0 && <details className="finder-passcode-older"><summary>Your code reports ({ownReports.length})</summary>{sortedCodeEvidence(ownReports).map(ownReport)}</details>}
    </>}
    {(evidence.ownError || evidence.publicError || evidence.feedbackError) && <button type="button" className="finder-secondary-button" disabled={isBusy} onClick={onRetry}>Retry loading codes</button>}
    {(actionError || state.error || authError) && <p className="finder-form-error" role="alert">{actionError || state.error || authError}</p>}
    {state.message && <p className="finder-passcode-success" role="status"><Check size={15} aria-hidden="true" />{state.message}</p>}
  </section>;
}
