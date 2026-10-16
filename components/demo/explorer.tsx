"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Bookmark, ChevronRight, Info, List, LocateFixed, Map as MapIcon, MapPin, Plus, RotateCcw, Search, X } from "lucide-react";
import { AddDemoRestroom } from "@/components/demo/add-restroom";
import { DemoDetail } from "@/components/demo/detail";
import { addDemoVenue, createDemoState, deleteDemoCode, demoRating, matchesDemoFilter, rateDemoVenue, saveDemoCode, saveDemoNote, toggleDemoSaved, verifyDemoCode, type DemoFilter, type DemoVenueInput, type DemoVisibility } from "@/lib/demo-state";
import { locationAvailabilityError, requestBrowserLocation, type LocationCoordinates } from "@/lib/location";

const DemoMap = dynamic(() => import("@/components/demo/map"), { ssr: false, loading: () => <div className="finder-map-loading" role="status">Loading the map…</div> });
const filters = [{ value: "all", label: "ALL" }, { value: "public", label: "Public" }, { value: "clean", label: "Clean (4★+)" }, { value: "accessible", label: "Accessible" }, { value: "saved", label: "Saved" }] as const;
const filterHelp: Record<DemoFilter, string> = {
  all: "Explore the sample, then try saving, rating, codes, or adding a local example.",
  public: "Sample locations marked Public. This is an example entry attribute.",
  clean: "Sample cleanliness averages of 4 or above. Try a rating to see the result change.",
  accessible: "Sample locations marked Accessible. Restroom routes and stall features remain unreported.",
  saved: "Places you save in this demo session. Saving a private code also saves its location.",
};

