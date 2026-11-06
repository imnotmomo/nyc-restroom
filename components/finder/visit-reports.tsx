"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, ClipboardList, Plus, Trash2 } from "lucide-react";
import {
  createVisitReport, deleteVisitReport, newVisitReportID, readOwnVisitReportIDs, watchVisitReports, watchUnifiedVisitReports,
  type ReportAnswer, type UnifiedVisitReport, type VisitReport, type VisitReportInput,
} from "@/lib/visit-reports";
import { mergeVisitReportEvidence, type VisitReportEvidence } from "@/lib/visit-report-model";

const RECENT_LIMIT = 10;
type Draft = Omit<VisitReportInput, "observedAt"> & { observedAt: string };
type Attempt = { id: string; input: VisitReportInput };
type LocalState = {
  scope: string; showForm: boolean; draft: Draft; attempt: Attempt | null;
  pending: string | null; error: string | null; invalidField: "observedAt" | "facts" | null; message: string | null; confirmDelete: string | null;
  confirmed: VisitReport[]; removed: string[]; confirmedOwnIDs: string[];
};
const answers: ReadonlyArray<readonly [ReportAnswer, string]> = [["not-reported", "Not reported"], ["yes", "Yes"], ["no", "No"]];
const entryLabels = { "not-reported": "Not reported", public: "Public entry reported", customers: "Customers only reported" };
const answerLabels = { "not-reported": "Not reported", yes: "Yes — reported", no: "No — reported" };
const floorLabels = { "not-reported": "Not reported", entrance: "Entrance level", below: "Below entrance level", above: "Above entrance level" };
const conditionLabels = { "not-reported": "Not reported", usable: "Usable — reported", "needs-attention": "Needs attention — reported" };

function emptyDraft(): Draft {
  return { observedAt: "", entryRule: "not-reported", purchaseRequired: "not-reported", codeRequired: "not-reported",
    floor: "not-reported", stairs: "not-reported", soap: "not-reported", toiletPaper: "not-reported", condition: "not-reported" };
}
function initialState(scope: string): LocalState {
  return { scope, showForm: false, draft: emptyDraft(), attempt: null, pending: null, error: null, invalidField: null,
    message: null, confirmDelete: null, confirmed: [], removed: [], confirmedOwnIDs: [] };
}
function localDateLimit(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function ReportTime({ value }: { value: Date | null }) {
  if (!value || !Number.isFinite(value.getTime())) return <>Not reported</>;
  return <time dateTime={value.toISOString()}>{new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
  }).format(value)}</time>;
}
function ReportFact({ label, value }: { label: string; value: string }) {
  return <div className={value === "Not reported" ? "is-unknown" : undefined}><dt>{label}</dt><dd>{value}</dd></div>;
}

export function VisitReportObservation({ entry, open, own, confirmingDelete, removing, busy, error, onDelete, onConfirmDelete, onKeep }: {
  entry: VisitReportEvidence; open: boolean; own: boolean; confirmingDelete: boolean; removing: boolean; busy: boolean; error: string | null;
  onDelete: (id: string) => void; onConfirmDelete: (id: string) => void; onKeep: () => void;
}) {
  const report = entry.report;
  const amenities = entry.source === "unified" ? report as UnifiedVisitReport : undefined;
  const canRemove = entry.source === "legacy" && own;
  return <details className="finder-visit-card" open={open}>
    <summary><strong>Observed <ReportTime value={report.observedAt} /></strong><span>Submitted <ReportTime value={report.submittedAt} /></span><span>{entry.authorName ?? "Anonymous"}{canRemove ? " · Your report" : ""} · Show details</span></summary>
    <div className="finder-visit-card-body">{entry.comment && <p className="finder-note-text">{entry.comment}</p>}<h4>Entry</h4><dl><ReportFact label="Entry permission" value={entryLabels[report.entryRule]} /><ReportFact label="Purchase required" value={answerLabels[report.purchaseRequired]} /><ReportFact label="Code required" value={answerLabels[report.codeRequired]} /></dl>
      <h4>Route inside</h4><dl><ReportFact label="Restroom floor" value={floorLabels[report.floor]} /><ReportFact label="Stairs after entry" value={answerLabels[report.stairs]} />
        {amenities?.elevatorPresent && amenities.elevatorPresent !== "not-reported" && <ReportFact label="Elevator present" value={answerLabels[amenities.elevatorPresent]} />}
        {amenities?.automaticDoorPresent && amenities.automaticDoorPresent !== "not-reported" && <ReportFact label="Automatic door present" value={answerLabels[amenities.automaticDoorPresent]} />}
      </dl>
      <h4>Supplies & conditions</h4><dl><ReportFact label="Soap present" value={answerLabels[report.soap]} /><ReportFact label="Toilet paper present" value={answerLabels[report.toiletPaper]} /><ReportFact label="Condition" value={conditionLabels[report.condition]} /></dl>
      <p className="finder-field-note">This visitor report applies to the observation time above. It does not certify accessibility or confirm conditions now.</p>
      {canRemove && (confirmingDelete ? <div className="finder-visit-delete-confirm"><p>Remove your public visit report?</p>{error && <p className="finder-form-error" role="alert">{error}</p>}<div className="finder-visit-actions"><button type="button" className="finder-secondary-button" disabled={busy} onClick={() => onDelete(report.id)}>{removing ? "Removing…" : "Remove report"}</button><button type="button" className="finder-secondary-button" disabled={busy} onClick={onKeep}>Keep report</button></div></div> : <button type="button" className="finder-visit-delete" disabled={busy} onClick={() => onConfirmDelete(report.id)}><Trash2 size={15} />Remove my report</button>)}
    </div>
  </details>;
}

