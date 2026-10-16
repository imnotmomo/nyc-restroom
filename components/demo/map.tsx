"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DemoVenue } from "@/lib/demo-state";

export default function DemoMap({ venues, selectedID, onSelect, userLocation }: {
  venues: DemoVenue[];
  selectedID: string | null;
  onSelect: (id: string) => void;
  userLocation: { latitude: number; longitude: number } | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const markers = useRef<Leaflet.LayerGroup | null>(null);
  const locationMarker = useRef<Leaflet.CircleMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      leaflet.current = L;
      const instance = L.map(container.current, { zoomControl: false, scrollWheelZoom: true, fadeAnimation: false, zoomAnimation: false }).setView([40.749814, -73.989081], 16);
      map.current = instance;
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on("tileerror", () => { if (!cancelled) setError("Map tiles could not load. The sample list and actions still work."); })
        .on("tileload", () => { if (!cancelled) setError(null); }).addTo(instance);
      markers.current = L.layerGroup().addTo(instance);
      resize = new ResizeObserver(() => instance.invalidateSize({ animate: false }));
      resize.observe(container.current);
      setReady(true);
    }).catch(() => { if (!cancelled) setError("The map could not load. The sample list and actions still work."); });
    return () => { cancelled = true; resize?.disconnect(); map.current?.remove(); map.current = null; markers.current = null; };
  }, []);

  useEffect(() => {
    const L = leaflet.current, layer = markers.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    for (const venue of venues) {
      const marker = L.marker([venue.latitude, venue.longitude], {
        keyboard: true, title: venue.name, alt: venue.name,
        icon: L.divIcon({ className: `finder-pin${selectedID === venue.id ? " is-selected" : ""}`, html: '<span aria-hidden="true"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      });
      const label = document.createElement("span"); label.textContent = `${venue.name} · sample`;
      marker.bindTooltip(label, { direction: "top", offset: [0, -12] });
      marker.on("click", () => select.current(venue.id));
      marker.on("keydown", (event: Leaflet.LeafletKeyboardEvent) => {
        if (event.originalEvent.key !== "Enter" && event.originalEvent.key !== " ") return;
        event.originalEvent.preventDefault(); event.originalEvent.stopPropagation();
        if (!event.originalEvent.repeat) select.current(venue.id);
      });
      marker.on("add", () => marker.getElement()?.setAttribute("aria-label", `View ${venue.name}, sample location`));
      marker.addTo(layer);
    }
    const selected = venues.find((venue) => venue.id === selectedID);
    if (selected) map.current?.panTo([selected.latitude, selected.longitude], { animate: false });
  }, [venues, selectedID, ready]);

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current) return;
    locationMarker.current?.remove();
    if (userLocation) {
      locationMarker.current = L.circleMarker([userLocation.latitude, userLocation.longitude], { radius: 8, color: "#ffffff", weight: 3, fillColor: "#2b59c3", fillOpacity: 1 }).addTo(map.current).bindTooltip("Your approximate location");
      map.current.setView([userLocation.latitude, userLocation.longitude], 16, { animate: false });
    }
  }, [ready, userLocation]);

  function showSamples() {
    const L = leaflet.current;
    if (!L || !map.current || !venues.length) return;
    map.current.fitBounds(L.latLngBounds(venues.map((venue) => [venue.latitude, venue.longitude])), { padding: [60, 60], maxZoom: 16, animate: false });
  }

  return <div className="finder-map-frame">
    <div ref={container} className="finder-leaflet" role="region" aria-label="Sample restroom locations map. The same sample locations are available in the list." />
    {!ready && !error && <div className="finder-map-loading" role="status">Loading the map…</div>}
    {error && <p className="finder-map-error" role="status">{error}</p>}
    <button type="button" className="finder-show-collection" onClick={showSamples} disabled={!ready || !venues.length}><MapPinned size={17} />Show sample locations</button>
    <div className="finder-map-key"><span className="finder-key-dot" />Sample location <span className="finder-key-note">Address point · restroom position unconfirmed</span></div>
  </div>;
}
