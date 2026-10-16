"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Star, Trash2 } from "lucide-react";
import type { OwnRating, RatingSummary } from "@/lib/ratings";

export interface RestroomRatingsProps {
  summary: RatingSummary | null;
  publicLoading: boolean;
  publicError: string | null;
  ownRating: OwnRating | null;
  ownLoading: boolean;
  ownError: string | null;
  signedIn: boolean;
  authLoading: boolean;
  configured: boolean;
  saving: boolean;
  onSignIn: () => void;
  onSave: (stars: number | null) => Promise<boolean>;
  onRetry: () => void;
}

const choices = [
  { stars: 1, label: "Poor" },
  { stars: 2, label: "Fair" },
  { stars: 3, label: "Okay" },
  { stars: 4, label: "Good" },
  { stars: 5, label: "Excellent" },
] as const;

function ratingDate(value: Date): string | null {
  return Number.isFinite(value.getTime())
    ? value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" })
    : null;
}

export function RestroomRatings({ summary, publicLoading, publicError, ownRating, ownLoading, ownError, signedIn, authLoading, configured, saving, onSignIn, onSave, onRetry }: RestroomRatingsProps) {
  const id = useId();
  const ownStars = ownRating?.stars ?? null;
  const [selectedStars, setSelectedStars] = useState<number | null>(ownStars);
  const [storedStars, setStoredStars] = useState<number | null>(ownStars);
  const [localSaving, setLocalSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const edited = useRef(false);

  useEffect(() => {
    if (!ownLoading && !ownError && !localSaving) {
      setStoredStars(ownStars);
      if (!edited.current) setSelectedStars(ownStars);
    }
  }, [ownRating, ownStars, ownLoading, ownError, localSaving]);

  const busy = saving || localSaving;
  const locked = !configured || !signedIn || authLoading || ownLoading || !!ownError || busy;
  const changed = selectedStars !== null && selectedStars !== storedStars;
  const hasRatings = summary !== null && summary.ratingCount > 0;
  const updated = hasRatings ? ratingDate(summary.updatedAt) : null;

  async function save(stars: number | null) {
    if (locked || inFlight.current || stars === storedStars) return;
    inFlight.current = true;
    setLocalSaving(true);
    setSuccess(null);
    setFormError(null);
    try {
      if (await onSave(stars)) {
        edited.current = false;
        setSuccess(stars === null ? "Your rating was removed." : "Your rating was saved.");
      } else {
        setFormError(stars === null ? "Removal couldn’t be confirmed. Please try again." : "Your rating change couldn’t be confirmed. Your selection is still here; please try again.");
      }
    } catch {
      setFormError(stars === null ? "Removal couldn’t be confirmed. Please try again." : "Your rating change couldn’t be confirmed. Your selection is still here; please try again.");
    } finally {
      inFlight.current = false;
      setLocalSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedStars !== null) void save(selectedStars);
  }

  return <section className="finder-ratings" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`}><Star size={19} aria-hidden="true" />Community cleanliness</h3>
    <div className="finder-rating-summary" aria-live="polite" aria-busy={publicLoading}>
      {publicLoading ? <p className="finder-field-note" role="status">Loading community ratings…</p>
        : publicError ? <><p className="finder-form-error" role="alert">{publicError}</p><button type="button" className="finder-secondary-button" onClick={onRetry}>Retry ratings</button></>
          : !configured ? <p className="finder-field-note">Community ratings aren’t connected yet.</p>
            : hasRatings ? <>
              <p className="finder-rating-value"><strong>{summary.average.toFixed(1)}</strong><span> / 5</span></p>
              <p className="finder-rating-count">{summary.ratingCount} {summary.ratingCount === 1 ? "rating" : "ratings"}</p>
              <p className="finder-rating-date">{updated ? `Ratings updated ${updated}` : "Rating update time not available"}</p>
            </> : <p className="finder-rating-empty">No ratings yet.</p>}
    </div>
    <p className="finder-rating-explanation">Visitor opinions about cleanliness. They do not confirm current conditions or availability.</p>

    {!signedIn ? <button type="button" className="finder-secondary-button" onClick={onSignIn} disabled={authLoading || !configured}>
      {authLoading ? "Checking account…" : "Sign in with Google to rate"}<ArrowUpRight size={16} aria-hidden="true" />
    </button> : <>
      {ownLoading && <p className="finder-field-note" role="status">Loading your rating…</p>}
      {ownError && <><p className="finder-form-error" role="alert">{ownError}</p><button type="button" className="finder-secondary-button" onClick={onRetry} disabled={busy}>Retry my rating</button></>}
      <form className="finder-rating-form" onSubmit={submit}>
        <fieldset disabled={locked} aria-describedby={`${id}-scale ${id}-policy`}>
          <legend>Rate cleanliness</legend>
          <div className="finder-rating-options">{choices.map(({ stars, label }) => <label key={stars} className={`finder-rating-option${selectedStars === stars ? " is-selected" : ""}`} htmlFor={`${id}-${stars}`}>
            <input id={`${id}-${stars}`} name={`${id}-cleanliness`} type="radio" value={stars} checked={selectedStars === stars} aria-label={`${stars} ${stars === 1 ? "star" : "stars"}`} onChange={() => { edited.current = true; setSelectedStars(stars); setSuccess(null); setFormError(null); }} />
            <span className="finder-rating-option-label" aria-hidden="true"><span>{stars}<Star size={16} fill={selectedStars === stars ? "currentColor" : "none"} /></span><span>{label}</span></span>
          </label>)}</div>
          <p className="finder-rating-scale" id={`${id}-scale`}>1 = Poor · 2 = Fair · 3 = Okay · 4 = Good · 5 = Excellent</p>
        </fieldset>
        <p className="finder-field-note" id={`${id}-policy`}>One public rating per account. Updating replaces your previous rating.</p>
        <div className="finder-rating-actions">
          <button type="submit" className="finder-primary-button" disabled={locked || !changed}>{busy ? "Saving rating…" : storedStars === null ? "Submit rating" : "Update rating"}</button>
          {storedStars !== null && <button type="button" className="finder-secondary-button" disabled={locked} onClick={() => void save(null)}><Trash2 size={15} aria-hidden="true" />Remove my rating</button>}
        </div>
      </form>
    </>}
    {formError && <p className="finder-form-error" role="alert">{formError}</p>}
    {success && <p className="finder-note-success" role="status"><Check size={16} aria-hidden="true" />{success}</p>}
  </section>;
}
