"use client";

import { useRef, useState } from "react";
import { ArrowLeft, Bookmark, Check, DoorOpen, Footprints, Globe2, Info, KeyRound, LockKeyhole, MapPin, Pencil, Star, Trash2, X } from "lucide-react";
import { DEMO_ADDRESS_SOURCE, demoRating, visibleDemoCodes, type DemoCodeView, type DemoVenue, type DemoVisibility } from "@/lib/demo-state";
import { StarRatingSlider } from "@/components/star-rating-slider";

function DemoTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value))} NY time</time>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className={`finder-fact${value === "Not reported" ? " is-unknown" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

function DemoPasscodes({ venue, onCode, onVerify }: { venue: DemoVenue; onCode: (code: string, visibility: DemoVisibility) => boolean; onVerify: (reportID: string) => void }) {
  const [view, setView] = useState<DemoCodeView>("owner");
  const currentView = useRef<DemoCodeView>("owner");
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(venue.ownCode?.code ?? "");
  const [visibility, setVisibility] = useState<DemoVisibility>(venue.ownCode?.visibility ?? "private");
  const [error, setError] = useState<string | null>(null);
  const reports = visibleDemoCodes(venue, view);

  function changeView(next: DemoCodeView) {
    currentView.current = next;
    setView(next); setEditing(false); setError(null);
    setCode(venue.ownCode?.code ?? ""); setVisibility(venue.ownCode?.visibility ?? "private");
  }
  function editOwn() {
    if (currentView.current !== "owner") return;
    setCode(venue.ownCode?.code ?? ""); setVisibility(venue.ownCode?.visibility ?? "private"); setError(null); setEditing(true);
  }
  const editor = <form className="finder-passcode-form" onSubmit={(event) => {
    event.preventDefault();
    if (currentView.current !== "owner") return;
    if (onCode(code, visibility)) setEditing(false);
    else setError("Use 1–40 standard letters, numbers, or symbols.");
  }}>
    <div className="finder-passcode-field"><label htmlFor="demo-code">Your restroom code</label><input id="demo-code" value={code} maxLength={40} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={Boolean(error)} aria-describedby={error ? "demo-code-error" : undefined} onChange={(event) => { setCode(event.target.value); setError(null); }} /><p>Up to 40 standard letters, numbers, or symbols.</p></div>
    <fieldset className="finder-passcode-visibility"><legend>Who can see your code?</legend>{(["private", "public"] as const).map((value) => <label key={value} className={`finder-passcode-choice${visibility === value ? " is-selected" : ""}`}><input type="radio" name="demo-code-visibility" checked={visibility === value} onChange={() => setVisibility(value)} /><span><strong>{value === "private" ? "Only me" : "Everyone"}</strong><span>{value === "private" ? "Keep your code out of the public preview." : "Show your report in the public preview."}</span></span></label>)}</fieldset>
    <p className="finder-passcode-save-note">Only your report changes. A new code clears its verification; changing visibility keeps it.</p>
    {error && <p className="finder-form-error" id="demo-code-error" role="alert">{error}</p>}
    <div className="finder-passcode-actions"><button type="submit" className="finder-primary-button">Save code</button><button type="button" className="finder-secondary-button" onClick={() => setEditing(false)}>Cancel</button></div>
  </form>;

  return <section className="finder-detail-section finder-passcodes demo-passcodes"><h3><KeyRound size={19} />Passcodes</h3><p className="finder-field-note">Each submitter controls their own code. Sharing and verification are simulated in this session.</p>
    <div className="demo-code-view" role="group" aria-label="Passcode preview"><button type="button" aria-pressed={view === "owner"} onClick={() => changeView("owner")}>Your view</button><button type="button" aria-pressed={view === "public"} onClick={() => changeView("public")}>Public view</button></div>
    {view === "public" && <p className="finder-passcode-status">Read-only preview of the codes other visitors can see.</p>}
    {reports.map((report) => <article className={report.isOwn ? "finder-passcode-own" : "finder-passcode-report"} key={report.reportID} data-demo-code-report={report.reportID} aria-label={report.isOwn ? "Your code report" : "Another visitor's public code report"}>
      <div className="finder-passcode-own-heading"><h4>{report.isOwn ? "Your code" : "Shared by another visitor"}</h4><span className={`finder-passcode-badge${report.visibility === "private" ? " is-private" : ""}`}>{report.visibility === "private" ? <LockKeyhole size={13} /> : <Globe2 size={13} />}{report.visibility === "private" ? "Only me" : "Everyone"}</span></div>
      <code className="finder-passcode-value">{report.code}</code>
      <dl className="finder-passcode-dates"><div><dt>Code updated</dt><dd><DemoTime value={report.updatedAt} /></dd></div><div><dt>Last verified</dt><dd>{report.verifiedAt ? <DemoTime value={report.verifiedAt} /> : "Not yet verified"}</dd></div></dl>
      <p className="finder-passcode-status">{report.isOwn ? report.visibility === "private" ? "Only your view includes this code. Private codes also save the location." : "You still control this report after sharing it." : "Its submitter controls the code and visibility."}</p>
      {view === "owner" && !(report.isOwn && editing) && <div className="finder-passcode-actions">{report.canEdit && <button type="button" className="finder-secondary-button" onClick={editOwn}><Pencil size={15} />Edit your code or visibility</button>}{report.canVerify && <button type="button" className="finder-secondary-button" aria-label={report.isOwn ? "Verify your code in demo" : "Verify another visitor's code in demo"} onClick={() => { if (currentView.current === "owner") onVerify(report.reportID); }}><Check size={16} />Verify code in demo</button>}</div>}
      {report.isOwn && view === "owner" && editing && editor}
    </article>)}
    {view === "owner" && !venue.ownCode && <div className="finder-passcode-own"><h4>Your code</h4>{editing ? editor : <button type="button" className="finder-secondary-button" onClick={editOwn}>Save your own code</button>}</div>}
    {reports.length === 0 && view === "public" && <p className="finder-passcode-status">No public code in this sample.</p>}
  </section>;
}

export function DemoDetail({ venue, onClose, onShowMap, onSave, onRate, onCode, onVerify, onNote }: {
  venue: DemoVenue;
  onClose: () => void;
  onShowMap: () => void;
  onSave: () => void;
  onRate: (stars: number | null) => void;
  onCode: (code: string, visibility: DemoVisibility) => boolean;
  onVerify: (reportID: string) => void;
  onNote: (note: string) => void;
}) {
  const [stars, setStars] = useState<number | null>(venue.ownRating);
  const [note, setNote] = useState(venue.note);
  const rating = demoRating(venue);

  return <aside className="finder-detail demo-detail" id="demo-location-details" aria-labelledby="demo-detail-title" tabIndex={-1}>
    <header className="finder-detail-heading">
      <button type="button" className="finder-icon-button finder-close" onClick={onClose} aria-label="Close location details"><ArrowLeft size={18} className="finder-close-back-icon" /><span className="finder-close-text">Back to results</span><X size={20} className="finder-close-x-icon" /></button>
      <span className="finder-overline">Sample location details</span><h2 id="demo-detail-title">{venue.name}</h2>
      <p><MapPin size={15} />{venue.address}</p>
      <div className="finder-detail-actions"><button type="button" className="finder-primary-button" onClick={onShowMap}><MapPin size={17} />Show on map</button><button type="button" className={`finder-save-button${venue.saved ? " is-saved" : ""}`} onClick={onSave} aria-pressed={venue.saved} aria-label={venue.saved ? "Remove saved restroom" : "Save restroom"}><Bookmark size={19} fill={venue.saved ? "currentColor" : "none"} />{venue.saved ? "Saved" : "Save"}</button></div>
    </header>
    <div className="finder-source-note"><Info size={17} /><p><strong>Example restroom details.</strong> The pin is an address point. Ratings, passcodes, and access labels below are sample data.</p></div>
    <section className="finder-detail-section"><h3><DoorOpen size={19} />Entry</h3><dl><Fact label="Entry permission" value={venue.isPublic ? "Public · example" : "Not reported"} /><Fact label="Code required" value={venue.ownCode || venue.publicReports.length ? "Yes · example" : "Not reported"} /><Fact label="Purchase required" value="Not reported" /><Fact label="Restroom hours" value="Not reported" /></dl></section>
    <section className="finder-detail-section"><h3><Footprints size={19} />Route inside</h3><dl><Fact label="Facility label" value={venue.isAccessible ? "Accessible · example" : "Not reported"} /><Fact label="Restroom floor" value="Not reported" /><Fact label="Stairs to restroom" value="Not reported" /></dl><p className="finder-field-note">The example facility label does not establish the restroom route or stall features.</p></section>

    <DemoPasscodes venue={venue} onCode={onCode} onVerify={onVerify} />

    <section className="finder-detail-section finder-ratings"><h3><Star size={19} />Community cleanliness</h3><div className="finder-rating-summary" aria-live="polite"><p className="finder-rating-value"><strong>{rating.average === null ? "—" : rating.average.toFixed(1)}</strong><span> / 5</span></p><p className="finder-rating-count">{rating.count} sample {rating.count === 1 ? "rating" : "ratings"}</p></div><p className="finder-rating-explanation">{!venue.added && "The starting 4.5 score is example data. "}Your session vote replaces your previous session vote.</p><form className="finder-rating-form" onSubmit={(event) => { event.preventDefault(); if (stars !== null) onRate(stars); }}><fieldset><legend>Rate cleanliness</legend><StarRatingSlider value={stars} onChange={setStars} /></fieldset><div className="finder-rating-actions"><button type="submit" className="finder-primary-button" disabled={stars === null || stars === venue.ownRating}>{venue.ownRating === null ? "Submit sample rating" : "Update sample rating"}</button>{venue.ownRating !== null && <button type="button" className="finder-secondary-button" onClick={() => { setStars(null); onRate(null); }}><Trash2 size={15} />Remove my rating</button>}</div></form></section>
    <section className="finder-detail-section"><h3><Pencil size={18} />Your demo note</h3><form className="finder-note-form" onSubmit={(event) => { event.preventDefault(); onNote(note); }}><label htmlFor="demo-note">Note for your next visit</label><textarea id="demo-note" value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} /><p className="finder-field-note">Kept in this demo session only.</p><div className="finder-passcode-actions"><button type="submit" className="finder-secondary-button">Save note</button>{venue.note && <button type="button" className="finder-secondary-button" onClick={() => { setNote(""); onNote(""); }}>Delete note</button>}</div></form></section>
    {!venue.added && <details className="finder-provenance"><summary>Sample and address reference</summary><p>The store name and street address refer to the real Target Herald Square. The pin is an approximate address point; it is not a confirmed restroom position.</p><a href={DEMO_ADDRESS_SOURCE} target="_blank" rel="noreferrer">Target store address reference</a><p>Restroom access, cleanliness, the sample codes, and all other demo reports are examples, not current Target information. Verification times record demo actions only.</p></details>}
  </aside>;
}
