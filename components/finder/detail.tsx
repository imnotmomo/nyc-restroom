"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Bookmark, Building2, Check, DoorOpen, Footprints, Info, MapPin, Plus, Trash2, X } from "lucide-react";
import { datasetSource, fact, formatDistance, sourceDateLabel, walkingDirections, type Coordinates, type Restroom } from "@/lib/restrooms";
import type { VisitNote, VisitNoteInput } from "@/lib/user-data";

function FactRow({ label, value, unknown = false }: { label: string; value: string; unknown?: boolean }) {
  return <div className={`finder-fact${unknown ? " is-unknown" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

function submissionDate(value: string): string {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const entryLabels = { public: "Public entry reported", customers: "Customers only reported", unknown: "Not reported" };
const routeLabels = { yes: "Yes — visitor reported", no: "No — visitor reported", unknown: "Not reported" };

export function RestroomDetail({ restroom, distance, originLabel, userLocation, saved, saving, onToggleFavorite, onClose, ratingContent, personalContent, feedback, onRetryLibrary }: {
  restroom: Restroom;
  distance: number;
  originLabel: string;
  userLocation: Coordinates | null;
  saved: boolean;
  saving: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
  ratingContent: ReactNode;
  personalContent: ReactNode;
  feedback: string | null;
  onRetryLibrary?: () => void;
}) {
  const community = restroom.communitySource;
  return <aside className="finder-detail" aria-labelledby="finder-detail-title" id="restroom-details" tabIndex={-1}>
    <header className="finder-detail-heading">
      <button type="button" className="finder-icon-button finder-close" onClick={onClose} aria-label="Close location details"><ArrowLeft size={18} className="finder-close-back-icon" /><span className="finder-close-text">Back to results</span><X size={20} className="finder-close-x-icon" /></button>
      <span className="finder-overline">Location details</span>
      <h2 id="finder-detail-title">{restroom.name}</h2>
      <p><MapPin size={15} />{restroom.locationType ?? "City-listed location"} <span>·</span> {formatDistance(distance)} straight-line from {originLabel}</p>
      <div className="finder-detail-actions">
        <a className="finder-primary-button" href={walkingDirections(restroom, userLocation ?? undefined)} target="_blank" rel="noreferrer">Walking directions <ArrowUpRight size={18} /></a>
        <button className={`finder-save-button${saved ? " is-saved" : ""}`} type="button" onClick={onToggleFavorite} disabled={saving} aria-pressed={saved} aria-label={saved ? "Remove saved restroom" : "Save restroom"}><Bookmark size={20} fill={saved ? "currentColor" : "none"} />{saving ? "Saving…" : saved ? "Saved" : "Save"}</button>
      </div>
      <p className="finder-directions-note">Directions open Google Maps. Check venue rules before going.</p>
      {feedback && <p className="finder-detail-feedback" role="alert">{feedback}</p>}
      {onRetryLibrary && <button className="finder-secondary-button" type="button" onClick={onRetryLibrary}>Retry loading saved places & notes</button>}
    </header>

    <div className="finder-source-note"><Info size={17} />{community
      ? <p><strong>Visitor-submitted location.</strong> Submitted {submissionDate(community.submittedAt)}. {community.observedOn ? `Observed on ${community.observedOn}.` : "Observation date not reported."} These are visitor reports; the team has not inspected this restroom.</p>
      : <p><strong>City data, dated {sourceDateLabel}.</strong> These are published details, not a live availability check or a team inspection.</p>}</div>

    <section className="finder-detail-section">
      <h3><DoorOpen size={19} />Entry</h3>
      <dl>
        {community && <FactRow label="Entry permission — visitor report" value={entryLabels[community.entryRule]} unknown={community.entryRule === "unknown"} />}
        <FactRow label="Purchase required" value={restroom.purchaseRequired === null ? "Not reported" : restroom.purchaseRequired ? "Yes" : "No"} unknown={restroom.purchaseRequired === null} />
        {restroom.address && <FactRow label="Address" value={restroom.address} />}
        <FactRow label="Published hours" value={fact(restroom.hours)} unknown={!restroom.hours} />
        <FactRow label="Seasonality" value={fact(restroom.seasonality)} unknown={!restroom.seasonality} />
        <FactRow label="Published status" value={fact(restroom.publishedStatus)} unknown={!restroom.publishedStatus} />
        <FactRow label="Access notes" value={fact(restroom.accessNotes)} unknown={!restroom.accessNotes} />
      </dl>
      <p className="finder-field-note">{community ? "Entry permission is a visitor report. Hours and availability have not been confirmed." : "Hours and status come from the dated source. They do not confirm the restroom is open now."}</p>
    </section>

    <section className="finder-detail-section">
      <h3><Footprints size={19} />Route inside</h3>
      <dl>
        <FactRow label="Restroom floor" value={fact(restroom.restroomFloor)} unknown={!restroom.restroomFloor} />
        <FactRow label="Stairs to restroom" value={fact(restroom.stairsToRestroom)} unknown={!restroom.stairsToRestroom} />
        {community ? <FactRow label="Step-free route from street to restroom" value={routeLabels[community.stepFreeAccess]} unknown={community.stepFreeAccess === "unknown"} />
          : <FactRow label="Facility access — city label" value={fact(restroom.facilityAccessibility)} unknown={!restroom.facilityAccessibility} />}
      </dl>
      <p className="finder-field-note">{community ? "A step-free-route report does not confirm doorway widths, stall space, grab bars, or other accessibility features." : "The city’s facility label does not establish the route to this restroom or the features of its stalls."}</p>
    </section>

    <section className="finder-detail-section">
      <h3><Building2 size={19} />Restroom & conditions</h3>
      <dl>
        <FactRow label="Restroom type" value={fact(restroom.restroomType)} unknown={!restroom.restroomType} />
        <FactRow label={community ? "Changing stations" : "Changing stations — city label"} value={fact(restroom.changingStations)} unknown={!restroom.changingStations} />
        <FactRow label="Conditions" value={fact(restroom.cleanliness)} unknown={!restroom.cleanliness} />
        <FactRow label="Observation date" value={fact(restroom.observationDate)} unknown={!restroom.observationDate} />
      </dl>
      <p className="finder-field-note">Soap, toilet paper, and stall conditions have not been reported in {community ? "this submission" : "this source"}.</p>
    </section>

    <div className="finder-detail-section">{ratingContent}</div>
    <section className="finder-detail-section finder-personal-section">{personalContent}</section>

    <details className="finder-provenance">
      <summary>Source & record details</summary>
      {community ? <><p>Source: a signed-in visitor’s submission. The visitor’s account identity is private.</p>
        <p>Submitted {submissionDate(community.submittedAt)}. Observation date: {community.observedOn ?? "Not reported"}. Submission time is not an inspection date.</p>
        <p>Chosen coordinates: {restroom.latitude.toFixed(6)}, {restroom.longitude.toFixed(6)}. The address and pin are visitor reports.</p>
        <p>Submission record: {restroom.id}. Contact the project team to request a correction or removal.</p>
      </> : <><p>Publisher: {datasetSource.publisher}. Operator: {fact(restroom.operator)}.</p>
      <p>Source data updated {sourceDateLabel}. Retrieved {new Date(datasetSource.retrievedAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })}. Retrieval is not an inspection date.</p>
      <p>Source record{restroom.sourceRecordIds.length > 1 ? "s" : ""}: {restroom.sourceRecordIds.join(", ")}</p>
      <a href={restroom.sourceUrl ?? datasetSource.url} target="_blank" rel="noreferrer">View NYC Open Data source <ArrowUpRight size={15} /></a>
      </>}
      {restroom.website && /^https?:\/\//i.test(restroom.website) && <a href={restroom.website} target="_blank" rel="noreferrer">Visit venue website <ArrowUpRight size={15} /></a>}
    </details>
  </aside>;
}

type Answer = VisitNoteInput["soap"];
const answerLabels: Record<Answer, string> = { "not-reported": "Not reported", yes: "Yes", no: "No" };
const conditionLabels: Record<VisitNoteInput["condition"], string> = { "not-reported": "Not reported", usable: "Usable", "needs-attention": "Needs attention" };

function localDateInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function noteDate(date: Date): string {
  return date.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function PersonalNotes({ placeID, signedIn, configured, loading, saving, notes, onSignIn, onSave, onDelete }: {
  placeID: string;
  signedIn: boolean;
  configured: boolean;
  loading: boolean;
  saving: boolean;
  notes: VisitNote[];
  onSignIn: () => void;
  onSave: (input: VisitNoteInput) => Promise<boolean>;
  onDelete: (noteID: string) => Promise<boolean>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [observedAt, setObservedAt] = useState("");
  const [condition, setCondition] = useState<VisitNoteInput["condition"]>("not-reported");
  const [soap, setSoap] = useState<Answer>("not-reported");
  const [toiletPaper, setToiletPaper] = useState<Answer>("not-reported");
  const [stairs, setStairs] = useState<Answer>("not-reported");
  const [entryNote, setEntryNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSuccess(false);
    const visited = new Date(observedAt);
    if (!Number.isFinite(visited.getTime()) || visited.getTime() < Date.UTC(2000, 0, 1) || visited.getTime() > Date.now()) {
      setFormError("Choose the actual time you visited, between January 1, 2000 and now.");
      return;
    }
    if (await onSave({ placeID, observedAt: visited, condition, soap, toiletPaper, stairs, entryNote: entryNote.trim() })) {
      setSuccess(true);
      setShowForm(false);
      setObservedAt("");
      setCondition("not-reported"); setSoap("not-reported"); setToiletPaper("not-reported"); setStairs("not-reported"); setEntryNote("");
    }
  }

  return <>
    <h3><Bookmark size={19} />My notes <span className="finder-private-label">Private</span></h3>
    <p className="finder-personal-explanation">Your own dated observations, saved to your account. These stay separate from city data and are not public reviews.</p>
    {!signedIn ? <><button type="button" className="finder-secondary-button" disabled={loading || !configured} onClick={onSignIn}>Sign in with Google to save notes <ArrowUpRight size={16} /></button>{!configured && <p className="finder-field-note">Account sign-in is not connected yet. Browsing and directions work without it.</p>}</> : <>
      {success && <p className="finder-note-success" role="status"><Check size={16} />Note saved to your account.</p>}
      {loading ? <p className="finder-field-note" role="status">Loading your private notes…</p> : <>
        {notes.length === 0 && !showForm && <p className="finder-field-note">No personal notes for this location yet.</p>}
        {!showForm && <button className="finder-secondary-button" type="button" onClick={() => { setShowForm(true); setSuccess(false); }}><Plus size={17} />Add a visit note</button>}
        {showForm && <form className="finder-note-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="note-observed">When you visited <span>Your local time</span></label>
          <input type="datetime-local" id="note-observed" required value={observedAt} min="2000-01-01T00:00" max={localDateInput()} onChange={(event) => setObservedAt(event.target.value)} />
          <label htmlFor="note-condition">How was it?</label>
          <select id="note-condition" value={condition} onChange={(event) => setCondition(event.target.value as VisitNoteInput["condition"])}>{Object.entries(conditionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <div className="finder-note-answer-grid">{([ ["note-soap", "Soap available", soap, setSoap], ["note-paper", "Toilet paper available", toiletPaper, setToiletPaper], ["note-stairs", "Stairs to restroom", stairs, setStairs] ] as const).map(([id, label, value, setter]) => <div key={id}><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={(event) => setter(event.target.value as Answer)}>{Object.entries(answerLabels).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select></div>)}</div>
          <label htmlFor="note-entry">Entry & route notes <span>Optional</span></label>
          <textarea id="note-entry" rows={3} maxLength={1000} placeholder="What did you notice about getting in or reaching the restroom?" value={entryNote} onChange={(event) => setEntryNote(event.target.value)} />
          <p className="finder-field-note">Only record your own observation. Leave unknown details as “Not reported.”</p>
          {formError && <p className="finder-form-error" role="alert">{formError}</p>}
          <div className="finder-note-actions"><button type="submit" className="finder-primary-button" disabled={saving}>{saving ? "Saving note…" : "Save private note"}</button><button type="button" className="finder-secondary-button" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button></div>
        </form>}
        <div className="finder-personal-notes">{notes.slice().sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime()).map((note) => <article className="finder-personal-note" key={note.id}>
          <p className="finder-note-observed">Observed {noteDate(note.observedAt)}</p>
          <dl><div><dt>Condition</dt><dd>{conditionLabels[note.condition]}</dd></div><div><dt>Soap</dt><dd>{answerLabels[note.soap]}</dd></div><div><dt>Toilet paper</dt><dd>{answerLabels[note.toiletPaper]}</dd></div><div><dt>Stairs</dt><dd>{answerLabels[note.stairs]}</dd></div></dl>
          {note.entryNote && <p className="finder-note-text">{note.entryNote}</p>}
          <p className="finder-note-submitted">Submitted {note.submittedAt ? noteDate(note.submittedAt) : "Time not yet available"}</p>
          {confirmDelete === note.id ? <div className="finder-note-delete-confirm"><p>Delete this private note?</p><button type="button" disabled={saving} onClick={async () => { if (await onDelete(note.id)) setConfirmDelete(null); }}>Delete note</button><button type="button" disabled={saving} onClick={() => setConfirmDelete(null)}>Keep it</button></div> : <button className="finder-delete-note" type="button" disabled={saving} onClick={() => setConfirmDelete(note.id)}><Trash2 size={14} />Delete note</button>}
        </article>)}</div>
      </>}
    </>}
  </>;
}
