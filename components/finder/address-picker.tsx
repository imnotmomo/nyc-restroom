"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, LocateFixed, MapPin, Search } from "lucide-react";
import { COMMUNITY_RESTROOM_BOUNDS } from "@/lib/community-restrooms";
import { GEOCODING_ATTRIBUTION, nearbyAddresses, searchAddresses, type AddressSuggestion } from "@/lib/geocoding";
import { locationAvailabilityError, requestBrowserLocation, type BrowserLocation } from "@/lib/location";

interface AddressPickerProps {
  uid: string | null;
  disabled: boolean;
  onSelect: (suggestion: AddressSuggestion) => void;
  onBusyChange: (busy: boolean) => void;
}

type PickerState = {
  uid: string | null;
  query: string;
  mode: "search" | "gps" | "nearby" | null;
  results: AddressSuggestion[];
  error: string | null;
  message: string | null;
  location: BrowserLocation | null;
};

function emptyState(uid: string | null): PickerState {
  return { uid, query: "", mode: null, results: [], error: null, message: null, location: null };
}

function approximateDistance(meters: number): string {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function AddressPicker({ uid, disabled, onSelect, onBusyChange }: AddressPickerProps) {
  const id = useId();
  const [storedState, setStoredState] = useState(() => emptyState(uid));
  const state = storedState.uid === uid ? storedState : emptyState(uid);
  const currentUID = useRef(uid);
  currentUID.current = uid;
  const mounted = useRef(true);
  const active = useRef<{ owner: string | null; controller: AbortController } | null>(null);
  const cancelGPS = useRef<(() => void) | null>(null);

  function cancel() {
    active.current?.controller.abort();
    active.current = null;
    cancelGPS.current?.();
    cancelGPS.current = null;
    onBusyChange(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancel(); };
  }, []);

  useEffect(() => {
    cancel();
    setStoredState(emptyState(uid));
  }, [uid]);

  function update(patch: Partial<PickerState>) {
    setStoredState((previous) => ({ ...(previous.uid === uid ? previous : emptyState(uid)), ...patch, uid }));
  }

  function begin(mode: "search" | "gps") {
    cancel();
    const operation = { owner: uid, controller: new AbortController() };
    active.current = operation;
    update({ mode, results: [], error: null, message: null, location: null });
    onBusyChange(true);
    return operation;
  }

  function isCurrent(operation: NonNullable<typeof active.current>): boolean {
    return mounted.current && active.current === operation && currentUID.current === operation.owner && !operation.controller.signal.aborted;
  }

  async function resolve(mode: "search" | "nearby", operation: NonNullable<typeof active.current>, location?: BrowserLocation) {
    try {
      const results = mode === "search"
        ? await searchAddresses(state.query.trim(), { signal: operation.controller.signal })
        : await nearbyAddresses(location!, { signal: operation.controller.signal });
      if (!isCurrent(operation)) return;
      update({ results, error: null, message: results.length
        ? `${results.length} address ${results.length === 1 ? "suggestion" : "suggestions"}. Choose the location that matches your restroom.`
        : "No matching NYC address found. Try another search, or enter the address and pin manually below.",
      });
    } catch (error) {
      if (!isCurrent(operation) || error instanceof Error && error.name === "AbortError") return;
      update({ results: [], error: error instanceof Error ? error.message : "Address suggestions could not be loaded. Retry, or enter the address and pin manually below.", message: null });
    } finally {
      if (isCurrent(operation)) {
        active.current = null;
        update({ mode: null });
        onBusyChange(false);
      }
    }
  }

  function search() {
    if (disabled || !uid) return;
    if (state.query.trim().length < 3) { update({ error: "Enter at least three characters to search for an NYC address or place.", message: null }); return; }
    const operation = begin("search");
    void resolve("search", operation);
  }

  function locate() {
    if (disabled || !uid) return;
    const operation = begin("gps");
    let allowedByPolicy: boolean | undefined;
    try {
      const policyDocument = document as Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean }; featurePolicy?: { allowsFeature(feature: string): boolean } };
      allowedByPolicy = (policyDocument.permissionsPolicy ?? policyDocument.featurePolicy)?.allowsFeature("geolocation");
    } catch { /* Older browsers can still request location. */ }
    const unavailable = locationAvailabilityError({ secureContext: window.isSecureContext !== false, hasGeolocation: Boolean(navigator.geolocation), allowedByPolicy });
    if (unavailable) {
      cancel();
      update({ mode: null, error: unavailable });
      return;
    }
    cancelGPS.current = requestBrowserLocation({
      geolocation: navigator.geolocation,
      onSuccess: (location) => {
        if (!isCurrent(operation)) return;
        const { south, north, west, east } = COMMUNITY_RESTROOM_BOUNDS;
        if (location.latitude < south || location.latitude > north || location.longitude < west || location.longitude > east) {
          cancel();
          update({ mode: null, error: "Your location is outside the approximate NYC area. Search an NYC address or enter its location manually below." });
          return;
        }
        update({ mode: "nearby", location });
        void resolve("nearby", operation, location);
      },
      onError: (message) => {
        if (!isCurrent(operation)) return;
        cancel();
        update({ mode: null, error: message });
      },
    });
  }

  function choose(suggestion: AddressSuggestion) {
    if (disabled || !uid) return;
    cancel();
    update({ results: [], mode: null, error: null, message: "Location selected. Check or correct the public address and pin below." });
    onSelect(suggestion);
  }

  return <section className="finder-address-picker" aria-labelledby={`${id}-title`}>
    <h3 id={`${id}-title`}>Find the location</h3>
    <p className="finder-log-help" id={`${id}-intro`}>Search an NYC address or place, or choose an address near you. Suggestions locate an address; they do not confirm a restroom or permission to enter.</p>
    <div className="finder-address-search"><label htmlFor={`${id}-query`}>Search for an address or place</label><div><input id={`${id}-query`} name="addressSearch" type="search" autoComplete="off" maxLength={240} value={state.query} disabled={disabled} aria-describedby={`${id}-intro`} onChange={(event) => { cancel(); update({ query: event.target.value, mode: null, results: [], error: null, message: null, location: null }); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); search(); } }} /><button type="button" className="finder-secondary-button" disabled={disabled} onClick={search}><Search size={17} aria-hidden="true" />Search address</button></div></div>
    <button type="button" className="finder-secondary-button finder-address-locate" disabled={disabled} onClick={locate}><LocateFixed size={17} aria-hidden="true" />{state.mode === "gps" ? "Getting location…" : "Use my location"}</button>
    <p className="finder-address-attribution">Search uses <a href={GEOCODING_ATTRIBUTION.url} target="_blank" rel="noreferrer">{GEOCODING_ATTRIBUTION.label}</a>. Use my location sends your browser location to this service only after you choose that action.</p>
    {state.location && <p className="finder-address-accuracy">{state.location.accuracyMeters !== undefined
      ? `Browser location is approximate (reported accuracy: about ${approximateDistance(state.location.accuracyMeters)}). Choose the correct address below.`
      : "Browser location is approximate. Choose the correct address below."}</p>}
    {state.mode && <p className="finder-address-status" role="status">{state.mode === "gps" ? "Waiting for your browser location…" : state.mode === "nearby" ? "Looking for nearby addresses…" : "Searching NYC addresses…"}</p>}
    {state.error && <p className="finder-form-error" role="alert">{state.error}</p>}
    {state.message && <p className="finder-address-status" role="status">{state.message}</p>}
    {state.results.length > 0 && <ul className="finder-address-results" aria-label="Address suggestions">{state.results.map((suggestion) => <li key={suggestion.id}><button type="button" disabled={disabled} onClick={() => choose(suggestion)}><MapPin size={17} aria-hidden="true" /><span><strong>{suggestion.label}</strong>{suggestion.distanceMeters !== undefined && <span>About {approximateDistance(suggestion.distanceMeters)} from your browser location · straight-line distance</span>}<span>{suggestion.source} · Select address <Check size={12} aria-hidden="true" /></span></span></button></li>)}</ul>}
  </section>;
}
