"use client";

import { useState } from "react";
import { ArrowLeft, Bookmark, Check, DoorOpen, Footprints, Globe2, Info, KeyRound, LockKeyhole, MapPin, Pencil, Star, Trash2, X } from "lucide-react";
import { DEMO_ADDRESS_SOURCE, demoRating, type DemoVenue, type DemoVisibility } from "@/lib/demo-state";

function DemoTime({ value }: { value: string }) {
  return <time dateTime={value}>{new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(new Date(value))} NY time</time>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <div className={`finder-fact${value === "Not reported" ? " is-unknown" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

export function DemoDetail({ venue, onClose, onShowMap, onSave, onRate, onCode, onVerify, onDeleteCode, onNote }: {
  venue: DemoVenue;
  onClose: () => void;
  onShowMap: () => void;
  onSave: () => void;
  onRate: (stars: number | null) => void;
  onCode: (code: string, visibility: DemoVisibility) => boolean;
  onVerify: () => void;
  onDeleteCode: () => void;
  onNote: (note: string) => void;
}) {
  const [stars, setStars] = useState<number | null>(venue.ownRating);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(venue.code?.code ?? "");
  const [visibility, setVisibility] = useState<DemoVisibility>(venue.code?.visibility ?? "private");
  const [codeError, setCodeError] = useState<string | null>(null);
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
    <section className="finder-detail-section"><h3><DoorOpen size={19} />Entry</h3><dl><Fact label="Entry permission" value={venue.isPublic ? "Public · example" : "Not reported"} /><Fact label="Code required" value={venue.code ? "Yes · example" : "Not reported"} /><Fact label="Purchase required" value="Not reported" /><Fact label="Restroom hours" value="Not reported" /></dl></section>
    <section className="finder-detail-section"><h3><Footprints size={19} />Route inside</h3><dl><Fact label="Facility label" value={venue.isAccessible ? "Accessible · example" : "Not reported"} /><Fact label="Restroom floor" value="Not reported" /><Fact label="Stairs to restroom" value="Not reported" /></dl><p className="finder-field-note">The example facility label does not establish the restroom route or stall features.</p></section>

    <section className="finder-detail-section finder-passcodes"><h3><KeyRound size={19} />Passcodes</h3><p className="finder-field-note">Sample codes and verification actions. No real restroom report is created.</p>
      <div className="finder-passcode-own"><div className="finder-passcode-own-heading"><h4>Your demo code</h4>{venue.code && <span className={`finder-passcode-badge${venue.code.visibility === "private" ? " is-private" : ""}`}>{venue.code.visibility === "private" ? <LockKeyhole size={13} /> : <Globe2 size={13} />}{venue.code.visibility === "private" ? "Only me" : "Everyone"}</span>}</div>
        {venue.code ? <><code className="finder-passcode-value">{venue.code.code}</code><dl className="finder-passcode-dates"><div><dt>Code updated</dt><dd><DemoTime value={venue.code.updatedAt} /></dd></div><div><dt>Last verified</dt><dd>{venue.code.verifiedAt ? <DemoTime value={venue.code.verifiedAt} /> : "Not yet verified"}</dd></div></dl><p className="finder-passcode-status">{venue.code.visibility === "private" ? "Only me simulates a private code and adds the place to Saved." : "Everyone simulates a shared report in this demo."}</p></> : <p className="finder-passcode-status">No sample code saved.</p>}
        {!editing && <div className="finder-passcode-actions"><button type="button" className="finder-secondary-button" onClick={() => { setCode(venue.code?.code ?? ""); setVisibility(venue.code?.visibility ?? "private"); setCodeError(null); setEditing(true); }}><Pencil size={15} />{venue.code ? "Edit code or visibility" : "Save a code"}</button>{venue.code && <><button type="button" className="finder-secondary-button" onClick={onVerify}><Check size={16} />Verify code in demo</button><button type="button" className="finder-passcode-delete" onClick={onDeleteCode}><Trash2 size={15} />Delete my demo code</button></>}</div>}
        {editing && <form className="finder-passcode-form" onSubmit={(event) => { event.preventDefault(); if (onCode(code, visibility)) setEditing(false); else setCodeError("Use 1–40 standard letters, numbers, or symbols."); }}><div className="finder-passcode-field"><label htmlFor="demo-code">Restroom code</label><input id="demo-code" value={code} maxLength={40} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={Boolean(codeError)} aria-describedby={codeError ? "demo-code-error" : undefined} onChange={(event) => { setCode(event.target.value); setCodeError(null); }} /><p>Up to 40 standard letters, numbers, or symbols.</p></div><fieldset className="finder-passcode-visibility"><legend>Who can see this code?</legend>{(["private", "public"] as const).map((value) => <label key={value} className={`finder-passcode-choice${visibility === value ? " is-selected" : ""}`}><input type="radio" name="demo-code-visibility" checked={visibility === value} onChange={() => setVisibility(value)} /><span><strong>{value === "private" ? "Only me" : "Everyone"}</strong><span>{value === "private" ? "Simulate a private code in this session." : "Simulate sharing. This demo does not publish it."}</span></span></label>)}</fieldset><p className="finder-passcode-save-note">Changing the code clears its verification. Changing visibility keeps the existing verification.</p>{codeError && <p className="finder-form-error" id="demo-code-error" role="alert">{codeError}</p>}<div className="finder-passcode-actions"><button type="submit" className="finder-primary-button">Save code</button><button type="button" className="finder-secondary-button" onClick={() => setEditing(false)}>Cancel</button></div></form>}
      </div>
    </section>

    <section className="finder-detail-section finder-ratings"><h3><Star size={19} />Community cleanliness</h3><div className="finder-rating-summary" aria-live="polite"><p className="finder-rating-value"><strong>{rating.average === null ? "—" : rating.average.toFixed(1)}</strong><span> / 5</span></p><p className="finder-rating-count">{rating.count} sample {rating.count === 1 ? "rating" : "ratings"}</p></div><p className="finder-rating-explanation">{!venue.added && "The starting 4.5 score is example data. "}Your session vote replaces your previous session vote.</p><form className="finder-rating-form" onSubmit={(event) => { event.preventDefault(); if (stars !== null) onRate(stars); }}><fieldset><legend>Rate cleanliness</legend><div className="finder-rating-options">{[1, 2, 3, 4, 5].map((value) => <label className={`finder-rating-option${stars === value ? " is-selected" : ""}`} key={value}><input type="radio" name="demo-rating" aria-label={`${value} ${value === 1 ? "star" : "stars"}`} checked={stars === value} onChange={() => setStars(value)} /><span className="finder-rating-option-label" aria-hidden="true"><span>{value}<Star size={15} fill={stars === value ? "currentColor" : "none"} /></span><span>{["Poor", "Fair", "Okay", "Good", "Excellent"][value - 1]}</span></span></label>)}</div></fieldset><div className="finder-rating-actions"><button type="submit" className="finder-primary-button" disabled={stars === null || stars === venue.ownRating}>{venue.ownRating === null ? "Submit sample rating" : "Update sample rating"}</button>{venue.ownRating !== null && <button type="button" className="finder-secondary-button" onClick={() => { setStars(null); onRate(null); }}><Trash2 size={15} />Remove my rating</button>}</div></form></section>
    <section className="finder-detail-section"><h3><Pencil size={18} />Your demo note</h3><form className="finder-note-form" onSubmit={(event) => { event.preventDefault(); onNote(note); }}><label htmlFor="demo-note">Note for your next visit</label><textarea id="demo-note" value={note} maxLength={1000} rows={3} onChange={(event) => setNote(event.target.value)} /><p className="finder-field-note">Kept in this demo session only.</p><div className="finder-passcode-actions"><button type="submit" className="finder-secondary-button">Save note</button>{venue.note && <button type="button" className="finder-secondary-button" onClick={() => { setNote(""); onNote(""); }}>Delete note</button>}</div></form></section>
    {!venue.added && <details className="finder-provenance"><summary>Sample and address reference</summary><p>The store name and street address refer to the real Target Herald Square. The pin is an approximate address point; it is not a confirmed restroom position.</p><a href={DEMO_ADDRESS_SOURCE} target="_blank" rel="noreferrer">Target store address reference</a><p>Restroom access, cleanliness, the 3434 code, and all other demo reports are examples, not current Target information. Verification times record demo actions only.</p></details>}
  </aside>;
}
