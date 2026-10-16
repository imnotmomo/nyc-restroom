"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";
import type * as Leaflet from "leaflet";
import type {} from "leaflet.markercluster";
import "leaflet/dist/leaflet.css";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { datasetSource, type Coordinates, type Restroom } from "@/lib/restrooms";

let clusteredLeaflet: Promise<typeof Leaflet> | undefined;

function loadClusteredLeaflet(): Promise<typeof Leaflet> {
  if (!clusteredLeaflet) {
    clusteredLeaflet = import("leaflet").then(async (exports) => {
      // The plugin patches global L; an ESM namespace itself is read-only.
      const L = { ...exports } as typeof Leaflet;
      (window as Window & { L: typeof Leaflet }).L = L;
      await import("leaflet.markercluster");
      return L;
    }).catch((error: unknown) => {
      clusteredLeaflet = undefined;
      throw error;
    });
  }
  return clusteredLeaflet;
}

interface RestroomMapProps {
  places: readonly Restroom[];
  selectedID: string | null;
  onSelect: (id: string) => void;
  userLocation: Coordinates | null;
  locationRequestID: number;
}

const AppleRestroomMap = dynamic(() => import("@/components/finder/mapkit-map"), {
  ssr: false,
  loading: () => <div className="finder-map-loading" role="status">Loading Apple Maps…</div>,
});

export default function RestroomMap(props: RestroomMapProps) {
  return process.env.NEXT_PUBLIC_MAPKIT_JS_TOKEN?.trim()
    ? <AppleRestroomMap {...props}/>
    : <OpenStreetMap {...props}/>;
}

