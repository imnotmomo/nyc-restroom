"use client";

import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import { COLUMBIA, isWithinCollection, type Coordinates, type Restroom } from "@/lib/restrooms";

export default function RestroomMap({ places, selectedID, onSelect, userLocation }: {
  places: readonly Restroom[];
  selectedID: string | null;
  onSelect: (id: string) => void;
  userLocation: Coordinates | null;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const markers = useRef<Leaflet.LayerGroup | null>(null);
  const locationMarker = useRef<Leaflet.CircleMarker | null>(null);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      leaflet.current = L;
      const instance = L.map(container.current, { zoomControl: false, scrollWheelZoom: true, fadeAnimation: false, zoomAnimation: false })
        .setView([COLUMBIA.latitude, COLUMBIA.longitude], 14);
      map.current = instance;
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on("tileerror", () => { if (!cancelled) setError("Map tiles could not load. You can still use the list."); })
        .on("tileload", () => { if (!cancelled) setError(null); }).addTo(instance);
      markers.current = L.layerGroup().addTo(instance);
      resize = new ResizeObserver(() => instance.invalidateSize({ animate: false }));
      resize.observe(container.current);
      setReady(true);
    }).catch(() => { if (!cancelled) setError("The map could not load. You can still use the list."); });
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current || !markers.current) return;
    markers.current.clearLayers();
    places.forEach((place, index) => {
      const marker = L.marker([place.latitude, place.longitude], {
        keyboard: true,
        title: `${index + 1}. ${place.name}`,
        alt: place.name,
        zIndexOffset: selectedID === place.id ? 500 : 0,
        icon: L.divIcon({
          className: `finder-pin${selectedID === place.id ? " is-selected" : ""}`,
          html: `<span>${index + 1}</span>`,
          iconSize: [44, 44], iconAnchor: [22, 36],
        }),
      });
      const label = document.createElement("span");
      label.textContent = place.name;
      marker.bindTooltip(label, { direction: "top", offset: [0, -20] });
      marker.on("click", () => onSelectRef.current(place.id));
      marker.addTo(markers.current!);
      marker.getElement()?.setAttribute("aria-label", `${index + 1}. View ${place.name}`);
      marker.getElement()?.setAttribute("data-restroom-id", place.id);
    });
  }, [ready, places, selectedID]);

  useEffect(() => {
    const place = places.find((candidate) => candidate.id === selectedID);
    if (ready && place && map.current) map.current.panTo([place.latitude, place.longitude], { animate: false });
  }, [ready, selectedID, places]);

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current) return;
    locationMarker.current?.remove();
    if (userLocation) {
      locationMarker.current = L.circleMarker([userLocation.latitude, userLocation.longitude], {
        radius: 8, color: "#ffffff", weight: 3, fillColor: "#2b59c3", fillOpacity: 1,
      }).addTo(map.current).bindTooltip("Your location");
      if (isWithinCollection(userLocation)) map.current.panTo([userLocation.latitude, userLocation.longitude], { animate: false });
    }
  }, [ready, userLocation]);

  return <div className="finder-map-frame">
    <div ref={container} className="finder-leaflet" role="region" aria-label="Restroom locations map. The same locations and details are available in the list." />
    {!ready && !error && <div className="finder-map-loading" role="status">Loading the map…</div>}
    {error && <p className="finder-map-error" role="status">{error}</p>}
    <div className="finder-map-key"><span className="finder-key-dot" />City-listed location <span className="finder-key-note">Availability may have changed</span></div>
  </div>;
}