export function DemoExplorer() {
  const [data, setData] = useState(createDemoState);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DemoFilter>("all");
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [mapFocusID, setMapFocusID] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [userLocation, setUserLocation] = useState<LocationCoordinates | null>(null);
  const [locating, setLocating] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const cancelLocation = useRef<(() => void) | null>(null);
  const locationVersion = useRef(0);
  const logButton = useRef<HTMLButtonElement>(null);
  const places = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("en-US");
    return data.venues.filter((venue) => matchesDemoFilter(venue, filter) && (!search || `${venue.name} ${venue.address} ${venue.added ? "local sample" : "store"}`.toLocaleLowerCase("en-US").includes(search)));
  }, [data, query, filter]);
  const selected = places.find((venue) => venue.id === selectedID) ?? null;

  const selectPlace = useCallback((id: string) => { setSelectedID(id); setMapFocusID(id); }, []);
  const closePlace = useCallback(() => {
    setSelectedID(null);
    requestAnimationFrame(() => document.getElementById("demo-search")?.focus({ preventScroll: true }));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => {
      const detail = document.getElementById("demo-location-details");
      detail?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 650px)").matches) detail?.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedID, selected?.id]);

  useEffect(() => {
    if (!selected || showAdd) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closePlace(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected, showAdd, closePlace]);
  useEffect(() => () => { locationVersion.current += 1; cancelLocation.current?.(); }, []);

  function locate() {
    if (locating) return;
    const unavailable = locationAvailabilityError({ secureContext: window.isSecureContext !== false, hasGeolocation: Boolean(navigator.geolocation) });
    if (unavailable) { setMessage(unavailable); return; }
    cancelLocation.current?.();
    const version = ++locationVersion.current;
    setLocating(true); setMessage(null);
    cancelLocation.current = requestBrowserLocation({ geolocation: navigator.geolocation,
      onSuccess: (location) => { if (locationVersion.current !== version) return; setUserLocation(location); setLocating(false); setMessage("Your approximate location is shown for this session. The sample venue stays the same."); },
      onError: (error) => { if (locationVersion.current === version) { setLocating(false); setMessage(error); } },
    });
  }

  function reset() {
    locationVersion.current += 1; cancelLocation.current?.();
    setData(createDemoState()); setQuery(""); setFilter("all"); setSelectedID(null); setMapFocusID(null); setMobileView("list"); setShowAdd(false); setUserLocation(null); setLocating(false); setMapVersion((value) => value + 1); setMessage("Demo reset. The original sample and 3434 code are restored.");
  }

  function closeAdd() { setShowAdd(false); requestAnimationFrame(() => logButton.current?.focus()); }
  function add(input: DemoVenueInput): boolean {
    try {
      const next = addDemoVenue(data, input, new Date().toISOString());
      const venue = next.venues[next.venues.length - 1];
      setData(next); setQuery(""); setFilter("all"); setShowAdd(false); selectPlace(venue.id); setMessage("Local sample added to this demo session."); return true;
    } catch { return false; }
  }

  function code(value: string, visibility: DemoVisibility): boolean {
    if (!selected) return false;
    try { setData(saveDemoCode(data, selected.id, value, visibility, new Date().toISOString())); setMessage("Your demo code was saved. Its visibility applies within this demo only."); return true; }
    catch { setMessage("Check the code: use 1–40 standard letters, numbers, or symbols."); return false; }
  }

  return <div className="finder-app demo-app">
    <a className="skip-link" href="#demo-results">Skip to sample list</a>
    <header className="finder-header"><Link href="/" className="finder-brand" aria-label="Restroom Ready home"><img src="/brand/lockup.svg" alt="Restroom Ready" width="224" height="42" /></Link><nav className="finder-nav" aria-label="Main navigation"><Link href="/demo/" aria-current="page"><MapPin size={16} />Interactive demo</Link><Link href="/">About the project <ArrowUpRight size={15} /></Link></nav><Link href="/#join" className="demo-waitlist-link">Get updates <ArrowUpRight size={15} /></Link></header>
    <div className="demo-banner"><p><strong>Interactive demo</strong> · Sample data. Changes stay in this session.</p><button type="button" onClick={reset}><RotateCcw size={15} />Reset demo</button></div>
    <main id="demo-main">
      <div className="finder-page-heading"><div><p className="finder-overline"><span className="finder-small-rule" />NYC / Try it for yourself</p><h1>Know before you go<span>.</span></h1></div><div className="finder-log-heading-actions"><p className="finder-heading-note"><strong>{data.venues.length} sample {data.venues.length === 1 ? "location" : "locations"}</strong><br />Start with Target Herald Square</p><button type="button" ref={logButton} className="finder-secondary-button finder-log-open" aria-haspopup="dialog" onClick={() => setShowAdd(true)}><Plus size={18} />Log a restroom</button></div></div>
      <section className="finder-tools" aria-label="Search and filter sample restrooms"><div className="finder-search"><Search size={20} /><label className="finder-sr-only" htmlFor="demo-search">Search restroom locations</label><input id="demo-search" type="search" placeholder="Search the sample locations" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedID(null); }} />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={18} /></button>}</div><div className="finder-filter-group" role="group" aria-label="Restroom filters" aria-describedby="demo-filter-help">{filters.map(({ value, label }) => <button type="button" key={value} aria-pressed={filter === value} aria-label={value === "clean" ? "Clean, 4 stars and above" : label} className={filter === value ? "is-active" : ""} onClick={() => { setFilter(value); setSelectedID(null); }}>{value === "saved" && <Bookmark size={15} />}{label}</button>)}</div><button type="button" className="finder-locate" disabled={locating} onClick={locate}><LocateFixed size={18} />{locating ? "Locating…" : "Locate me"}</button></section>
      <p className="finder-filter-help" id="demo-filter-help" aria-live="polite">{filterHelp[filter]}</p>
      <div className="finder-data-banner"><Info size={17} /><p><strong>Try the actions.</strong> Open the sample, save it, rate it, or edit the 3434 code. These examples do not establish the real store’s restroom access or conditions. Reloading resets the demo.</p></div>
      {message && <div className="finder-feedback" role="status"><p>{message}</p><button type="button" aria-label="Dismiss message" onClick={() => setMessage(null)}><X size={18} /></button></div>}
      <div className="finder-mobile-view" aria-label="Results view"><button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")}><List size={18} />List</button><button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}><MapIcon size={18} />Map</button></div>
      <div className={`finder-workspace${selected ? " has-detail" : ""} view-${mobileView}`}>
        <section className="finder-list-panel" id="demo-results" aria-label="Sample restroom locations"><div className="finder-results-heading"><span className="demo-list-label">Explore the sample</span></div><div className="finder-results-meta"><span role="status">{places.length} {places.length === 1 ? "location" : "locations"} {filter === "saved" ? "saved" : "in this view"}</span><span>Example data</span></div><div className="finder-result-scroll">{places.length === 0 ? <div className="finder-empty"><Search size={25} /><h2>{filter === "saved" ? "No saved places yet." : "No matching samples."}</h2><p>{filter === "saved" ? "Save the sample from its detail sheet to find it here." : "Try ALL, clear the search, or change your demo rating."}</p><button type="button" className="finder-text-button" onClick={() => { setFilter("all"); setQuery(""); }}>Show all samples <ChevronRight size={16} /></button></div> : <ol className="finder-results-list">{places.map((venue, index) => { const rating = demoRating(venue); return <li key={venue.id}><button type="button" className={`finder-result${selectedID === venue.id ? " is-selected" : ""}`} aria-controls="demo-location-details" aria-expanded={selectedID === venue.id} data-place-id={venue.id} onClick={() => selectPlace(venue.id)}><span className="finder-result-index">{String(index + 1).padStart(2, "0")}</span><span className="finder-result-content"><span className="finder-result-category">{venue.added ? "Local sample" : "Store · sample"}</span><strong>{venue.name}</strong><span className="finder-result-operator">{venue.address}</span><span className="finder-result-rating">{rating.average === null ? "No sample ratings yet" : `${rating.average.toFixed(1)} / 5 · ${rating.count} sample ratings`}</span><span className="finder-result-unknown">{venue.isPublic ? "Public · example" : "Entry not reported"} <span>{venue.isAccessible ? "Accessible · example" : "Route not reported"}</span></span></span><span className="finder-result-end">{venue.saved ? <Bookmark size={17} fill="currentColor" aria-label="Saved" /> : <ChevronRight size={18} />}</span></button></li>; })}</ol>}</div><p className="finder-list-foot"><Info size={14} />Sample attributes, not current restroom reports.</p></section>
        <section className="finder-map-panel" aria-label="Map view"><DemoMap key={mapVersion} venues={places} selectedID={mapFocusID} onSelect={selectPlace} userLocation={userLocation} /><div className="finder-area-label"><span className="finder-overline">Interactive demo</span><strong>Herald Square</strong><span>Sample pins and reports.</span></div></section>
        {selected && <DemoDetail key={selected.id} venue={selected} onClose={closePlace} onShowMap={() => { setMobileView("map"); setSelectedID(null); }} onSave={() => { setData(toggleDemoSaved(data, selected.id)); setMessage(selected.saved ? "Removed from your demo Saved list." : "Added to your demo Saved list."); }} onRate={(stars) => { setData(rateDemoVenue(data, selected.id, stars)); setMessage(stars === null ? "Your sample rating was removed." : "Your sample rating was saved."); }} onCode={code} onVerify={() => { setData(verifyDemoCode(data, selected.id, new Date().toISOString())); setMessage("Demo verification time updated. No real visit is being recorded."); }} onDeleteCode={() => { setData(deleteDemoCode(data, selected.id)); setMessage("Your demo code was deleted. Saved places are unchanged."); }} onNote={(note) => { setData(saveDemoNote(data, selected.id, note)); setMessage(note.trim() ? "Demo note saved for this session." : "Demo note removed."); }} />}
      </div>
      <footer className="finder-footer"><p>Interactive sample · Changes reset on reload.</p><div><Link href="/privacy/">Privacy</Link><Link href="/">About Restroom Ready <ArrowUpRight size={14} /></Link></div></footer>
    </main>
    {showAdd && <AddDemoRestroom onAdd={add} onClose={closeAdd} />}
  </div>;
}
