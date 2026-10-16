import type { MapKit } from "apple-mapkit";

let loading: Promise<MapKit> | null = null;

export function isMapKitConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_MAPKIT_JS_TOKEN?.trim());
}

export function loadMapKit(): Promise<MapKit> {
  if (typeof window === "undefined") return Promise.reject(new Error("Apple Maps loads in the browser."));
  const token = process.env.NEXT_PUBLIC_MAPKIT_JS_TOKEN?.trim();
  if (!token) return Promise.reject(new Error("Apple Maps is not connected yet. You can still use the list and walking directions."));
  if (loading) return loading;

  loading = new Promise<MapKit>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Apple Maps took too long to load. You can still use the location list.")), 20_000);
    import("@apple/mapkit-loader")
      .then(({ load }) => load({ version: "6", token, language: "en-US", libraries: ["map", "annotations"] }))
      .then((mapkit) => {
        window.clearTimeout(timeout);
        if (!mapkit.Map || !mapkit.MarkerAnnotation) {
          reject(new Error("Apple Maps could not finish loading. You can still use the location list."));
          return;
        }
        resolve(mapkit);
      })
      .catch(() => {
        window.clearTimeout(timeout);
        reject(new Error("Apple Maps could not load. Check your connection, or keep using the location list."));
      });
  }).catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}
