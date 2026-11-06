"use client";

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, MessageSquareText, Plus, Trash2 } from "lucide-react";
import {
  createPublicNote, deletePublicNote, newPublicNoteID, readOwnPublicNoteIDs, watchPublicNotes,
  type PublicNote, type PublicNoteAnswer, type PublicNoteInput,
} from "@/lib/public-notes";
import { normalizePublicNoteInput } from "@/lib/public-note-model";

type Draft = Omit<PublicNoteInput, "observedAt"> & { observedAt: string };
type Attempt = { id: string; input: PublicNoteInput };
type LocalState = {
  scope: string; showForm: boolean; draft: Draft; attempt: Attempt | null; pending: string | null;
  error: string | null; message: string | null; confirmDelete: string | null;
  confirmed: PublicNote[]; removed: string[]; confirmedOwnIDs: string[];
};
const answerLabels = { "not-reported": "Not reported", yes: "Yes — reported", no: "No — reported" };
const conditionLabels = { "not-reported": "Not reported", usable: "Usable — reported", "needs-attention": "Needs attention — reported" };
function emptyDraft(): Draft {
  return { observedAt: "", body: "", condition: "not-reported", soap: "not-reported", toiletPaper: "not-reported", stairs: "not-reported" };
}
function initialState(scope: string): LocalState {
  return { scope, showForm: false, draft: emptyDraft(), attempt: null, pending: null, error: null, message: null,
    confirmDelete: null, confirmed: [], removed: [], confirmedOwnIDs: [] };
}
function localDateLimit(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function NoteTime({ value }: { value: Date }) {
  return <time dateTime={value.toISOString()}>{new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
  }).format(value)}</time>;
}

