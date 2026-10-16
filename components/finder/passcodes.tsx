"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Globe2, KeyRound, LockKeyhole, Pencil, Plus, Trash2 } from "lucide-react";
import { MAX_PASSCODE_LENGTH, type OwnPasscode, type PasscodeInput, type PublicPasscodeReport } from "@/lib/passcodes";

export interface RestroomPasscodesProps {
  placeID: string;
  uid: string | null;
  accountLoading: boolean;
  authBusy?: boolean;
  ownPasscode: OwnPasscode | null;
  publicReports: PublicPasscodeReport[];
  ownLoading: boolean;
  publicLoading: boolean;
  ownError?: string | null;
  publicError?: string | null;
  actionError?: string | null;
  authError?: string | null;
  busy?: boolean;
  onSignIn: () => void;
  onSave: (input: PasscodeInput, expected: OwnPasscode | null) => Promise<boolean>;
  onDelete: (expected: OwnPasscode) => Promise<boolean>;
  onVerifyOwn: (expected: OwnPasscode) => Promise<boolean>;
  onVerifyPublic: (report: PublicPasscodeReport) => Promise<boolean>;
  onRetry?: () => void;
}

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
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return <>Not reported</>;
  return <time dateTime={value.toISOString()}>{new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(value)}</time>;
}

function CodeDates({ updatedAt, verifiedAt, verificationUnknown = false }: { updatedAt: Date; verifiedAt: Date | null; verificationUnknown?: boolean }) {
  return <dl className="finder-passcode-dates">
    <div><dt>Code updated</dt><dd><ReportTime value={updatedAt} /></dd></div>
    <div><dt>Last verified</dt><dd>{verificationUnknown ? "Not loaded" : verifiedAt ? <ReportTime value={verifiedAt} /> : "Not yet verified"}</dd></div>
  </dl>;
}

type ScopeState = {
  scope: string;
  editing: boolean;
  code: string;
  visibility: PasscodeInput["visibility"];
  expected: OwnPasscode | null;
  confirmingDelete: boolean;
  pending: string | null;
  error: string | null;
  message: string | null;
};

function emptyState(scope: string): ScopeState {
  return { scope, editing: false, code: "", visibility: "private", expected: null, confirmingDelete: false, pending: null, error: null, message: null };
}

