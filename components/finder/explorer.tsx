"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, ArrowUpRight, Bookmark, ChevronRight, Info, List, LocateFixed, Map as MapIcon, MapPin, Plus, Search, X } from "lucide-react";
import { FirebaseAccountButton, useFirebaseAccount } from "@/components/firebase-account";
import { PersonalNotes, RestroomDetail } from "@/components/finder/detail";
import { RestroomRatings } from "@/components/finder/ratings";
import { LogRestroomForm } from "@/components/finder/log-restroom";
import { PasscodePanel } from "@/components/finder/passcode-panel";
import { LockFinderButton } from "@/components/finder/lock-finder";
import { COMMUNITY_FEED_LIMIT, communityRestroomToPlace, createCommunityRestroom, watchCommunityRestrooms, type LogRestroomInput, type CommunityRestroomRecord } from "@/lib/community-restrooms";
import { datasetSource, distanceMeters, formatDistance, isWithinCollection, matchesRestroom, restrooms, sourceDateLabel, type Coordinates } from "@/lib/restrooms";
import { deleteVisitNote, readLibrary, saveVisitNote, setFavorite, type VisitNote, type VisitNoteInput } from "@/lib/user-data";
import { locationAvailabilityError, requestBrowserLocation } from "@/lib/location";
import { FILTER_HELP, FILTER_OPTIONS, matchesRestroomFilter, type RestroomFilter } from "@/lib/restroom-filters";
import { readOwnRating, setRating, watchRatingSummaries, type OwnRating, type RatingSummary } from "@/lib/ratings";

const RestroomMap = dynamic(() => import("@/components/finder/map"), {
  ssr: false,
  loading: () => <div className="finder-map-loading" role="status">Loading the map…</div>,
});

const LIST_PAGE_SIZE = 50;

