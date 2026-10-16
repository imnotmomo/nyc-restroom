"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpRight, Bookmark, ChevronRight, Info, List, LocateFixed, Map as MapIcon, MapPin, Search, X } from "lucide-react";
import { FirebaseAccountButton, useFirebaseAccount } from "@/components/firebase-account";
import { PersonalNotes, RestroomDetail } from "@/components/finder/detail";
import { COLUMBIA, datasetSource, distanceMeters, formatDistance, isWithinCollection, matchesRestroom, restrooms, sourceDateLabel, type Coordinates } from "@/lib/restrooms";
import { deleteVisitNote, readLibrary, saveVisitNote, setFavorite, type VisitNote, type VisitNoteInput } from "@/lib/user-data";
import { locationAvailabilityError, requestBrowserLocation } from "@/lib/location";

const RestroomMap = dynamic(() => import("@/components/finder/map"), {
  ssr: false,
  loading: () => <div className="finder-map-loading" role="status">Loading the map…</div>,
});

type Filter = "all" | "Library" | "Park" | "saved";
const LIST_PAGE_SIZE = 50;

export function RestroomExplorer() {
  const account = useFirebaseAccount();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<"distance" | "name">("distance");
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const listScroll = useRef<HTMLDivElement | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationRequestID, setLocationRequestID] = useState(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [library, setLibrary] = useState<{ uid: string | null; favoriteIDs: string[]; notes: VisitNote[] }>({ uid: null, favoriteIDs: [], notes: [] });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryRetry, setLibraryRetry] = useState(0);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const lastFocusedControl = useRef<HTMLElement | null>(null);
  const cancelLocation = useRef<(() => void) | null>(null);
  const locationVersion = useRef(0);
  const uid = account.user?.uid ?? null;
  const currentUID = useRef(uid);
  currentUID.current = uid;
  const favoriteIDs = useMemo(() => library.uid === uid && uid ? library.favoriteIDs : [], [library, uid]);
  const privateNotes = library.uid === uid && uid ? library.notes : [];

  useEffect(() => () => {
    locationVersion.current += 1;
    cancelLocation.current?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLibrary({ uid, favoriteIDs: [], notes: [] });
    setLibraryError(null);
    setMessage(null);
    setFavoriteBusy(false);
    setNoteBusy(false);
    if (!uid) { setLibraryLoading(false); setFilter((value) => value === "saved" ? "all" : value); return; }
    setLibraryLoading(true);
    readLibrary(uid).then((result) => {
      if (!cancelled && currentUID.current === uid) setLibrary({ uid, ...result });
    }).catch((error: unknown) => {
      if (!cancelled && currentUID.current === uid) setLibraryError(error instanceof Error ? error.message : "Your saved places and notes could not be loaded.");
    }).finally(() => { if (!cancelled && currentUID.current === uid) setLibraryLoading(false); });
    return () => { cancelled = true; };
  }, [uid, libraryRetry]);

  const origin = userLocation ?? COLUMBIA;
  const originLabel = userLocation ? "your location" : "Columbia";
  const places = useMemo(() => restrooms.filter((place) => matchesRestroom(place, query)
    && (filter === "all" || (filter === "saved" ? favoriteIDs.includes(place.id) : place.locationType === filter)))
    .map((place) => ({ place, distance: distanceMeters(origin, place) }))
    .sort((a, b) => sort === "name" ? a.place.name.localeCompare(b.place.name) : a.distance - b.distance),
  [query, filter, favoriteIDs, origin, sort]);
  const mapPlaces = useMemo(() => places.map(({ place }) => place), [places]);
  const selected = restrooms.find((place) => place.id === selectedID);

  useEffect(() => {
    setListLimit(LIST_PAGE_SIZE);
    listScroll.current?.scrollTo({ top: 0 });
  }, [query, filter, sort, userLocation]);

  const selectPlace = useCallback((id: string) => {
    lastFocusedControl.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedID(id);
    requestAnimationFrame(() => {
      const details = document.getElementById("restroom-details");
      details?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 650px)").matches) details?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, []);

  const closePlace = useCallback(() => {
    const placeID = selectedID;
    setSelectedID(null);
    requestAnimationFrame(() => {
      let target: HTMLElement | null = null;
      if (lastFocusedControl.current?.isConnected) target = lastFocusedControl.current;
      else if (placeID) {
        const candidates = document.querySelectorAll<HTMLElement>(`[data-place-id="${CSS.escape(placeID)}"], [data-restroom-id="${CSS.escape(placeID)}"]`);
        target = [...candidates].find((control) => control.getClientRects().length > 0) ?? document.getElementById("restroom-search");
      }
      else target = document.getElementById("restroom-search");
      target?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 650px)").matches) target?.scrollIntoView({ block: "nearest", behavior: "auto" });
    });
  }, [selectedID]);

  useEffect(() => {
    if (!selectedID) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePlace();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedID, closePlace]);

  async function chooseFilter(next: Filter) {
    if (next === "saved" && !account.user) {
      if (!account.configured) { setMessage("Account sign-in is not connected yet. You can browse every location without an account."); return; }
      if (!(await account.signInWithGoogle())) return;
    }
    setFilter(next);
    setSelectedID(null);
  }

  function locate() {
    cancelLocation.current?.();
    const version = ++locationVersion.current;
    account.clearError();
    setMessage(null);
    setLocationError(null);
    let allowedByPolicy: boolean | undefined;
    try {
      const policyDocument = document as Document & {
        permissionsPolicy?: { allowsFeature(feature: string): boolean };
        featurePolicy?: { allowsFeature(feature: string): boolean };
      };
      const policy = policyDocument.permissionsPolicy ?? policyDocument.featurePolicy;
      allowedByPolicy = policy?.allowsFeature("geolocation");
    } catch { /* Unsupported policy inspection must not prevent a real location request. */ }
    const unavailable = locationAvailabilityError({
      secureContext: window.isSecureContext !== false,
      hasGeolocation: Boolean(navigator.geolocation),
      allowedByPolicy,
    });
    if (unavailable) { setLocationError(unavailable); setLocating(false); return; }
    setLocating(true);
    cancelLocation.current = requestBrowserLocation({
      geolocation: navigator.geolocation,
      onSuccess: (location) => {
        if (locationVersion.current !== version) return;
        setUserLocation(location);
        setSelectedID(null);
        setMobileView("map");
        setLocationRequestID((value) => value + 1);
        if (!isWithinCollection(location)) setLocationError("The map is centered on your location, outside this collection’s extent. We may not list a restroom near you. Choose Show collection to return to the NYC locations.");
        setLocating(false);
      },
      onError: (error) => {
        if (locationVersion.current !== version) return;
        setLocationError(error);
        setLocating(false);
      },
    });
  }

  async function toggleFavorite() {
    if (!account.user) {
      if (!account.configured) { setMessage("Sign-in is not connected yet. Browse the map and location details without an account."); return; }
      await account.signInWithGoogle();
      return;
    }
    if (!uid || !selected || favoriteBusy || libraryLoading) return;
    const owner = uid;
    const placeID = selected.id;
    const shouldSave = !favoriteIDs.includes(placeID);
    setFavoriteBusy(true);
    setMessage(null);
    try {
      await setFavorite(owner, placeID, shouldSave);
      if (currentUID.current !== owner) return;
      setLibrary((value) => value.uid === owner ? {
        ...value,
        favoriteIDs: shouldSave ? [...new Set([...value.favoriteIDs, placeID])] : value.favoriteIDs.filter((id) => id !== placeID),
      } : value);
    } catch (error) {
      if (currentUID.current === owner) setMessage(error instanceof Error ? error.message : "The saved place could not be updated. Please try again.");
    } finally {
      if (currentUID.current === owner) setFavoriteBusy(false);
    }
  }

  async function addNote(input: VisitNoteInput): Promise<boolean> {
    if (!uid || noteBusy) return false;
    const owner = uid;
    setNoteBusy(true);
    setMessage(null);
    let committed = false;
    try {
      await saveVisitNote(owner, input);
      committed = true;
      if (currentUID.current !== owner) return false;
      const result = await readLibrary(owner);
      if (currentUID.current !== owner) return false;
      setLibrary({ uid: owner, ...result });
      return true;
    } catch (error) {
      if (currentUID.current !== owner) return false;
      if (committed) {
        setLibraryError("Your note was saved to your account, but the list could not refresh. Use Retry loading to see it.");
        return true;
      }
      setMessage(error instanceof Error ? error.message : "Your note could not be saved. Your entered details are still here.");
      return false;
    } finally {
      if (currentUID.current === owner) setNoteBusy(false);
    }
  }

  async function removeNote(noteID: string): Promise<boolean> {
    if (!uid || noteBusy) return false;
    const owner = uid;
    setNoteBusy(true);
    setMessage(null);
    try {
      await deleteVisitNote(owner, noteID);
      if (currentUID.current !== owner) return false;
      setLibrary((value) => value.uid === owner ? { ...value, notes: value.notes.filter((note) => note.id !== noteID) } : value);
      return true;
    } catch (error) {
      if (currentUID.current === owner) setMessage(error instanceof Error ? error.message : "Your note could not be deleted. Please try again.");
      return false;
    } finally {
      if (currentUID.current === owner) setNoteBusy(false);
    }
  }

  return <div className="finder-app">
    <a className="skip-link" href="#finder-results">Skip to restroom list</a>
    <header className="finder-header">
      <Link href="/" className="finder-brand" aria-label="Restroom Ready home"><img src="/brand/lockup.svg" alt="Restroom Ready" width="224" height="42" /></Link>
      <nav className="finder-nav" aria-label="Main navigation"><Link href="/find/" aria-current="page"><MapPin size={16} />Find a restroom</Link><Link href="/">About the project <ArrowUpRight size={15} /></Link></nav>
      <FirebaseAccountButton className="finder-account-button" />
    </header>

    <main id="finder-main">
      <div className="finder-page-heading">
        <div><p className="finder-overline"><span className="finder-small-rule" />NYC / A more useful bathroom break</p><h1>Know before you go<span>.</span></h1></div>
        <p className="finder-heading-note"><strong>{restrooms.length.toLocaleString("en-US")} city-listed places</strong><br />A citywide NYC Open Data collection</p>
      </div>

      <section className="finder-tools" aria-label="Search and filter restrooms">
        <div className="finder-search"><Search size={20} /><label className="finder-sr-only" htmlFor="restroom-search">Search restroom locations</label><input id="restroom-search" type="search" placeholder="Search a place or location type" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedID(null); }} autoComplete="off" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={18} /></button>}</div>
        <div className="finder-filter-group" aria-label="Location type">
          {([ ["all", "All places"], ["Library", "Libraries"], ["Park", "Parks"], ["saved", "Saved"] ] as const).map(([value, label]) => <button type="button" key={value} onClick={() => void chooseFilter(value)} aria-pressed={filter === value} className={filter === value ? "is-active" : ""}>{value === "saved" && <Bookmark size={15} />}{label}</button>)}
        </div>
        <button type="button" className="finder-locate" onClick={locate} disabled={locating}><LocateFixed size={18} />{locating ? "Locating…" : "Locate me"}</button>
      </section>

      <div className="finder-data-banner"><Info size={17} /><p><strong>Know what’s known.</strong> NYC Open Data updated {sourceDateLabel}. Availability may have changed. Purchase requirements, restroom floors, and conditions are not reported.</p><a href={datasetSource.url} target="_blank" rel="noreferrer">View source <ArrowUpRight size={14} /></a></div>
      {(account.error || locationError || message || libraryError) && <div className="finder-feedback" role="status"><p>{locationError || account.error || message || libraryError}</p>{libraryError && <button type="button" className="finder-retry-button" onClick={() => setLibraryRetry((value) => value + 1)}>Retry loading</button>}<button type="button" onClick={() => { account.clearError(); setLocationError(null); setMessage(null); setLibraryError(null); }} aria-label="Dismiss message"><X size={18} /></button></div>}

      <div className="finder-mobile-view" aria-label="Results view"><button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")}><List size={18} />List</button><button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}><MapIcon size={18} />Map</button></div>

      <div className={`finder-workspace${selected ? " has-detail" : ""} view-${mobileView}`}>
        <section className="finder-list-panel" id="finder-results" aria-label="Restroom locations">
          <div className="finder-results-heading"><div><span className="finder-overline">Your starting point</span><p><MapPin size={15} />{userLocation ? "Your location" : "Columbia University"}</p></div><div className="finder-sort"><ArrowDownAZ size={16} /><label className="finder-sr-only" htmlFor="finder-sort">Sort locations</label><select id="finder-sort" value={sort} onChange={(event) => setSort(event.target.value as "distance" | "name")}><option value="distance">Distance</option><option value="name">Name A–Z</option></select></div></div>
          <div className="finder-results-meta"><span role="status">{places.length} {places.length === 1 ? "location" : "locations"}{filter === "saved" ? " saved" : " in this view"}</span><span>Straight-line distance</span></div>
          <div className="finder-result-scroll" ref={listScroll}>
            {places.length === 0 ? <div className="finder-empty"><Search size={25} /><h2>{filter === "saved" && libraryLoading ? "Loading your saved places…" : filter === "saved" ? "Your saved places will live here." : "No matching locations."}</h2><p>{filter === "saved" ? "Save a location from its detail sheet to find it again." : "Try a place name or location type, or clear your filters. This collection includes city-listed locations across NYC."}</p><button className="finder-text-button" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Show all locations <ChevronRight size={16} /></button></div> : <ol className="finder-results-list">{places.slice(0, listLimit).map(({ place, distance }, index) => <li key={place.id}><button className={`finder-result${selectedID === place.id ? " is-selected" : ""}`} type="button" data-place-id={place.id} onClick={() => selectPlace(place.id)} aria-controls="restroom-details" aria-expanded={selectedID === place.id}><span className="finder-result-index">{String(index + 1).padStart(2, "0")}</span><span className="finder-result-content"><span className="finder-result-category">{place.locationType} <span>·</span> {formatDistance(distance)}</span><strong>{place.name}</strong><span className="finder-result-operator">{place.operator ?? "Operator not reported"}</span><span className="finder-result-unknown">Purchase · Floor · Conditions <span>Not reported</span></span></span><span className="finder-result-end">{favoriteIDs.includes(place.id) ? <Bookmark size={17} fill="currentColor" aria-label="Saved" /> : <ChevronRight size={18} />}</span></button></li>)}</ol>}
            {places.length > 0 && <div className="finder-more-results"><p role="status">Showing {Math.min(listLimit, places.length).toLocaleString("en-US")} of {places.length.toLocaleString("en-US")} locations</p>{listLimit < places.length && <button type="button" className="finder-secondary-button" onClick={() => setListLimit((value) => value + LIST_PAGE_SIZE)}>Show {Math.min(LIST_PAGE_SIZE, places.length - listLimit)} more</button>}</div>}
          </div>
          <p className="finder-list-foot"><Info size={14} />Hours and entry rules can change. Check details before going.</p>
        </section>

        <section className="finder-map-panel" aria-label="Map view"><RestroomMap places={mapPlaces} selectedID={selectedID} onSelect={selectPlace} userLocation={userLocation} locationRequestID={locationRequestID} /><div className="finder-area-label"><span className="finder-overline">The city collection</span><strong>New York City</strong><span>City-listed places. Details worth checking.</span></div></section>

        {selected && <RestroomDetail restroom={selected} distance={distanceMeters(origin, selected)} originLabel={originLabel} userLocation={userLocation} saved={favoriteIDs.includes(selected.id)} saving={favoriteBusy || libraryLoading} onToggleFavorite={() => void toggleFavorite()} onClose={closePlace} feedback={account.error || message || libraryError} onRetryLibrary={libraryError ? () => setLibraryRetry((value) => value + 1) : undefined} personalContent={<PersonalNotes key={`${uid ?? "signed-out"}:${selected.id}`} placeID={selected.id} signedIn={Boolean(uid)} configured={account.configured} loading={account.loading || libraryLoading} saving={noteBusy} notes={privateNotes.filter((note) => note.placeID === selected.id)} onSignIn={() => void account.signInWithGoogle()} onSave={addNote} onDelete={removeNote} />} />}
      </div>
      <footer className="finder-footer"><p>NYC Open Data · {restrooms.length} locations in this collection · Source details are dated.</p><div><Link href="/privacy/">Privacy</Link><Link href="/">About Restroom Ready <ArrowUpRight size={14} /></Link></div></footer>
    </main>
  </div>;
}