/** Public notes use their own schema; free text never enters Analytics or an AI model. */
export function PublicNotes({ placeID, uid, accountLoading, configured, authError, onSignIn }: {
  placeID: string; uid: string | null; accountLoading: boolean; configured: boolean; authError: string | null; onSignIn: () => void;
}) {
  const id = useId();
  const scope = JSON.stringify([uid, placeID]);
  const context = useRef({ scope });
  if (context.current.scope !== scope) context.current = { scope };
  const mounted = useRef(true);
  const inFlight = useRef<object | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const addButton = useRef<HTMLButtonElement | null>(null);
  const [stored, setStored] = useState(() => initialState(scope));
  const state = stored.scope === scope ? stored : initialState(scope);
  const [feed, setFeed] = useState<{ scope: string; notes: PublicNote[]; loading: boolean; error: string | null }>({ scope, notes: [], loading: true, error: null });
  const [own, setOwn] = useState<{ scope: string; ids: string[]; error: string | null }>({ scope, ids: [], error: null });
  const [retry, setRetry] = useState(0);
  const publicIDs = useRef({ scope, ids: new Set<string>() });
  const publicNotes = feed.scope === scope ? feed.notes : [];
  const publicLoading = feed.scope !== scope || feed.loading;
  const publicError = feed.scope === scope ? feed.error : null;
  const notes = useMemo(() => {
    const records = new Map(publicNotes.map((note) => [note.id, note]));
    for (const note of state.confirmed) records.set(note.id, note);
    return [...records.values()].filter((note) => !state.removed.includes(note.id))
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime()).slice(0, 10);
  }, [publicNotes, state.confirmed, state.removed]);
  const visibleIDsKey = notes.map((note) => note.id).join(",");
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
  useEffect(() => { inFlight.current = null; setStored(initialState(scope)); }, [scope]);
  useEffect(() => {
    let active = true;
    const current = context.current;
    publicIDs.current = { scope, ids: new Set() };
    setFeed({ scope, notes: [], loading: true, error: null });
    const unsubscribe = watchPublicNotes(placeID, (records) => {
      if (!active || current !== context.current) return;
      publicIDs.current = { scope, ids: new Set(records.map((note) => note.id)) };
      setFeed({ scope, notes: records, loading: false, error: null });
      setStored((previous) => previous.scope !== scope ? previous : {
        ...previous, confirmed: previous.confirmed.filter((note) => !publicIDs.current.ids.has(note.id)),
      });
    }, (error) => {
      if (active && current === context.current) setFeed((previous) => ({ scope, notes: previous.scope === scope ? previous.notes : [], loading: false, error: error.message }));
    });
    return () => { active = false; unsubscribe(); };
  }, [placeID, scope, retry]);
  useEffect(() => {
    let active = true;
    const current = context.current;
    setOwn({ scope, ids: [], error: null });
    if (!uid || !visibleIDsKey) return () => { active = false; };
    readOwnPublicNoteIDs(uid, placeID, visibleIDsKey.split(",")).then((ids) => {
      if (active && current === context.current) setOwn({ scope, ids, error: null });
    }).catch((error: unknown) => {
      if (active && current === context.current) setOwn({ scope, ids: [], error: error instanceof Error ? error.message : "Your note controls could not load. Retry before removing a note." });
    });
    return () => { active = false; };
  }, [uid, placeID, scope, visibleIDsKey, retry]);
  useEffect(() => {
    if (!state.showForm) return;
    const frame = requestAnimationFrame(() => form.current?.querySelector<HTMLElement>(state.attempt ? 'button[type="submit"]' : "input")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [state.showForm]);

  function change<Field extends keyof Draft>(field: Field, value: Draft[Field]) {
    if (!formLocked) update({ draft: { ...state.draft, [field]: value }, error: null, message: null });
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!uid || accountLoading || busy || inFlight.current) return;
    let input: PublicNoteInput;
    try { input = state.attempt?.input ?? normalizePublicNoteInput({ ...state.draft, observedAt: new Date(state.draft.observedAt) }); }
    catch (error) { update({ error: error instanceof Error ? error.message : "Check the note before publishing." }); return; }
    const current = context.current;
    const operation = {};
    const isCurrent = () => mounted.current && context.current === current && inFlight.current === operation;
    inFlight.current = operation;
    update({ pending: "create", error: null, confirmDelete: null, message: null });
    try {
      const attempt = state.attempt ?? { id: newPublicNoteID(), input };
      update({ attempt });
      const note = await createPublicNote(uid, placeID, attempt.id, attempt.input);
      if (!isCurrent()) return;
      setStored((previous) => previous.scope !== scope ? previous : {
        ...previous, pending: null, attempt: null, draft: emptyDraft(), showForm: false,
        confirmed: publicIDs.current.scope === scope && publicIDs.current.ids.has(note.id)
          ? previous.confirmed.filter((item) => item.id !== note.id)
          : [...previous.confirmed.filter((item) => item.id !== note.id), note],
        confirmedOwnIDs: [...new Set([...previous.confirmedOwnIDs, note.id])], message: "Your note is public and displayed as Anonymous.", error: null,
      });
      requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
    } catch (error) { if (isCurrent()) update({ error: error instanceof Error ? error.message : "The note could not be confirmed. Retry this same draft." }); }
    finally { if (isCurrent()) { inFlight.current = null; update({ pending: null }); } }
  }
  async function remove(noteID: string) {
    if (!uid || accountLoading || busy || inFlight.current || !ownIDs.has(noteID)) return;
    const current = context.current;
    const operation = {};
    const isCurrent = () => mounted.current && context.current === current && inFlight.current === operation;
    inFlight.current = operation;
    update({ pending: `delete:${noteID}`, error: null, message: null });
    try {
      await deletePublicNote(uid, placeID, noteID);
      if (!isCurrent()) return;
      setStored((previous) => previous.scope !== scope ? previous : {
        ...previous, removed: [...previous.removed, noteID], confirmed: previous.confirmed.filter((note) => note.id !== noteID),
        confirmedOwnIDs: previous.confirmedOwnIDs.filter((id) => id !== noteID), confirmDelete: null, message: "Your public note was removed.",
      });
      requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true }));
    } catch (error) { if (isCurrent()) update({ error: error instanceof Error ? error.message : "Removal could not be confirmed. Retry removing the same note." }); }
    finally { if (isCurrent()) { inFlight.current = null; update({ pending: null }); } }
  }
  function answerField(field: "soap" | "toiletPaper" | "stairs", label: string) {
    return <div className="finder-visit-field"><label htmlFor={`${id}-${field}`}>{label}</label><select id={`${id}-${field}`} value={state.draft[field]} onChange={(event) => change(field, event.target.value as PublicNoteAnswer)}>{Object.entries(answerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>;
  }

  return <section className="finder-visit-reports" aria-labelledby={`${id}-heading`}>
    <div className="finder-visit-heading"><h3 id={`${id}-heading`}><MessageSquareText size={19} />Visit notes</h3>
      {uid && <button type="button" className="finder-secondary-button" ref={addButton} disabled={accountLoading || busy} onClick={() => update({ showForm: !state.showForm })}><Plus size={16} />{state.showForm ? "Hide form" : state.attempt ? "Resume note" : "Add a visit note"}</button>}</div>
    <p className="finder-field-note">Public notes are displayed as Anonymous. Anyone can read them.</p>
    {!uid && <button type="button" className="finder-secondary-button" disabled={accountLoading || !configured} onClick={onSignIn}>{accountLoading ? "Checking account…" : "Sign in with Google to add a note"}</button>}
    {!configured && <p className="finder-field-note">Publishing is not connected in this build.</p>}
    {authError && <p className="finder-form-error" role="alert">{authError}</p>}
    {state.message && <p className="finder-note-success" role="status"><Check size={16} />{state.message}</p>}
    {state.error && !state.confirmDelete && <p className="finder-form-error" role="alert">{state.error}</p>}
    {uid && state.showForm && <form ref={form} className="finder-visit-form" onSubmit={(event) => void submit(event)} noValidate>
      <p className="finder-visit-public" id={`${id}-public`}>Your note and observed details will be public under Anonymous. Keep personal information and passcodes out of the note.</p>
      {state.attempt && <p className="finder-visit-retry" role="status">This exact draft is kept while its save is unconfirmed. Retry checks the same note.</p>}
      <fieldset disabled={formLocked}><legend className="finder-sr-only">Your public visit note</legend>
        <div className="finder-visit-field"><label htmlFor={`${id}-observed`}>When you visited <span>Required · Your local time</span></label><input id={`${id}-observed`} type="datetime-local" min="2000-01-01T00:00" max={localDateLimit()} required value={state.draft.observedAt} onChange={(event) => change("observedAt", event.target.value)} /></div>
        <div className="finder-visit-field"><label htmlFor={`${id}-body`}>Visit note <span>Up to 1,000 characters</span></label><textarea id={`${id}-body`} rows={3} maxLength={1000} value={state.draft.body} onChange={(event) => change("body", event.target.value)} /></div>
        <div className="finder-visit-field"><label htmlFor={`${id}-condition`}>Condition you observed</label><select id={`${id}-condition`} value={state.draft.condition} onChange={(event) => change("condition", event.target.value as Draft["condition"])}>{Object.entries(conditionLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
        <div className="finder-visit-field-grid">{answerField("soap", "Soap present")}{answerField("toiletPaper", "Toilet paper present")}</div>
        {answerField("stairs", "Stairs after entry")}
      </fieldset>
      <div className="finder-visit-actions"><button type="submit" className="finder-primary-button" disabled={busy || accountLoading} aria-describedby={`${id}-public`}>{state.pending === "create" ? "Confirming note…" : state.attempt ? "Retry public note" : "Publish note"}</button><button type="button" className="finder-secondary-button" disabled={busy} onClick={() => { update({ showForm: false }); requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true })); }}>Hide form</button></div>
    </form>}
    {publicLoading && <p className="finder-field-note" role="status">Loading public visit notes…</p>}
    {publicError && <div className="finder-visit-error"><p className="finder-form-error" role="alert">{publicError}</p><button type="button" className="finder-secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry notes</button></div>}
    {!publicLoading && !publicError && notes.length === 0 && <p className="finder-visit-empty">No public visit notes yet.</p>}
    {own.scope === scope && own.error && <div className="finder-visit-error"><p className="finder-form-error" role="alert">{own.error}</p><button type="button" className="finder-secondary-button" onClick={() => setRetry((value) => value + 1)}>Retry my note controls</button></div>}
    {notes.length > 0 && <div className="finder-visit-list"><p className="finder-field-note">Up to 10 recently posted notes · Times shown in New York time</p>{notes.map((note) => <article className="finder-visit-card" key={note.id}>
      <div className="finder-visit-card-body"><h4>Anonymous{ownIDs.has(note.id) ? " · Your note" : ""}</h4>
        <p className="finder-note-observed">Observed <NoteTime value={note.observedAt} /></p>
        {note.body && <p className="finder-note-text">{note.body}</p>}
        <dl>{note.condition !== "not-reported" && <div><dt>Condition</dt><dd>{conditionLabels[note.condition]}</dd></div>}{([ ["Soap", note.soap], ["Toilet paper", note.toiletPaper], ["Stairs after entry", note.stairs] ] as const).filter(([, value]) => value !== "not-reported").map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{answerLabels[value]}</dd></div>)}</dl>
        <p className="finder-field-note">Posted <NoteTime value={note.submittedAt} /></p>
        {uid && ownIDs.has(note.id) && (state.confirmDelete === note.id ? <div className="finder-visit-delete-confirm"><p>Remove your public note?</p>{state.error && <p className="finder-form-error" role="alert">{state.error}</p>}<div className="finder-visit-actions"><button type="button" className="finder-secondary-button" disabled={busy || accountLoading} onClick={() => void remove(note.id)}>{state.pending === `delete:${note.id}` ? "Removing…" : "Remove note"}</button><button type="button" className="finder-secondary-button" disabled={busy} onClick={() => update({ confirmDelete: null, error: null })}>Keep note</button></div></div> : <button type="button" className="finder-visit-delete" disabled={busy || accountLoading} onClick={() => update({ confirmDelete: note.id, error: null })}><Trash2 size={15} />Remove my note</button>)}
      </div>
    </article>)}</div>}
  </section>;
}