export function RestroomPasscodes({ placeID, uid, accountLoading, authBusy = false, ownPasscode, publicReports,
  ownLoading, publicLoading, ownError = null, publicError = null, actionError = null, authError = null, busy = false,
  onSignIn, onSave, onDelete, onVerifyOwn, onVerifyPublic, onRetry,
}: RestroomPasscodesProps) {
  const id = useId();
  const scope = JSON.stringify([uid, placeID]);
  const context = useRef({ scope });
  if (context.current.scope !== scope) context.current = { scope };
  const [storedState, setStoredState] = useState(() => emptyState(scope));
  const state = storedState.scope === scope ? storedState : emptyState(scope);
  const inFlight = useRef<object | null>(null);
  const mounted = useRef(true);
  const own = uid && ownPasscode?.placeID === placeID ? ownPasscode : null;
  const reports = publicReports.filter((report) => report.placeID === placeID).slice(0, 10);
  const sharedOwn = own?.visibility === "public" ? reports.find((report) => report.reportID === own.reportID && report.codeVersion === own.codeVersion) : null;
  const otherReports = reports.filter((report) => report.reportID !== own?.reportID);
  const isBusy = busy || state.pending !== null;
  const writeLocked = !uid || accountLoading || authBusy || isBusy;
  const editorLocked = writeLocked || ownLoading || Boolean(ownError);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current = null; };
  }, []);

  useEffect(() => {
    setStoredState(emptyState(scope));
    inFlight.current = null;
  }, [scope]);

  function update(patch: Partial<ScopeState>) {
    setStoredState((previous) => ({ ...(previous.scope === scope ? previous : emptyState(scope)), ...patch, scope }));
  }

  function edit() {
    if (editorLocked) return;
    update({ editing: true, code: own?.code ?? "", visibility: own?.visibility ?? "private", expected: own, confirmingDelete: false, error: null, message: null });
  }

  async function perform(kind: string, action: () => Promise<boolean>, message: string, closeEditor = false) {
    if (writeLocked || inFlight.current) return;
    const owner = context.current;
    const operation = {};
    inFlight.current = operation;
    update({ pending: kind, error: null, message: null });
    try {
      const confirmed = await action();
      if (!mounted.current || context.current !== owner || inFlight.current !== operation) return;
      if (confirmed) {
        if (closeEditor) setStoredState({ ...emptyState(scope), message });
        else update({ message, confirmingDelete: false });
      } else update({ error: "That change could not be confirmed. Your draft is still here; retry when your connection is ready." });
    } catch {
      if (mounted.current && context.current === owner && inFlight.current === operation) update({ error: "That change could not be confirmed. Your draft is still here; retry when your connection is ready." });
    } finally {
      if (mounted.current && context.current === owner && inFlight.current === operation) {
        inFlight.current = null;
        setStoredState((previous) => previous.scope === scope ? { ...previous, pending: null } : previous);
      }
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editorLocked) return;
    const code = state.code.trim();
    if (!code || code.length > MAX_PASSCODE_LENGTH || !/^[\x20-\x7e]+$/.test(code)) {
      update({ error: `Use 1–${MAX_PASSCODE_LENGTH} standard letters, numbers, or symbols for the code.` });
      return;
    }
    await perform("save", () => onSave({ code, visibility: state.visibility }, state.expected), "Your code was saved.", true);
  }

  function publicReport(report: PublicPasscodeReport) {
    return <article className="finder-passcode-report" key={report.reportID}>
      <p className="finder-passcode-label"><Globe2 size={14} aria-hidden="true" />Visitor-shared code</p>
      <code className="finder-passcode-value">{report.code}</code>
      <CodeDates updatedAt={report.codeUpdatedAt} verifiedAt={report.lastVerifiedAt} />
      {uid && <button type="button" className="finder-secondary-button finder-passcode-verify" disabled={writeLocked} onClick={() => void perform(`verify:${report.reportID}`, () => onVerifyPublic(report), "Successful use recorded for this code.")}><Check size={16} aria-hidden="true" />{state.pending === `verify:${report.reportID}` ? "Confirming…" : "I used this code"}</button>}
    </article>;
  }

  return <section className="finder-passcodes" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}><KeyRound size={19} aria-hidden="true" />Passcodes</h3>
    <p className="finder-field-note">Visitor reports can change. A code does not confirm permission to enter. Confirm a code only after you used it successfully.</p>

    {uid && <div className="finder-passcode-own">
      <div className="finder-passcode-own-heading"><h4>Your code</h4>{own && <span className={`finder-passcode-badge${own.visibility === "private" ? " is-private" : ""}`}>{own.visibility === "private" ? <LockKeyhole size={13} aria-hidden="true" /> : <Globe2 size={13} aria-hidden="true" />}{own.visibility === "private" ? "Only me" : "Everyone"}</span>}</div>
      {ownLoading && <p className="finder-passcode-status" role="status">Loading your code…</p>}
      {ownError && <p className="finder-form-error" role="alert">{ownError}</p>}
      {!ownLoading && !ownError && own && <>
        <code className="finder-passcode-value">{own.code}</code>
        <CodeDates updatedAt={own.codeUpdatedAt} verifiedAt={own.visibility === "public" ? sharedOwn?.lastVerifiedAt ?? null : own.lastVerifiedAt} verificationUnknown={own.visibility === "public" && !sharedOwn} />
        <p className="finder-passcode-status">{own.visibility === "private" ? "Only your account can read this code." : "Everyone can read this code on the listing."}</p>
      </>}
      {!ownLoading && !ownError && !own && !state.editing && <p className="finder-passcode-status">Keep a code for your next visit, or choose to share it.</p>}

      {!state.editing && !ownLoading && !ownError && <div className="finder-passcode-actions">
        <button type="button" className="finder-secondary-button" disabled={editorLocked} onClick={edit}>{own ? <Pencil size={15} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{own ? "Edit code or visibility" : "Save a code"}</button>
        {own && <><button type="button" className="finder-secondary-button" disabled={editorLocked} onClick={() => void perform("verify-own", () => onVerifyOwn(own), "Successful use recorded for your code.")}><Check size={16} aria-hidden="true" />{state.pending === "verify-own" ? "Confirming…" : "I used this code"}</button><button type="button" className="finder-passcode-delete" disabled={editorLocked} onClick={() => update({ confirmingDelete: true, error: null, message: null })}><Trash2 size={15} aria-hidden="true" />Delete my code</button></>}
      </div>}

      {state.editing && <form className="finder-passcode-form" onSubmit={(event) => void submit(event)} noValidate>
        <div className="finder-passcode-field"><label htmlFor={`${id}-code`}>Restroom code</label><input id={`${id}-code`} name="restroomPasscode" type="text" value={state.code} maxLength={MAX_PASSCODE_LENGTH} autoComplete="off" autoCapitalize="off" spellCheck={false} disabled={editorLocked} aria-describedby={`${id}-code-help`} onChange={(event) => update({ code: event.target.value, error: null, message: null })} /><p id={`${id}-code-help`}>Up to {MAX_PASSCODE_LENGTH} letters, numbers, or symbols. Share only a code you are allowed to share.</p></div>
        <PasscodeVisibilityChoices id={`${id}-visibility`} value={state.visibility} onChange={(visibility) => update({ visibility, error: null, message: null })} disabled={editorLocked} />
        <p className="finder-passcode-save-note">{state.visibility === "private" ? "Saving an Only me code also adds this place to Saved." : "Saving publishes this code for everyone to read."} You can change visibility later.</p>
        <p className="finder-passcode-status">{state.expected && state.expected.code !== state.code.trim() ? "Changing the code clears its previous verification." : "Saving or changing visibility does not mark a code as verified."}</p>
        <div className="finder-passcode-actions"><button className="finder-primary-button" type="submit" disabled={editorLocked}>{state.pending === "save" ? "Saving code…" : "Save code"}</button><button className="finder-secondary-button" type="button" disabled={isBusy} onClick={() => setStoredState(emptyState(scope))}>Cancel</button></div>
      </form>}

      {state.confirmingDelete && own && <div className="finder-passcode-delete-confirm"><p>Delete your code{own.visibility === "public" ? " and remove your public report" : ""}? Your saved place stays saved.</p><div className="finder-passcode-actions"><button type="button" className="finder-passcode-delete" disabled={editorLocked} onClick={() => void perform("delete", () => onDelete(own), "Your code was deleted.", true)}>{state.pending === "delete" ? "Deleting…" : "Delete code"}</button><button type="button" className="finder-secondary-button" disabled={isBusy} onClick={() => update({ confirmingDelete: false })}>Keep code</button></div></div>}
    </div>}

    <div className="finder-passcode-public">
      <h4>Shared codes</h4>
      <p className="finder-passcode-status">Up to 10 recent visitor reports, newest code update first.</p>
      {publicLoading && <p className="finder-passcode-status" role="status">Loading shared codes…</p>}
      {publicError && <p className="finder-form-error" role="alert">{publicError}</p>}
      {!publicLoading && !publicError && otherReports.length === 0 && <p className="finder-passcode-status">{own?.visibility === "public" ? "Your shared code is shown above. No other public code is reported." : "No public code reported."}</p>}
      {!publicLoading && !publicError && otherReports[0] && publicReport(otherReports[0])}
      {!publicLoading && !publicError && otherReports.length > 1 && <details className="finder-passcode-older"><summary>Other shared reports ({otherReports.length - 1})</summary>{otherReports.slice(1).map(publicReport)}</details>}
    </div>

    {!uid && <div className="finder-passcode-sign-in"><p>Sign in to save your own code or confirm successful use of a shared code.</p><button type="button" className="finder-secondary-button" disabled={accountLoading || authBusy} onClick={onSignIn}>{accountLoading || authBusy ? "Connecting account…" : "Sign in with Google"}<ArrowUpRight size={16} aria-hidden="true" /></button></div>}
    {(ownError || publicError) && onRetry && <button type="button" className="finder-secondary-button" disabled={isBusy} onClick={onRetry}>Retry loading codes</button>}
    {(actionError || state.error || authError) && <p className="finder-form-error" role="alert">{actionError || state.error || authError}</p>}
    {state.message && <p className="finder-passcode-success" role="status"><Check size={15} aria-hidden="true" />{state.message}</p>}
  </section>;
}
