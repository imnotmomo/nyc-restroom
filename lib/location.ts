export interface LocationCoordinates {
  latitude: number;
  longitude: number;
}

interface LocationFailure { code?: number; name?: string }

export function validCoordinates(value: LocationCoordinates): boolean {
  return Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
    && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180;
}

export function locationAvailabilityError({ secureContext, hasGeolocation, allowedByPolicy }: {
  secureContext: boolean;
  hasGeolocation: boolean;
  allowedByPolicy?: boolean;
}): string | null {
  if (!secureContext) return "Location needs a secure page. Open this site’s HTTPS address, then try again.";
  if (!hasGeolocation) return "This browser doesn’t provide location access. Open this page directly in Chrome or Safari. You can still browse the listed places.";
  if (allowedByPolicy === false) return "Location is blocked by this page’s permissions policy. Open the site directly in Chrome or Safari. If it stays blocked, the team needs to allow location for this page.";
  return null;
}

export function locationFailureMessage(error: LocationFailure): string {
  if (error.code === 1 || error.name === "SecurityError" || error.name === "NotAllowedError") {
    return "Location is blocked. Allow location for this site in your browser’s address-bar settings, then retry. On a Mac, also check System Settings → Privacy & Security → Location Services for your browser. If you’re in an embedded browser, open this page directly in Chrome or Safari.";
  }
  if (error.code === 2) return "Your browser couldn’t determine your location. Check that Location Services is on, then try again. You can still browse the listed places.";
  if (error.code === 3) return "Getting your location took too long. Check the permission prompt, then try again. If you’re in an embedded browser, open this page directly in Chrome or Safari.";
  return "We couldn’t get your location. Try again, or open this page directly in Chrome or Safari. You can still browse the listed places.";
}

/** The browser request cannot be aborted; cancellation ignores its later callbacks. */
export function requestBrowserLocation({ geolocation, onSuccess, onError, watchdogMs = 15_000 }: {
  geolocation: Pick<Geolocation, "getCurrentPosition">;
  onSuccess: (coordinates: LocationCoordinates) => void;
  onError: (message: string) => void;
  watchdogMs?: number;
}): () => void {
  let active = true;
  const finish = (callback: () => void) => {
    if (!active) return;
    active = false;
    clearTimeout(watchdog);
    callback();
  };
  const watchdog = setTimeout(() => finish(() => onError(locationFailureMessage({ code: 3 }))), watchdogMs);
  try {
    geolocation.getCurrentPosition(({ coords }) => {
      const coordinates = { latitude: coords.latitude, longitude: coords.longitude };
      finish(() => {
        if (validCoordinates(coordinates)) onSuccess(coordinates);
        else onError("Your browser returned an invalid location. Please try again. You can still browse the listed places.");
      });
    }, (error) => finish(() => onError(locationFailureMessage(error))), {
      enableHighAccuracy: false,
      timeout: 12_000,
      maximumAge: 60_000,
    });
  } catch (error) {
    const failure = typeof error === "object" && error !== null ? error as LocationFailure : {};
    finish(() => onError(locationFailureMessage(failure)));
  }
  return () => { active = false; clearTimeout(watchdog); };
}