export function VisitReports({ placeID, uid, accountLoading, configured, authError, onSignIn }: {
  placeID: string; uid: string | null; accountLoading: boolean; configured: boolean; authError: string | null; onSignIn: () => void;
}) {
  const id = useId();
  const scope = `${uid ?? "signed-out"}:${placeID}`;
  const context = useRef({ scope });
  if (context.current.scope !== scope) context.current = { scope };
  const mounted = useRef(true);
  const inFlight = useRef<object | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const shareButton = useRef<HTMLButtonElement | null>(null);
  const [stored, setStored] = useState(() => initialState(scope));
  const state = stored.scope === scope ? stored : initialState(scope);
  const [feed, setFeed] = useState<{ scope: string; reports: VisitReport[]; loading: boolean; error: string | null }>({ scope, reports: [], loading: true, error: null });
  const [unifiedFeed, setUnifiedFeed] = useState<{ scope: string; reports: UnifiedVisitReport[]; loading: boolean; error: string | null }>({ scope, reports: [], loading: true, error: null });
  const [own, setOwn] = useState<{ scope: string; ids: string[]; loading: boolean; error: string | null }>({ scope, ids: [], loading: Boolean(uid), error: null });
  const [retry, setRetry] = useState(0);
  const publicIDs = useRef({ scope, ids: new Set<string>() });
  const publicReports = feed.scope === scope ? feed.reports : [];
  const publicLoading = feed.scope !== scope || feed.loading || unifiedFeed.scope !== scope || unifiedFeed.loading;
  const publicError = [feed.scope === scope ? feed.error : null, unifiedFeed.scope === scope ? unifiedFeed.error : null].filter(Boolean).join(" ") || null;
  const legacyReports = useMemo(() => {
    const records = new Map(publicReports.map((report) => [report.id, report]));
    for (const report of state.confirmed) records.set(report.id, report);
    return [...records.values()].filter((report) => !state.removed.includes(report.id))
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()).slice(0, RECENT_LIMIT);
  }, [publicReports, state.confirmed, state.removed]);
  const unifiedReports = unifiedFeed.scope === scope ? unifiedFeed.reports : [];
  const reports = useMemo(() => mergeVisitReportEvidence(placeID, legacyReports, unifiedReports), [placeID, legacyReports, unifiedReports]);
  // Unified records never inherit a same-ID legacy ownership receipt or removal control.
  const visibleIDsKey = legacyReports.map((report) => report.id).join(",");
  const ownIDs = new Set([...(own.scope === scope ? own.ids : []), ...state.confirmedOwnIDs]);
  const busy = state.pending !== null;
  const formLocked = busy || Boolean(state.attempt) || accountLoading || !uid;

  function update(patch: Partial<LocalState>) {
    setStored((previous) => ({ ...(previous.scope === scope ? previous : initialState(scope)), ...patch }));
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; inFlight.current = null; };
  }, []);
  useEffect(() => {
    inFlight.current = null;
    setStored(initialState(scope));
  }, [scope]);

  useEffect(() => {
    let active = true;
    const current = context.current;
    publicIDs.current = { scope, ids: new Set() };
    setFeed({ scope, reports: [], loading: true, error: null });
    const unsubscribe = watchVisitReports(placeID, (records) => {
      if (active && current === context.current) {
        publicIDs.current = { scope, ids: new Set(records.map((report) => report.id)) };
        setFeed({ scope, reports: records, loading: false, error: null });
        setStored((previous) => previous.scope !== scope ? previous : {
          ...previous, confirmed: previous.confirmed.filter((report) => !publicIDs.current.ids.has(report.id)),
        });
      }
    }, (error) => {
      if (active && current === context.current) setFeed((previous) => ({ scope, reports: previous.scope === scope ? previous.reports : [], loading: false, error: error.message }));
    });
    return () => { active = false; unsubscribe(); };
  }, [placeID, scope, retry]);

  useEffect(() => {
    let active = true;
    const current = context.current;
    setUnifiedFeed({ scope, reports: [], loading: true, error: null });
    const unsubscribe = watchUnifiedVisitReports(placeID, records => {
      if (active && current === context.current) setUnifiedFeed({ scope, reports: records, loading: false, error: null });
    }, error => {
      if (active && current === context.current) setUnifiedFeed(previous => ({ scope, reports: previous.scope === scope ? previous.reports : [], loading: false, error: error.message }));
    });
    return () => { active = false; unsubscribe(); };
  }, [placeID, scope, retry]);

  useEffect(() => {
    let active = true;
    const current = context.current;
    setOwn({ scope, ids: [], loading: Boolean(uid && visibleIDsKey), error: null });
    if (!uid || !visibleIDsKey) return () => { active = false; };
    readOwnVisitReportIDs(uid, placeID, visibleIDsKey.split(",")).then((ids) => {
      if (active && current === context.current) setOwn({ scope, ids, loading: false, error: null });
    }).catch((error: unknown) => {
      if (active && current === context.current) setOwn({ scope, ids: [], loading: false, error: error instanceof Error ? error.message : "Your report controls could not load. Retry before removing a report." });
    });
    return () => { active = false; };
  }, [uid, placeID, scope, visibleIDsKey, retry]);

  useEffect(() => {
    if (!state.showForm) return;
    const frame = requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(state.attempt ? 'button[type="submit"]' : "input")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [state.showForm]);

  function change<Field extends keyof Draft>(field: Field, value: Draft[Field]) {
    if (!formLocked) update({ draft: { ...state.draft, [field]: value }, error: null, invalidField: null, message: null });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uid || accountLoading || busy || inFlight.current) return;
    const observedAt = new Date(state.draft.observedAt);
    if (!state.attempt && (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() < Date.UTC(2000, 0, 1) || observedAt.getTime() > Date.now())) {
      update({ error: "Choose the actual time you visited, between January 1, 2000 and now.", invalidField: "observedAt" });
      form.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    if (!state.attempt && !Object.entries(state.draft).some(([field, value]) => field !== "observedAt" && value !== "not-reported")) {
      update({ error: "Report at least one detail you actually observed. Leave everything else as Not reported.", invalidField: "facts" });
      form.current?.querySelector<HTMLSelectElement>("select")?.focus();
      return;
    }
    const current = context.current;
    const operation = {};
    const isCurrent = () => mounted.current && context.current === current && inFlight.current === operation;
    inFlight.current = operation;
    update({ pending: "create", error: null, invalidField: null, confirmDelete: null, message: null });
    try {
      const attempt = state.attempt ?? { id: newVisitReportID(), input: { ...state.draft, observedAt } };
      update({ attempt });
      const report = await createVisitReport(uid, placeID, attempt.id, attempt.input);
      if (!isCurrent()) return;
      setStored((previous) => previous.scope !== scope ? previous : {
        ...previous, pending: null, attempt: null, draft: emptyDraft(), showForm: false,
        confirmed: publicIDs.current.scope === scope && publicIDs.current.ids.has(report.id)
          ? previous.confirmed.filter((item) => item.id !== report.id)
          : [...previous.confirmed.filter((item) => item.id !== report.id), report],
        confirmedOwnIDs: [...new Set([...previous.confirmedOwnIDs, report.id])],
        message: "Your visit report is public. Reports are ordered by observation time; older visits may fall outside the latest 10.", error: null, invalidField: null,
      });
      requestAnimationFrame(() => shareButton.current?.focus({ preventScroll: true }));
    } catch (error) {
      if (isCurrent()) update({ error: error instanceof Error ? error.message : "Your report could not be confirmed. Retry the same report when your connection is ready." });
    } finally {
      if (isCurrent()) { inFlight.current = null; update({ pending: null }); }
    }
  }

  async function remove(reportID: string) {
    if (!uid || accountLoading || busy || inFlight.current || !ownIDs.has(reportID)) return;
    const current = context.current;
    const operation = {};
    const isCurrent = () => mounted.current && context.current === current && inFlight.current === operation;
    inFlight.current = operation;
    update({ pending: `delete:${reportID}`, error: null, invalidField: null, message: null });
    try {
      await deleteVisitReport(uid, placeID, reportID);
      if (!isCurrent()) return;
      setStored((previous) => previous.scope !== scope ? previous : {
        ...previous, removed: [...previous.removed, reportID], confirmed: previous.confirmed.filter((report) => report.id !== reportID),
        confirmedOwnIDs: previous.confirmedOwnIDs.filter((id) => id !== reportID), confirmDelete: null, message: "Your public report was removed.",
        ...(previous.attempt?.id === reportID ? { attempt: null, draft: emptyDraft(), showForm: false } : {}),
      });
      requestAnimationFrame(() => shareButton.current?.focus({ preventScroll: true }));
    } catch (error) {
      if (isCurrent()) update({ error: error instanceof Error ? error.message : "Removal could not be confirmed. Retry removing the same report." });
    } finally {
      if (isCurrent()) { inFlight.current = null; update({ pending: null }); }
    }
  }

  function answerField(field: "purchaseRequired" | "codeRequired" | "stairs" | "soap" | "toiletPaper", label: string) {
    return <div className="finder-visit-field"><label htmlFor={`${id}-${field}`}>{label}</label><select id={`${id}-${field}`} value={state.draft[field]} onChange={(event) => change(field, event.target.value as ReportAnswer)}>{answers.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>;
  }

  return <section className="finder-visit-reports" aria-labelledby={`${id}-heading`}>
    <div className="finder-visit-heading"><h3 id={`${id}-heading`}><ClipboardList size={19} />Visitor reports</h3>
      {uid && <button type="button" className="finder-secondary-button" ref={shareButton} disabled={accountLoading || busy} onClick={() => update({ showForm: !state.showForm })}><Plus size={16} />{state.showForm ? "Hide form" : state.attempt ? "Resume report" : "Share a visit"}</button>}</div>
    <p className="finder-field-note">Dated observations, separate from the original listing below. Compare sources and disagreements; earlier reports do not guarantee current access or conditions.</p>
    {!uid && <button type="button" className="finder-secondary-button" disabled={accountLoading || !configured} onClick={onSignIn}>{accountLoading ? "Checking account…" : "Sign in with Google to share a visit"}</button>}
    {!configured && <p className="finder-field-note">Sharing is not connected in this build. You can still read the original listing.</p>}
    {authError && <p className="finder-form-error" role="alert">{authError}</p>}
    {state.message && <p className="finder-note-success" role="status"><Check size={16} />{state.message}</p>}
    {state.error && !state.invalidField && !state.confirmDelete && <p className="finder-form-error" role="alert">{state.error}</p>}

    {uid && state.showForm && <form ref={form} className="finder-visit-form" onSubmit={(event) => void submit(event)} noValidate>
      <p className="finder-visit-public" id={`${id}-public`}>The answers and visit time you submit will be public. Your account identity stays private. Only report your own visit; leave unknown details as Not reported.</p>
      {state.attempt && <p className="finder-visit-retry" role="status">This exact draft is kept while its save is unconfirmed. Retry checks the same report. Hiding the form keeps your draft.</p>}
      <fieldset disabled={formLocked}><legend className="finder-sr-only">Your observed restroom details</legend>
        <div className="finder-visit-field"><label htmlFor={`${id}-observed`}>When you visited <span>Required · Your local time</span></label><input id={`${id}-observed`} type="datetime-local" min="2000-01-01T00:00" max={localDateLimit()} required value={state.draft.observedAt} aria-invalid={state.invalidField === "observedAt"} aria-describedby={state.invalidField === "observedAt" ? `${id}-observed-error` : undefined} onChange={(event) => change("observedAt", event.target.value)} />{state.invalidField === "observedAt" && <p className="finder-form-error" id={`${id}-observed-error`} role="alert">{state.error}</p>}</div>
        <h4>Entry</h4>
        <div className="finder-visit-field"><label htmlFor={`${id}-entry`}>Entry permission</label><select id={`${id}-entry`} value={state.draft.entryRule} aria-invalid={state.invalidField === "facts"} aria-describedby={state.invalidField === "facts" ? `${id}-facts-error` : undefined} onChange={(event) => change("entryRule", event.target.value as Draft["entryRule"])}><option value="not-reported">Not reported</option><option value="public">Public entry</option><option value="customers">Customers only</option></select>{state.invalidField === "facts" && <p className="finder-form-error" id={`${id}-facts-error`} role="alert">{state.error}</p>}</div>
        <div className="finder-visit-field-grid">{answerField("purchaseRequired", "Purchase required")}{answerField("codeRequired", "Code required")}</div>
        <p className="finder-field-note">A code requirement is separate from permission to enter. Code values belong in the separate Passcodes section.</p>
        <h4>Route inside</h4>
        <div className="finder-visit-field"><label htmlFor={`${id}-floor`}>Restroom floor</label><select id={`${id}-floor`} value={state.draft.floor} onChange={(event) => change("floor", event.target.value as Draft["floor"])}>{Object.entries(floorLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
        {answerField("stairs", "Stairs after entry")}
        <p className="finder-field-note">Describe the route to the restroom. No stairs does not establish doorway widths, stall features or wheelchair suitability.</p>
        <h4>Supplies & conditions</h4>
        <div className="finder-visit-field-grid">{answerField("soap", "Soap present")}{answerField("toiletPaper", "Toilet paper present")}</div>
        <div className="finder-visit-field"><label htmlFor={`${id}-condition`}>Condition you observed</label><select id={`${id}-condition`} value={state.draft.condition} onChange={(event) => change("condition", event.target.value as Draft["condition"])}>{Object.entries(conditionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
      </fieldset>
      <div className="finder-visit-actions"><button type="submit" className="finder-primary-button" disabled={busy || accountLoading} aria-describedby={`${id}-public`}>{state.pending === "create" ? "Confirming report…" : state.attempt ? "Retry public report" : "Publish visit report"}</button><button type="button" className="finder-secondary-button" disabled={busy} onClick={() => { update({ showForm: false }); requestAnimationFrame(() => shareButton.current?.focus({ preventScroll: true })); }}>Hide form</button></div>
    </form>}

    {publicLoading && <p className="finder-field-note" role="status">Loading recent visitor reports… The original listing is available below.</p>}
    {publicError && <div className="finder-visit-error"><p className="finder-form-error" role="alert">{publicError}</p><button type="button" className="finder-secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry reports</button></div>}
    {!publicLoading && !publicError && reports.length === 0 && <p className="finder-visit-empty">No public visit reports yet. The original listing below keeps its own source and unknowns. Share what you actually observed to help the next visitor.</p>}
    {own.scope === scope && own.error && <div className="finder-visit-error"><p className="finder-form-error" role="alert">{own.error}</p><button type="button" className="finder-secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry my report controls</button></div>}
    {reports.length > 0 && <div className="finder-visit-list"><p className="finder-field-note">Recent observations · All times shown in New York time</p>{reports.map((entry, index) => <VisitReportObservation key={entry.key} entry={entry} open={index === 0}
      own={Boolean(uid && ownIDs.has(entry.report.id))} confirmingDelete={state.confirmDelete === entry.report.id} removing={state.pending === `delete:${entry.report.id}`} busy={busy || accountLoading} error={state.error}
      onDelete={reportID => void remove(reportID)} onConfirmDelete={reportID => update({ confirmDelete: reportID, error: null, invalidField: null })} onKeep={() => update({ confirmDelete: null, error: null })} />)}</div>}
  </section>;
}
