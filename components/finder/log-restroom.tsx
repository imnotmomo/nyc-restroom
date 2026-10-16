"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ArrowUpRight, LocateFixed, MapPin, X } from "lucide-react";
import { COMMUNITY_RESTROOM_BOUNDS, newCommunityRestroomID, type CommunityRestroomInput, type LogRestroomInput } from "@/lib/community-restrooms";
import { locationAvailabilityError, requestBrowserLocation, type LocationCoordinates } from "@/lib/location";
import { MAX_PASSCODE_LENGTH, type PasscodeInput } from "@/lib/passcodes";
import { PasscodeVisibilityChoices } from "@/components/finder/passcodes";

export interface LogRestroomFormProps {
  uid: string | null;
  accountLoading: boolean;
  authBusy?: boolean;
  saving?: boolean;
  authError?: string | null;
  submitError?: string | null;
  initialCoordinates: LocationCoordinates | null;
  onSignIn: () => void;
  onSubmit: (input: LogRestroomInput, requestID: string) => Promise<boolean>;
  onClose: () => void;
}

type Draft = Omit<CommunityRestroomInput, "latitude" | "longitude" | "observedOn"> & {
  latitude: string;
  longitude: string;
  observedOn: string;
  passcodeRequired: "yes" | "no" | "unknown";
  code: string;
  codeVisibility: PasscodeInput["visibility"];
};
type FieldErrors = Partial<Record<keyof Draft, string>>;

function emptyDraft(coordinates: LocationCoordinates | null): Draft {
  return {
    name: "", address: "",
    latitude: coordinates && Number.isFinite(coordinates.latitude) ? String(coordinates.latitude) : "",
    longitude: coordinates && Number.isFinite(coordinates.longitude) ? String(coordinates.longitude) : "",
    locationType: "other", entryRule: "unknown", stepFreeAccess: "unknown", notes: "", observedOn: "",
    passcodeRequired: "unknown", code: "", codeVisibility: "private",
  };
}

function todayInNYC(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/New_York" }).format(new Date());
}