export function RestroomExplorer() {
  const account = useFirebaseAccount();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RestroomFilter>("all");
  const [sort, setSort] = useState<"distance" | "name">("name");
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const listScroll = useRef<HTMLDivElement | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationRequestID, setLocationRequestID] = useState(0);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [communityRecords, setCommunityRecords] = useState<CommunityRestroomRecord[]>([]);
  const [confirmedSubmissions, setConfirmedSubmissions] = useState<CommunityRestroomRecord[]>([]);
  const [communityLoading, setCommunityLoading] = useState(true);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityRetry, setCommunityRetry] = useState(0);
  const [showLogForm, setShowLogForm] = useState(false);
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const logButton = useRef<HTMLButtonElement | null>(null);
  const logOperation = useRef(0);
  const logInFlight = useRef(false);
  const [library, setLibrary] = useState<{ uid: string | null; favoriteIDs: string[]; notes: VisitNote[] }>({ uid: null, favoriteIDs: [], notes: [] });
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryRetry, setLibraryRetry] = useState(0);
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [ratings, setRatings] = useState<Record<string, RatingSummary>>({});
  const [ratingsLoading, setRatingsLoading] = useState(true);
  const [ratingsError, setRatingsError] = useState<string | null>(null);
  const [ratingsRetry, setRatingsRetry] = useState(0);
  const [ownRating, setOwnRating] = useState<{ uid: string; placeID: string; rating: OwnRating | null } | null>(null);
  const [ownRatingLoading, setOwnRatingLoading] = useState(false);
  const [ownRatingError, setOwnRatingError] = useState<string | null>(null);
  const [ratingBusy, setRatingBusy] = useState(false);
  const ratingOperation = useRef(0);
  const currentPlaceID = useRef(selectedID);
  currentPlaceID.current = selectedID;
  const lastFocusedControl = useRef<HTMLElement | null>(null);
  const cancelLocation = useRef<(() => void) | null>(null);
  const locationVersion = useRef(0);
  const uid = account.user?.uid ?? null;
  const currentUID = useRef(uid);
  currentUID.current = uid;
  const favoriteIDs = useMemo(() => library.uid === uid && uid ? library.favoriteIDs : [], [library, uid]);
  const savedIDs = useMemo(() => new Set(favoriteIDs), [favoriteIDs]);
  const privateNotes = library.uid === uid && uid ? library.notes : [];

  useEffect(() => {
    let active = true;
    setCommunityLoading(true);
    setCommunityError(null);
    const unsubscribe = watchCommunityRestrooms((records) => {
      if (!active) return;
      setCommunityRecords(records);
      setCommunityLoading(false);
      setCommunityError(null);
    }, (error) => {
      if (!active) return;
      setCommunityLoading(false);
      setCommunityError(error.message);
    });
    return () => { active = false; unsubscribe(); };
  }, [communityRetry]);

  useEffect(() => {
    logOperation.current += 1;
    logInFlight.current = false;
    setLogBusy(false);
    setLogError(null);
  }, [uid]);

  const communityPlaces = useMemo(() => {
    const records = new Map(communityRecords.map((record) => [record.id, record]));
    for (const record of confirmedSubmissions) records.set(record.id, record);
    return [...records.values()].map(communityRestroomToPlace);
  }, [communityRecords, confirmedSubmissions]);
  const allRestrooms = useMemo(() => [...restrooms, ...communityPlaces], [communityPlaces]);

  useEffect(() => {
    let active = true;
    setRatingsLoading(true);
    setRatingsError(null);
    const unsubscribe = watchRatingSummaries((next) => {
      if (!active) return;
      setRatings(next);
      setRatingsLoading(false);
      setRatingsError(null);
    }, (error) => {
      if (!active) return;
      setRatings({});
      setRatingsLoading(false);
      setRatingsError(error.message);
    });
    return () => { active = false; unsubscribe(); };
  }, [ratingsRetry]);

  useEffect(() => {
    let active = true;
    ratingOperation.current += 1;
    setOwnRating(null);
    setOwnRatingError(null);
    setRatingBusy(false);
    if (!uid || !selectedID) { setOwnRatingLoading(false); return; }
    setOwnRatingLoading(true);
    readOwnRating(uid, selectedID).then((rating) => {
      if (active) setOwnRating({ uid, placeID: selectedID, rating });
    }).catch((error: unknown) => {
      if (active) setOwnRatingError(error instanceof Error ? error.message : "Your rating could not be loaded. Please retry.");
    }).finally(() => { if (active) setOwnRatingLoading(false); });
    return () => { active = false; };
  }, [uid, selectedID, ratingsRetry]);

  async function saveRating(stars: number | null): Promise<boolean> {
    if (!uid || !selectedID || ratingBusy || ownRatingLoading || ownRatingError || ownRating?.uid !== uid || ownRating.placeID !== selectedID) return false;
    const owner = uid;
    const placeID = selectedID;
    const operation = ++ratingOperation.current;
    const isCurrent = () => currentUID.current === owner && currentPlaceID.current === placeID && ratingOperation.current === operation;
    setRatingBusy(true);
    setOwnRatingError(null);
    setMessage(null);
    let committed = false;
    try {
      await setRating(owner, placeID, stars);
      committed = true;
      const rating = await readOwnRating(owner, placeID);
      if (!isCurrent()) return false;
      setOwnRating({ uid: owner, placeID, rating });
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      if (committed) {
        setOwnRating(null);
        setOwnRatingError("Your rating change was saved, but your rating could not refresh. Retry loading it before making another change.");
        return true;
      }
      setMessage(error instanceof Error ? error.message : "Your rating could not be saved. Please retry.");
      return false;
    } finally { if (isCurrent()) setRatingBusy(false); }
  }

  useEffect(() => () => {
    locationVersion.current += 1;
    ratingOperation.current += 1;
    logOperation.current += 1;
    cancelLocation.current?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLibrary((value) => value.uid === uid ? value : { uid, favoriteIDs: [], notes: [] });
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

  const places = useMemo(() => allRestrooms.filter((place) => matchesRestroom(place, query)
    && matchesRestroomFilter({ ...place, cleanlinessRating: !ratingsLoading && !ratingsError && ratings[place.id]
      ? { average: ratings[place.id].average, ratingCount: ratings[place.id].ratingCount, sourceUrl: "https://nyc.imfinethanku.me/find/" }
      : null }, filter, savedIDs))
    .map((place) => ({ place, distance: userLocation ? distanceMeters(userLocation, place) : null }))
    .sort((a, b) => sort === "distance" && userLocation ? (a.distance ?? 0) - (b.distance ?? 0) : a.place.name.localeCompare(b.place.name)),
  [allRestrooms, query, filter, savedIDs, userLocation, sort, ratings, ratingsLoading, ratingsError]);
  const mapPlaces = useMemo(() => places.map(({ place }) => place), [places]);
  const selected = allRestrooms.find((place) => place.id === selectedID);

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
    if (!selectedID || showLogForm) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closePlace();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedID, closePlace, showLogForm]);

  function closeLogForm() {
    if (logInFlight.current) return;
    setShowLogForm(false);
    setLogError(null);
    requestAnimationFrame(() => logButton.current?.focus());
  }

  const reflectPrivateSave = useCallback((owner: string, placeID: string) => {
    if (currentUID.current !== owner) return;
    // Called only after the atomic code + saved-place write is confirmed.
    setLibrary((value) => value.uid === owner ? {
      ...value, favoriteIDs: [...new Set([...value.favoriteIDs, placeID])],
    } : value);
    setLibraryRetry((value) => value + 1);
  }, []);

  async function logRestroom(input: LogRestroomInput, requestID: string): Promise<boolean> {
    if (!uid || logInFlight.current) return false;
    const owner = uid;
    const operation = ++logOperation.current;
    const isCurrent = () => currentUID.current === owner && logOperation.current === operation;
    logInFlight.current = true;
    setLogBusy(true);
    setLogError(null);
    try {
      const record = await createCommunityRestroom(owner, input, requestID);
      if (!isCurrent()) return false;
      setConfirmedSubmissions((records) => [...records.filter((item) => item.id !== record.id), record]);
      if (input.passcode?.visibility === "private") reflectPrivateSave(owner, record.id);
      setQuery("");
      setFilter("all");
      setShowLogForm(false);
      setMessage("Restroom logged. Your visitor-submitted location is now public; its details have not been independently checked.");
      selectPlace(record.id);
      return true;
    } catch (error) {
      if (isCurrent()) setLogError(error instanceof Error ? error.message : "Your submission could not be confirmed. Your details are still here; please retry.");
      return false;
    } finally {
      if (isCurrent()) { logInFlight.current = false; setLogBusy(false); }
    }
  }

  async function chooseFilter(next: RestroomFilter) {
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
        setSort("distance");
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

  const emptyTitle = filter === "saved"
    ? libraryLoading ? "Loading your saved places…" : libraryError ? "Saved places could not load." : "No saved places yet."
    : filter === "clean" ? ratingsLoading ? "Loading cleanliness ratings…" : ratingsError ? "Cleanliness ratings could not load." : "No locations with 4★+ cleanliness ratings." : "No matching locations.";
  const emptyDescription = filter === "saved"
    ? libraryError ? "Retry loading your saved places using the message above." : "Save a location from its detail sheet to find it again."
    : filter === "clean"
      ? ratingsLoading ? "Loading public community ratings. You can keep browsing with ALL."
        : ratingsError ? "Retry loading community ratings below, or choose ALL to browse the city listings."
          : "This filter needs a community cleanliness average of at least 4 out of 5. Unrated places are not treated as clean."
      : "Try a place name or location type, change the filter, or clear your search.";

  return <div className="finder-app">
    <a className="skip-link" href="#finder-results">Skip to restroom list</a>
    <header className="finder-header">
      <Link href="/" className="finder-brand" aria-label="Restroom Ready home"><img src="/brand/lockup.svg" alt="Restroom Ready" width="224" height="42" /></Link>
      <nav className="finder-nav" aria-label="Main navigation"><Link href="/find/" aria-current="page"><MapPin size={16} />Find a restroom</Link><Link href="/">About the project <ArrowUpRight size={15} /></Link></nav>
      <div className="finder-access-controls"><FirebaseAccountButton className="finder-account-button" /><LockFinderButton/></div>
    </header>

    <main id="finder-main">
      <div className="finder-page-heading">
        <div><p className="finder-overline"><span className="finder-small-rule" />NYC / A more useful bathroom break</p><h1>Know before you go<span>.</span></h1></div>
        <div className="finder-log-heading-actions"><p className="finder-heading-note"><strong>{restrooms.length.toLocaleString("en-US")} city-listed places{communityPlaces.length > 0 ? ` + ${communityPlaces.length.toLocaleString("en-US")} visitor submissions` : ""}</strong><br />Dated sources and visitor reports</p>
          <button type="button" ref={logButton} className="finder-secondary-button finder-log-open" onClick={() => { setLogError(null); account.clearError(); setShowLogForm(true); }} aria-haspopup="dialog"><Plus size={18} />Log a restroom</button></div>
      </div>

      <section className="finder-tools" aria-label="Search and filter restrooms">
        <div className="finder-search"><Search size={20} /><label className="finder-sr-only" htmlFor="restroom-search">Search restroom locations</label><input id="restroom-search" type="search" placeholder="Search a place or location type" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedID(null); }} autoComplete="off" />{query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={18} /></button>}</div>
        <div className="finder-filter-group" role="group" aria-label="Restroom filters" aria-describedby="finder-filter-help">
          {FILTER_OPTIONS.map(({value, label}) => <button type="button" key={value} onClick={() => void chooseFilter(value)} aria-pressed={filter === value} aria-label={value === "clean" ? "Clean, 4 stars and above" : label} className={filter === value ? "is-active" : ""}>{value === "saved" && <Bookmark size={15} />}{label}</button>)}
        </div>
        <button type="button" className="finder-locate" onClick={locate} disabled={locating}><LocateFixed size={18} />{locating ? "Locating…" : "Locate me"}</button>
      </section>

      <p className="finder-filter-help" id="finder-filter-help" aria-live="polite">{FILTER_HELP[filter]}</p>

      {communityLoading && <p className="finder-filter-help" role="status">Loading visitor-submitted locations… City listings are available below.</p>}
      {communityError && <div className="finder-feedback" role="status"><p>{communityError} {communityPlaces.length ? "Previously loaded visitor reports are still shown." : "City listings are still available."}</p><button type="button" className="finder-retry-button" onClick={() => setCommunityRetry((value) => value + 1)}>Retry visitor locations</button></div>}
      {communityRecords.length >= COMMUNITY_FEED_LIMIT && <p className="finder-filter-help">Showing the {COMMUNITY_FEED_LIMIT.toLocaleString("en-US")} most recent visitor submissions alongside the city collection.</p>}

      {ratingsError && <div className="finder-feedback" role="status"><p>{ratingsError}</p><button type="button" className="finder-retry-button" onClick={() => setRatingsRetry((value) => value + 1)}>Retry ratings</button></div>}

      <div className="finder-data-banner"><Info size={17} /><p><strong>Know what’s known.</strong> NYC Open Data updated {sourceDateLabel}. Visitor submissions carry their own dates and labels. Neither source confirms current availability; missing details stay “Not reported.”</p><a href={datasetSource.url} target="_blank" rel="noreferrer">View city source <ArrowUpRight size={14} /></a></div>
      {(account.error || locationError || message || libraryError) && <div className="finder-feedback" role="status"><p>{locationError || account.error || message || libraryError}</p>{libraryError && <button type="button" className="finder-retry-button" onClick={() => setLibraryRetry((value) => value + 1)}>Retry loading</button>}<button type="button" onClick={() => { account.clearError(); setLocationError(null); setMessage(null); setLibraryError(null); }} aria-label="Dismiss message"><X size={18} /></button></div>}

      <div className="finder-mobile-view" aria-label="Results view"><button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")}><List size={18} />List</button><button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}><MapIcon size={18} />Map</button></div>

      <div className={`finder-workspace${selected ? " has-detail" : ""} view-${mobileView}`}>
        <section className="finder-list-panel" id="finder-results" aria-label="Restroom locations">
          <div className="finder-results-heading"><div className="finder-sort"><ArrowDownAZ size={16} /><label className="finder-sr-only" htmlFor="finder-sort">Sort locations</label><select id="finder-sort" value={sort} onChange={(event) => setSort(event.target.value as "distance" | "name")}><option value="distance" disabled={!userLocation}>Distance</option><option value="name">Name A–Z</option></select></div></div>
          <div className="finder-results-meta"><span role="status">{places.length} {places.length === 1 ? "location" : "locations"}{filter === "saved" ? " saved" : " in this view"}</span>{userLocation && <span>Straight-line from your location</span>}</div>
          <div className="finder-result-scroll" ref={listScroll}>
            {places.length === 0 ? <div className="finder-empty"><Search size={25} /><h2>{emptyTitle}</h2><p>{emptyDescription}</p><button className="finder-text-button" type="button" onClick={() => { setQuery(""); setFilter("all"); }}>Show all locations <ChevronRight size={16} /></button></div> : <ol className="finder-results-list">{places.slice(0, listLimit).map(({ place, distance }, index) => <li key={place.id}><button className={`finder-result${selectedID === place.id ? " is-selected" : ""}`} type="button" data-place-id={place.id} onClick={() => selectPlace(place.id)} aria-controls="restroom-details" aria-expanded={selectedID === place.id}><span className="finder-result-index">{String(index + 1).padStart(2, "0")}</span><span className="finder-result-content"><span className="finder-result-category">{place.locationType}{distance !== null && <> <span>·</span> {formatDistance(distance)}</>}</span><strong>{place.name}</strong><span className="finder-result-operator">{place.communitySource ? "Visitor-submitted · Not independently checked" : place.operator ?? "Operator not reported"}</span><span className="finder-result-rating">{ratingsLoading ? "Loading ratings…" : ratingsError ? "Ratings unavailable" : ratings[place.id] ? `${ratings[place.id].average.toFixed(1)} / 5 · ${ratings[place.id].ratingCount} cleanliness ${ratings[place.id].ratingCount === 1 ? "rating" : "ratings"}` : "No cleanliness ratings yet"}</span>{filter === "accessible" && place.accessNotes && <span className="finder-result-access-note"><strong>Access note:</strong> {place.accessNotes}</span>}<span className="finder-result-unknown">Purchase · Floor · Conditions <span>Not reported</span></span></span><span className="finder-result-end">{favoriteIDs.includes(place.id) ? <Bookmark size={17} fill="currentColor" aria-label="Saved" /> : <ChevronRight size={18} />}</span></button></li>)}</ol>}
            {places.length > 0 && <div className="finder-more-results"><p role="status">Showing {Math.min(listLimit, places.length).toLocaleString("en-US")} of {places.length.toLocaleString("en-US")} locations</p>{listLimit < places.length && <button type="button" className="finder-secondary-button" onClick={() => setListLimit((value) => value + LIST_PAGE_SIZE)}>Show {Math.min(LIST_PAGE_SIZE, places.length - listLimit)} more</button>}</div>}
          </div>
          <p className="finder-list-foot"><Info size={14} />Hours and entry rules can change. Check details before going.</p>
        </section>

        <section className="finder-map-panel" aria-label="Map view"><RestroomMap places={mapPlaces} selectedID={selectedID} onSelect={selectPlace} userLocation={userLocation} locationRequestID={locationRequestID} /><div className="finder-area-label"><span className="finder-overline">NYC restroom map</span><strong>New York City</strong><span>City listings and visitor reports.</span></div></section>

        {selected && <RestroomDetail restroom={selected} distance={userLocation ? distanceMeters(userLocation, selected) : null} userLocation={userLocation} saved={favoriteIDs.includes(selected.id)} saving={favoriteBusy || libraryLoading} onToggleFavorite={() => void toggleFavorite()} onClose={closePlace} passcodeContent={<PasscodePanel key={`${uid ?? "signed-out"}:${selected.id}`} placeID={selected.id} uid={uid} accountLoading={account.loading} authError={account.error} onSignIn={() => void account.signInWithGoogle()} onPrivateSaved={reflectPrivateSave} />} ratingContent={<RestroomRatings key={`${uid ?? "signed-out"}:${selected.id}`} summary={ratings[selected.id] ?? null} publicLoading={ratingsLoading} publicError={ratingsError} ownRating={ownRating?.uid === uid && ownRating.placeID === selected.id ? ownRating.rating : null} ownLoading={ownRatingLoading || Boolean(uid && (!ownRating || ownRating.uid !== uid || ownRating.placeID !== selected.id) && !ownRatingError)} ownError={ownRatingError} signedIn={Boolean(uid)} authLoading={account.loading} configured={account.configured} saving={ratingBusy} onSignIn={() => void account.signInWithGoogle()} onSave={saveRating} onRetry={() => setRatingsRetry((value) => value + 1)} />} feedback={account.error || message || libraryError} onRetryLibrary={libraryError ? () => setLibraryRetry((value) => value + 1) : undefined} personalContent={<PersonalNotes key={`${uid ?? "signed-out"}:${selected.id}`} placeID={selected.id} signedIn={Boolean(uid)} configured={account.configured} loading={account.loading || libraryLoading} saving={noteBusy} notes={privateNotes.filter((note) => note.placeID === selected.id)} onSignIn={() => void account.signInWithGoogle()} onSave={addNote} onDelete={removeNote} />} />}
      </div>
      <footer className="finder-footer"><p>NYC Open Data · {restrooms.length} city-listed locations · {communityPlaces.length} visitor submissions loaded · Source details are dated.</p><div><Link href="/privacy/">Privacy</Link><Link href="/">About Restroom Ready <ArrowUpRight size={14} /></Link></div></footer>
    </main>
    {showLogForm && <LogRestroomForm key={uid ?? "signed-out"} uid={uid} accountLoading={account.loading} authBusy={account.loading} saving={logBusy} initialCoordinates={userLocation} authError={account.error} submitError={logError} onSignIn={() => void account.signInWithGoogle()} onSubmit={logRestroom} onClose={closeLogForm} />}
  </div>;
}