function OpenStreetMap({ places, selectedID, onSelect, userLocation, locationRequestID }: RestroomMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const leaflet = useRef<typeof Leaflet | null>(null);
  const markers = useRef<Leaflet.MarkerClusterGroup | null>(null);
  const markerRecords = useRef(new Map<string, { marker: Leaflet.Marker }>());
  const locationMarker = useRef<Leaflet.CircleMarker | null>(null);
  const initialFit = useRef(false);
  const previousSelectedID = useRef<string | null>(null);
  const selectedIDRef = useRef(selectedID);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  onSelectRef.current = onSelect;
  selectedIDRef.current = selectedID;

  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | undefined;
    loadClusteredLeaflet().then((L) => {
      if (cancelled || !container.current) return;
      leaflet.current = L;
      const { south, north, west, east } = datasetSource.bounds;
      const instance = L.map(container.current, { zoomControl: false, scrollWheelZoom: true, fadeAnimation: false, zoomAnimation: false })
        .setView([(south + north) / 2, (west + east) / 2], 10);
      map.current = instance;
      initialFit.current = false;
      const fitInitialCollection = () => {
        if (initialFit.current || !container.current?.clientWidth || !container.current.clientHeight) return;
        initialFit.current = true;
        instance.fitBounds([[south, west], [north, east]], { padding: [48, 48], maxZoom: 15, animate: false });
      };
      fitInitialCollection();
      L.control.zoom({ position: "bottomright" }).addTo(instance);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).on("tileerror", () => { if (!cancelled) setError("Map tiles could not load. You can still use the list."); })
        .on("tileload", () => { if (!cancelled) setError(null); }).addTo(instance);
      const clusters = L.markerClusterGroup({
        animate: false,
        animateAddingMarkers: false,
        showCoverageOnHover: false,
        removeOutsideVisibleBounds: true,
        zoomToBoundsOnClick: true,
        spiderfyOnMaxZoom: true,
        spiderfyDistanceMultiplier: 1.4,
        maxClusterRadius: (zoom) => zoom >= 16 ? 1 : 56,
        spiderLegPolylineOptions: { color: "#2B59C3", weight: 1, opacity: 0.5 },
        iconCreateFunction: (cluster) => {
          const count = cluster.getChildCount();
          const size = count >= 100 ? 52 : count >= 10 ? 46 : 40;
          const icon = L.divIcon({
            className: "finder-cluster",
            html: `<span aria-hidden="true">${count}</span>`,
            iconSize: [size, size], iconAnchor: [size / 2, size / 2],
          });
          const createIcon = icon.createIcon.bind(icon);
          icon.createIcon = (oldIcon) => {
            const element = createIcon(oldIcon);
            element.setAttribute("aria-label", `${count} restroom locations. Zoom in or expand this group.`);
            element.setAttribute("data-cluster-count", String(count));
            element.setAttribute("role", "button");
            element.tabIndex = 0;
            return element;
          };
          return icon;
        },
      }).addTo(instance);
      clusters.on("clusterkeydown", (event: Leaflet.LeafletEvent) => {
        const { layer, originalEvent: keyboard } = event as Leaflet.LeafletEvent & {
          layer: Leaflet.MarkerCluster;
          originalEvent: KeyboardEvent;
        };
        if (keyboard.key !== "Enter" && keyboard.key !== " ") return;
        keyboard.preventDefault();
        keyboard.stopPropagation();
        if (keyboard.repeat) return;
        initialFit.current = true;
        const bounds = layer.getBounds();
        if (instance.getZoom() >= instance.getMaxZoom() || bounds.getNorthEast().equals(bounds.getSouthWest())) layer.spiderfy();
        else layer.zoomToBounds({ padding: [48, 48], animate: false });
        instance.getContainer().focus({ preventScroll: true });
      });
      markers.current = clusters;
      resize = new ResizeObserver(() => {
        instance.invalidateSize({ animate: false });
        fitInitialCollection();
      });
      resize.observe(container.current);
      setReady(true);
    }).catch(() => { if (!cancelled) setError("The map could not load. You can still use the list."); });
    return () => {
      cancelled = true;
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
      markers.current = null;
      markerRecords.current.clear();
      locationMarker.current = null;
      previousSelectedID.current = null;
    };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current || !markers.current) return;
    const visibleIDs = new Set(places.map((place) => place.id));
    const removed: Leaflet.Marker[] = [];
    for (const [id, record] of markerRecords.current) {
      if (!visibleIDs.has(id)) {
        removed.push(record.marker);
        markerRecords.current.delete(id);
      }
    }
    if (removed.length) markers.current.removeLayers(removed);
    const added: Leaflet.Marker[] = [];
    places.forEach((place) => {
      const selected = selectedIDRef.current === place.id;
      const existing = markerRecords.current.get(place.id);
      if (existing) return;
      const marker = L.marker([place.latitude, place.longitude], {
        keyboard: true,
        title: place.name,
        alt: place.name,
        zIndexOffset: selected ? 500 : 0,
        icon: L.divIcon({
          className: `finder-pin${selected ? " is-selected" : ""}`,
          html: '<span aria-hidden="true"></span>',
          iconSize: [24, 24], iconAnchor: [12, 12],
        }),
      });
      const label = document.createElement("span");
      label.textContent = place.name;
      marker.bindTooltip(label, { direction: "top", offset: [0, -12] });
      marker.on("click", () => onSelectRef.current(place.id));
      marker.on("keydown", (event: Leaflet.LeafletKeyboardEvent) => {
        const keyboard = event.originalEvent;
        if (keyboard.key !== "Enter" && keyboard.key !== " ") return;
        keyboard.preventDefault();
        keyboard.stopPropagation();
        if (!keyboard.repeat) onSelectRef.current(place.id);
      });
      marker.on("add", () => {
        const element = marker.getElement();
        element?.setAttribute("aria-label", `View ${place.name}`);
        element?.setAttribute("data-restroom-id", place.id);
        element?.classList.toggle("is-selected", selectedIDRef.current === place.id);
      });
      added.push(marker);
      markerRecords.current.set(place.id, { marker });
    });
    if (added.length) markers.current.addLayers(added);
  }, [ready, places]);

  useEffect(() => {
    if (!ready || !map.current) return;
    const previous = previousSelectedID.current ? markerRecords.current.get(previousSelectedID.current)?.marker : null;
    previous?.getElement()?.classList.remove("is-selected");
    previous?.setZIndexOffset(0);
    const selected = selectedID ? markerRecords.current.get(selectedID)?.marker : null;
    selected?.getElement()?.classList.add("is-selected");
    selected?.setZIndexOffset(500);
    previousSelectedID.current = selectedID;
    const clusters = markers.current;
    const instance = map.current;
    const L = leaflet.current;
    if (selected && clusters) {
      initialFit.current = true;
      instance.panTo(selected.getLatLng(), { animate: false });
      clusters.zoomToShowLayer(selected, () => {
        requestAnimationFrame(() => {
          if (map.current !== instance || markers.current !== clusters || selectedIDRef.current !== selectedID) return;
          // With animations off, zoomend may collapse a just-spiderfied pair.
          const parent = clusters.getVisibleParent(selected);
          if (!selected.getElement() && L && parent instanceof L.MarkerCluster) parent.spiderfy();
          selected.getElement()?.classList.add("is-selected");
        });
      });
    }
  }, [ready, selectedID, places]);

  useEffect(() => {
    const L = leaflet.current;
    if (!ready || !L || !map.current) return;
    locationMarker.current?.remove();
    if (userLocation) {
      initialFit.current = true;
      locationMarker.current = L.circleMarker([userLocation.latitude, userLocation.longitude], {
        radius: 8, color: "#ffffff", weight: 3, fillColor: "#2b59c3", fillOpacity: 1,
      }).addTo(map.current).bindTooltip("Your location");
      map.current.stop();
      map.current.setView([userLocation.latitude, userLocation.longitude], 16, { animate: false });
    }
  }, [ready, userLocation, locationRequestID]);

  function showCollection() {
    const L = leaflet.current;
    if (!L || !map.current || !places.length) return;
    initialFit.current = true;
    map.current.fitBounds(L.latLngBounds(places.map(place => [place.latitude, place.longitude])), {
      padding: [48, 48], maxZoom: 15, animate: false,
    });
  }

  return <div className="finder-map-frame">
    <div ref={container} className="finder-leaflet" role="region" aria-label="Restroom locations map. The same locations and details are available in the list." />
    {!ready && !error && <div className="finder-map-loading" role="status">Loading the map…</div>}
    {error && <p className="finder-map-error" role="status">{error}</p>}
    <button type="button" className="finder-show-collection" onClick={showCollection} disabled={!ready || !places.length}><MapPinned size={17}/>Show collection</button>
    <div className="finder-map-key"><span className="finder-key-dot" />Restroom location <span className="finder-key-note">Numbers group nearby locations · Availability may have changed</span></div>
  </div>;
}