function fieldErrors(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.name.trim()) errors.name = "Enter the restroom or venue name.";
  else if (draft.name.trim().length > 120) errors.name = "Keep the name to 120 characters or fewer.";
  if (!draft.address.trim()) errors.address = "Enter the NYC street address or a specific park location.";
  else if (draft.address.trim().length > 240) errors.address = "Keep the address to 240 characters or fewer.";
  const latitude = Number(draft.latitude), longitude = Number(draft.longitude);
  if (!draft.latitude.trim() || !Number.isFinite(latitude) || latitude < COMMUNITY_RESTROOM_BOUNDS.south || latitude > COMMUNITY_RESTROOM_BOUNDS.north) errors.latitude = `Use a latitude from ${COMMUNITY_RESTROOM_BOUNDS.south} to ${COMMUNITY_RESTROOM_BOUNDS.north}.`;
  if (!draft.longitude.trim() || !Number.isFinite(longitude) || longitude < COMMUNITY_RESTROOM_BOUNDS.west || longitude > COMMUNITY_RESTROOM_BOUNDS.east) errors.longitude = `Use a longitude from ${COMMUNITY_RESTROOM_BOUNDS.west} to ${COMMUNITY_RESTROOM_BOUNDS.east}.`;
  if (draft.notes.trim().length > 1000) errors.notes = "Keep the notes to 1,000 characters or fewer.";
  if (draft.passcodeRequired === "yes" && draft.code.trim()
    && (draft.code.trim().length > MAX_PASSCODE_LENGTH || !/^[\x20-\x7e]+$/.test(draft.code.trim()))) {
    errors.code = `Use up to ${MAX_PASSCODE_LENGTH} standard letters, numbers, or symbols, or leave the code blank.`;
  }
  if (draft.observedOn) {
    const date = new Date(`${draft.observedOn}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.observedOn) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== draft.observedOn || draft.observedOn < "2000-01-01" || draft.observedOn > todayInNYC()) errors.observedOn = "Choose a real date from 2000 through today, or leave it blank.";
  }
  return errors;
}

export function LogRestroomForm({ uid, accountLoading, authBusy = false, saving = false, authError = null, submitError = null, initialCoordinates, onSignIn, onSubmit, onClose }: LogRestroomFormProps) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const [draftState, setDraftState] = useState(() => ({ uid, values: emptyDraft(initialCoordinates) }));
  const draft = draftState.uid === uid ? draftState.values : emptyDraft(initialCoordinates);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const requestID = useRef<string | null>(null);
  const inFlight = useRef<object | null>(null);
  const currentUID = useRef(uid);
  const initialLocation = useRef(initialCoordinates);
  const cancelLocation = useRef<(() => void) | null>(null);
  const locationVersion = useRef(0);
  currentUID.current = uid;
  initialLocation.current = initialCoordinates;
  const busy = saving || localSaving;
  const locked = !uid || accountLoading || authBusy || busy;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => {
      inFlight.current = null;
      locationVersion.current += 1;
      cancelLocation.current?.();
      element?.close();
    };
  }, []);

  useEffect(() => {
    setDraftState({ uid, values: emptyDraft(initialLocation.current) });
    setErrors({}); setFormError(null); setLocationError(null);
    setLocalSaving(false); setLocating(false);
    requestID.current = null; inFlight.current = null;
    locationVersion.current += 1; cancelLocation.current?.();
  }, [uid]);

  function change<Field extends keyof Draft>(field: Field, value: Draft[Field]) {
    setDraftState((previous) => {
      const values = { ...(previous.uid === uid ? previous.values : emptyDraft(initialLocation.current)), [field]: value };
      if (field === "passcodeRequired" && value !== "yes") { values.code = ""; values.codeVisibility = "private"; }
      return { uid, values };
    });
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFormError(null);
  }

  function locate() {
    if (locked || locating) return;
    cancelLocation.current?.();
    const version = ++locationVersion.current;
    const owner = uid;
    setLocationError(null);
    let allowedByPolicy: boolean | undefined;
    try {
      const policyDocument = document as Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean }; featurePolicy?: { allowsFeature(feature: string): boolean } };
      allowedByPolicy = (policyDocument.permissionsPolicy ?? policyDocument.featurePolicy)?.allowsFeature("geolocation");
    } catch { /* Older browsers can still perform the location request. */ }
    const unavailable = locationAvailabilityError({ secureContext: window.isSecureContext !== false, hasGeolocation: Boolean(navigator.geolocation), allowedByPolicy });
    if (unavailable) { setLocationError(unavailable); return; }
    setLocating(true);
    cancelLocation.current = requestBrowserLocation({
      geolocation: navigator.geolocation,
      onSuccess: (coordinates) => {
        if (locationVersion.current !== version || currentUID.current !== owner) return;
        const { south, north, west, east } = COMMUNITY_RESTROOM_BOUNDS;
        if (coordinates.latitude < south || coordinates.latitude > north || coordinates.longitude < west || coordinates.longitude > east) {
          setLocationError("Your current location is outside the approximate NYC area. Enter the restroom’s NYC coordinates instead.");
        } else {
          setDraftState((previous) => ({ uid: owner, values: { ...previous.values, latitude: coordinates.latitude.toFixed(6), longitude: coordinates.longitude.toFixed(6) } }));
          setErrors((previous) => ({ ...previous, latitude: undefined, longitude: undefined }));
        }
        setLocating(false);
      },
      onError: (message) => { if (locationVersion.current === version && currentUID.current === owner) { setLocationError(message); setLocating(false); } },
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || locating || inFlight.current) return;
    const validation = fieldErrors(draft);
    setErrors(validation); setFormError(null);
    const firstInvalid = Object.keys(validation)[0];
    if (firstInvalid) { form.current?.querySelector<HTMLElement>(`[name="${firstInvalid}"]`)?.focus(); return; }
    const owner = uid;
    const operation = {};
    inFlight.current = operation;
    setLocalSaving(true);
    try {
      requestID.current ??= newCommunityRestroomID();
      const confirmed = await onSubmit({
        name: draft.name.trim(), address: draft.address.trim(), latitude: Number(draft.latitude), longitude: Number(draft.longitude),
        locationType: draft.locationType, entryRule: draft.entryRule, stepFreeAccess: draft.stepFreeAccess,
        notes: draft.notes.trim(), observedOn: draft.observedOn || null,
        passcodeRequired: draft.passcodeRequired,
        ...(draft.passcodeRequired === "yes" && draft.code.trim() ? { passcode: { code: draft.code.trim(), visibility: draft.codeVisibility } } : {}),
      }, requestID.current);
      if (currentUID.current !== owner || inFlight.current !== operation) return;
      if (confirmed) {
        requestID.current = null;
        setDraftState({ uid: owner, values: emptyDraft(initialLocation.current) });
        setErrors({});
      } else {
        setFormError("Your submission couldn’t be confirmed. Your details are still here; retry this form to check the same submission.");
      }
    } catch {
      if (currentUID.current === owner && inFlight.current === operation) setFormError("Your submission couldn’t be confirmed. Your details are still here; retry this form to check the same submission.");
    } finally {
      if (inFlight.current === operation) { inFlight.current = null; setLocalSaving(false); }
    }
  }

  function error(field: keyof Draft) {
    return errors[field] ? <p className="finder-log-field-error" id={`${id}-${field}-error`}>{errors[field]}</p> : null;
  }

  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== "Tab") return;
    const element = dialog.current;
    if (!element) return;
    const controls = [...element.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex]")]
      .filter((control) => control.tabIndex >= 0 && !control.matches(":disabled") && control.getClientRects().length > 0);
    if (controls.length === 0) { event.preventDefault(); element.focus(); return; }
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <dialog ref={dialog} className="finder-log-dialog" tabIndex={-1} aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} onKeyDown={keepFocus} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="finder-log-heading">
      <div><span className="finder-overline">Add to the city map</span><h2 id={`${id}-title`}><MapPin size={22} aria-hidden="true" />Log a restroom</h2></div>
      <button type="button" className="finder-log-close" aria-label="Close log restroom form" onClick={onClose} disabled={busy} autoFocus><X size={20} aria-hidden="true" /></button>
    </header>
    <div className="finder-log-body">
      <p className="finder-log-intro" id={`${id}-intro`}>Share a location you know. It will appear as a community listing, separate from NYC’s published data.</p>
      <p className="finder-log-public" id={`${id}-public`}>Name, address, chosen coordinates, entry notes, and whether a code is required will be public. A code has its own visibility choice below. Keep passcodes and personal/contact information out of public notes.</p>
      {authError && <p className="finder-form-error" role="alert">{authError}</p>}
      {!uid ? <div className="finder-log-sign-in"><p>Sign in to add a location. Everyone can browse the map.</p><button type="button" className="finder-primary-button" disabled={accountLoading || authBusy} onClick={onSignIn}>{accountLoading || authBusy ? "Connecting account…" : "Sign in with Google to log a restroom"}<ArrowUpRight size={17} aria-hidden="true" /></button></div> : <form ref={form} className="finder-log-form" onSubmit={(event) => void submit(event)} noValidate>
        <fieldset disabled={locked}>
          <legend className="finder-sr-only">Restroom details</legend>
          <div className="finder-log-field"><label htmlFor={`${id}-name`}>Restroom or venue name <span>Required</span></label><input id={`${id}-name`} name="name" autoComplete="off" maxLength={120} required value={draft.name} aria-invalid={!!errors.name} aria-describedby={errors.name ? `${id}-name-error` : undefined} onChange={(event) => change("name", event.target.value)} />{error("name")}</div>
          <div className="finder-log-field"><label htmlFor={`${id}-address`}>Street address or park location <span>Required</span></label><input id={`${id}-address`} name="address" autoComplete="off" maxLength={240} required value={draft.address} aria-invalid={!!errors.address} aria-describedby={errors.address ? `${id}-address-error` : undefined} onChange={(event) => change("address", event.target.value)} />{error("address")}</div>

          <div className="finder-log-location-heading"><div><h3>Place the pin</h3><p id={`${id}-location-help`}>Use the restroom’s location, not where you are now unless you’re there. Coordinates must fall within the approximate NYC area.</p></div><button type="button" className="finder-secondary-button" onClick={locate} disabled={locked || locating}><LocateFixed size={17} aria-hidden="true" />{locating ? "Locating…" : "Use my location"}</button></div>
          <div className="finder-log-coordinate-grid">
            <div className="finder-log-field"><label htmlFor={`${id}-latitude`}>Latitude <span>Required</span></label><input id={`${id}-latitude`} name="latitude" type="number" inputMode="decimal" step="any" min={COMMUNITY_RESTROOM_BOUNDS.south} max={COMMUNITY_RESTROOM_BOUNDS.north} required value={draft.latitude} disabled={locked || locating} aria-invalid={!!errors.latitude} aria-describedby={`${id}-location-help${errors.latitude ? ` ${id}-latitude-error` : ""}`} onChange={(event) => change("latitude", event.target.value)} />{error("latitude")}</div>
            <div className="finder-log-field"><label htmlFor={`${id}-longitude`}>Longitude <span>Required</span></label><input id={`${id}-longitude`} name="longitude" type="number" inputMode="decimal" step="any" min={COMMUNITY_RESTROOM_BOUNDS.west} max={COMMUNITY_RESTROOM_BOUNDS.east} required value={draft.longitude} disabled={locked || locating} aria-invalid={!!errors.longitude} aria-describedby={`${id}-location-help${errors.longitude ? ` ${id}-longitude-error` : ""}`} onChange={(event) => change("longitude", event.target.value)} />{error("longitude")}</div>
          </div>
          {locationError && <p className="finder-form-error" role="alert">{locationError}</p>}

          <div className="finder-log-field"><label htmlFor={`${id}-type`}>Location type</label><select id={`${id}-type`} name="locationType" value={draft.locationType} onChange={(event) => change("locationType", event.target.value as Draft["locationType"])}><option value="other">Other / not sure</option><option value="park">Park</option><option value="library">Library</option><option value="cafe">Café</option><option value="restaurant">Restaurant</option><option value="store">Store</option></select></div>
          <div className="finder-log-field"><label htmlFor={`${id}-entry`}>Entry rules</label><select id={`${id}-entry`} name="entryRule" value={draft.entryRule} aria-describedby={`${id}-entry-help`} onChange={(event) => change("entryRule", event.target.value as Draft["entryRule"])}><option value="unknown">Not reported</option><option value="public">Public entry</option><option value="customers">Customers only</option></select><p className="finder-log-help" id={`${id}-entry-help`}>Leave unknown rules as “Not reported.” Add any fee or key requirements in notes.</p></div>
          <div className="finder-log-field"><label htmlFor={`${id}-code-required`}>Does the restroom require a code?</label><select id={`${id}-code-required`} name="passcodeRequired" value={draft.passcodeRequired} aria-describedby={`${id}-code-required-help`} onChange={(event) => change("passcodeRequired", event.target.value as Draft["passcodeRequired"])}><option value="unknown">Not reported</option><option value="yes">Yes — code required</option><option value="no">No code required</option></select><p className="finder-log-help" id={`${id}-code-required-help`}>A code requirement is separate from permission to enter. Leave it unreported if you don’t know.</p></div>
          {draft.passcodeRequired === "yes" && <div className="finder-log-passcode">
            <div className="finder-log-field"><label htmlFor={`${id}-code`}>Restroom code <span>Optional</span></label><input id={`${id}-code`} name="code" type="text" value={draft.code} maxLength={MAX_PASSCODE_LENGTH} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={!!errors.code} aria-describedby={`${id}-code-help${errors.code ? ` ${id}-code-error` : ""}`} onChange={(event) => change("code", event.target.value)} /><p className="finder-log-help" id={`${id}-code-help`}>Save a code you know, or leave it blank. Keep codes in this field rather than public notes.</p>{error("code")}</div>
            {draft.code.trim() && <><PasscodeVisibilityChoices id={`${id}-code-visibility`} value={draft.codeVisibility} onChange={(visibility) => change("codeVisibility", visibility)} disabled={locked} /><p className="finder-passcode-save-note">{draft.codeVisibility === "private" ? "Only me: the code is saved privately to your account, and this place is automatically added to Saved." : "Everyone: the code is published for anyone to read."} You can edit the code or change visibility later. Saving does not mark it as verified.</p></>}
          </div>}
          <div className="finder-log-field"><label htmlFor={`${id}-step-free`}>Step-free route to restroom</label><select id={`${id}-step-free`} name="stepFreeAccess" value={draft.stepFreeAccess} aria-describedby={`${id}-step-free-help`} onChange={(event) => change("stepFreeAccess", event.target.value as Draft["stepFreeAccess"])}><option value="unknown">Not reported</option><option value="yes">Yes — a step-free route was observed</option><option value="no">No — route is not step-free</option></select><p className="finder-log-help" id={`${id}-step-free-help`}>From the street entrance all the way to the restroom. An entrance alone does not establish the route or certify an accessible stall.</p></div>
          <div className="finder-log-field"><label htmlFor={`${id}-observed`}>When you observed these details <span>Optional</span></label><input id={`${id}-observed`} name="observedOn" type="date" min="2000-01-01" max={todayInNYC()} value={draft.observedOn} aria-invalid={!!errors.observedOn} aria-describedby={`${id}-observed-help${errors.observedOn ? ` ${id}-observedOn-error` : ""}`} onChange={(event) => change("observedOn", event.target.value)} /><p className="finder-log-help" id={`${id}-observed-help`}>Leave blank if you don’t know. Your submission date is recorded separately.</p>{error("observedOn")}</div>
          <div className="finder-log-field"><label htmlFor={`${id}-notes`}>Entry and route notes <span>Optional</span></label><textarea id={`${id}-notes`} name="notes" rows={3} maxLength={1000} value={draft.notes} aria-invalid={!!errors.notes} aria-describedby={`${id}-notes-help${errors.notes ? ` ${id}-notes-error` : ""}`} onChange={(event) => change("notes", event.target.value)} /><p className="finder-log-help" id={`${id}-notes-help`}>Describe what you know about entry rules, fees, or reaching the restroom. No personal/contact information.</p>{error("notes")}</div>
        </fieldset>
        {(submitError || formError) && <p className="finder-form-error" role="alert">{submitError || formError}</p>}
        <div className="finder-log-actions"><button type="submit" className="finder-primary-button" disabled={locked || locating} aria-describedby={`${id}-public`}>{busy ? "Saving restroom…" : "Add restroom to map"}</button><button type="button" className="finder-secondary-button" onClick={onClose} disabled={busy}>Cancel</button></div>
      </form>}
    </div>
  </dialog>;
}
