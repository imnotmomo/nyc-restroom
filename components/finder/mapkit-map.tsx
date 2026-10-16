"use client";

import { useEffect, useRef, useState } from "react";
import { MapPinned } from "lucide-react";
import type { Annotation, MapAnnotationSelectionEvent, MapKit, MapKitConfigurationErrorEvent, MarkerAnnotation } from "apple-mapkit";
import { isMapKitConfigured, loadMapKit } from "@/lib/mapkit-loader";
import { datasetSource, type Coordinates, type Restroom } from "@/lib/restrooms";

type AppleMap = InstanceType<MapKit["Map"]>;

export interface MapKitMapProps {
  places: readonly Restroom[];
  selectedID: string | null;
  onSelect: (id: string) => void;
  userLocation: Coordinates | null;
  locationRequestID: number;
}

export default function MapKitMap({ places, selectedID, onSelect, userLocation, locationRequestID }: MapKitMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const sdk = useRef<MapKit | null>(null);
  const map = useRef<AppleMap | null>(null);
  const annotations = useRef(new Map<string, MarkerAnnotation>());
  const locationAnnotation = useRef<Annotation | null>(null);
  const initialFit = useRef(false);
  const fitInitialCollection = useRef<(() => void) | null>(null);
  const selectedIDRef = useRef(selectedID);
  const selectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = isMapKitConfigured();
  selectedIDRef.current = selectedID;
  selectRef.current = onSelect;

  useEffect(() => {
    if (!configured) return;
    let disposed = false;
    let resize: ResizeObserver | undefined;
    let cleanupEvents: (() => void) | undefined;

    loadMapKit().then((mapkit) => {
      if (disposed || !container.current) return;
      sdk.current = mapkit;
      const { south, north, west, east } = datasetSource.bounds;
      const instance = new mapkit.Map(container.current, {
        region: {
          center: { latitude: (south + north) / 2, longitude: (west + east) / 2 },
          span: { latitudeDelta: north - south, longitudeDelta: east - west },
        },
        padding: { top: 100, right: 40, bottom: 60, left: 40 },
        mapType: mapkit.MapType.MutedStandard,
        tintColor: "#2B59C3",
        colorScheme: mapkit.ColorScheme.Light,
        showsMapTypeControl: false,
        showsZoomControl: true,
        showsCompass: mapkit.FeatureVisibility.Hidden,
        showsPointsOfInterest: false,
        showsUserLocation: false,
        tracksUserLocation: false,
        showsUserLocationControl: false,
        isRotationEnabled: false,
        annotationForCluster: (cluster) => {
          cluster.color = "#2B59C3";
          cluster.glyphColor = "#FFFFFF";
          cluster.title = `${cluster.memberAnnotations?.length ?? 0} restroom locations`;
          cluster.subtitle = "Select to look closer";
          return cluster;
        },
      });
      map.current = instance;
      initialFit.current = false;
      fitInitialCollection.current = () => {
        if (initialFit.current || !container.current?.clientWidth || !container.current.clientHeight || !annotations.current.size) return;
        initialFit.current = true;
        instance.showItems([...annotations.current.values()], {
          animate: false,
          padding: { top: 100, right: 40, bottom: 60, left: 40 },
          minimumSpan: { latitudeDelta: 0.002, longitudeDelta: 0.002 },
        });
      };

      const handleSelect = (event: Event) => {
        const annotation = (event as MapAnnotationSelectionEvent).annotation;
        if (!annotation) return;
        if (annotation.memberAnnotations?.length) {
          initialFit.current = true;
          instance.showItems(annotation.memberAnnotations, {
            animate: false,
            padding: { top: 80, right: 40, bottom: 60, left: 40 },
            minimumSpan: { latitudeDelta: 0.002, longitudeDelta: 0.002 },
          });
          return;
        }
        const id = (annotation.data as { restroomID?: string }).restroomID;
        if (id && id !== selectedIDRef.current) selectRef.current(id);
      };
      const handleError = (event: Event) => {
        if (disposed) return;
        const status = (event as MapKitConfigurationErrorEvent).status;
        setError(status === "Unauthorized"
          ? "Apple Maps authorization failed. You can still use the location list and walking directions."
          : "Apple Maps is unavailable right now. You can still use the location list and walking directions.");
      };
      instance.addEventListener("select", handleSelect);
      mapkit.addEventListener("error", handleError);
      mapkit.addEventListener("load-error", handleError);
      cleanupEvents = () => {
        instance.removeEventListener("select", handleSelect);
        mapkit.removeEventListener("error", handleError);
        mapkit.removeEventListener("load-error", handleError);
      };

      resize = new ResizeObserver((entries) => {
        const size = entries[0]?.contentRect;
        if (!disposed && size?.width && size.height) {
          instance.setRegionAnimated(instance.region, false);
          fitInitialCollection.current?.();
        }
      });
      resize.observe(container.current);
      setReady(true);
    }).catch((failure: unknown) => {
      if (!disposed) setError(failure instanceof Error ? failure.message : "Apple Maps could not load. You can still use the location list.");
    });

    return () => {
      disposed = true;
      resize?.disconnect();
      cleanupEvents?.();
      map.current?.destroy();
      map.current = null;
      sdk.current = null;
      annotations.current.clear();
      locationAnnotation.current = null;
      fitInitialCollection.current = null;
    };
  }, [configured]);

  useEffect(() => {
    const mapkit = sdk.current;
    const instance = map.current;
    if (!ready || !mapkit || !instance) return;
    const visibleIDs = new Set(places.map((place) => place.id));
    for (const [id, annotation] of annotations.current) {
      if (!visibleIDs.has(id)) {
        instance.removeAnnotation(annotation);
        annotations.current.delete(id);
      }
    }
    for (const place of places) {
      if (annotations.current.has(place.id)) continue;
      const annotation = new mapkit.MarkerAnnotation(place, {
        title: place.name,
        subtitle: place.locationType ?? "Restroom location",
        data: { restroomID: place.id },
        accessibilityLabel: `View ${place.name}`,
        color: "#2B59C3",
        glyphColor: "#FFFFFF",
        glyphText: "R",
        clusteringIdentifier: "restroom-ready-locations",
        titleVisibility: mapkit.FeatureVisibility.Adaptive,
        subtitleVisibility: mapkit.FeatureVisibility.Hidden,
        calloutEnabled: false,
        animates: false,
      });
      instance.addAnnotation(annotation);
      annotation.element.setAttribute("data-restroom-id", place.id);
      annotation.element.setAttribute("aria-label", `View ${place.name}`);
      annotation.element.setAttribute("role", "button");
      annotation.element.tabIndex = 0;
      annotation.element.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          selectRef.current(place.id);
        }
      });
      annotations.current.set(place.id, annotation);
    }
    fitInitialCollection.current?.();
  }, [ready, places]);

  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const annotation = selectedID ? annotations.current.get(selectedID) : null;
    instance.selectedAnnotation = annotation ?? null;
    if (annotation) {
      initialFit.current = true;
      instance.setCenterAnimated(annotation.coordinate, false);
    }
  }, [ready, places, selectedID]);

  useEffect(() => {
    const mapkit = sdk.current;
    const instance = map.current;
    if (!ready || !mapkit || !instance) return;
    if (locationAnnotation.current) {
      instance.removeAnnotation(locationAnnotation.current);
      locationAnnotation.current = null;
    }
    if (!userLocation) return;
    const location = new mapkit.Annotation(userLocation, () => {
      const dot = document.createElement("div");
      dot.setAttribute("role", "img");
      dot.setAttribute("aria-label", "Your location");
      Object.assign(dot.style, {
        width: "20px", height: "20px", borderRadius: "50%",
        background: "#2B59C3", border: "3px solid #FFFFFF", outline: "1px solid #2B59C3",
      });
      return dot;
    }, { title: "Your location", accessibilityLabel: "Your location", enabled: false, animates: false, calloutEnabled: false });
    instance.addAnnotation(location);
    locationAnnotation.current = location;
  }, [ready, userLocation]);

  useEffect(() => {
    if (ready && map.current && userLocation && locationRequestID > 0) {
      initialFit.current = true;
      map.current.setCenterAnimated(userLocation, false);
    }
  }, [ready, userLocation, locationRequestID]);

  const status = !configured
    ? "Apple Maps is not connected yet. You can still use the list and walking directions."
    : error;

  function showCollection() {
    if (!map.current || !annotations.current.size) return;
    initialFit.current = true;
    map.current.showItems([...annotations.current.values()], {
      animate: false,
      padding: { top: 100, right: 40, bottom: 60, left: 40 },
      minimumSpan: { latitudeDelta: 0.002, longitudeDelta: 0.002 },
    });
  }

  return <div className="finder-map-frame" data-map-provider="apple">
    <div ref={container} className="finder-mapkit" style={{ width: "100%", height: "100%" }} role="region" aria-label="Apple Maps restroom locations. The same locations and details are available in the list." />
    {ready && !status && <button type="button" className="finder-show-collection" onClick={showCollection} disabled={!places.length}><MapPinned size={17}/>Show collection</button>}
    {(!ready || status) && <div className="finder-map-loading" role="status" style={{ flexDirection: "column", gap: "12px", textAlign: "center", lineHeight: 1.7 }}><span>{status ?? "Loading Apple Maps…"}</span></div>}
  </div>;
}
