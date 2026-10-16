# Feature: map display and Locate me

Status: location fix ready to publish; Apple token pending

The user requested access for all Google accounts, approved public browsing explicitly, reported Locate me failure and an unattractive map, and asked to use Apple's browser MapKit. The Site access policy was changed from custom to public (revision 2) after that explicit approval. The app has no email-domain allowlist; Google sign-in remains required for account-owned saved places and private notes.

## Plan and diagnosis

Keep the existing Next.js static export and source-backed directory. Prepare an optional MapKit JS 6 adapter using the official loader; activate it only with the team's genuine domain-restricted token. Preserve a working OpenStreetMap view until then. No Apple token or developer-account access has been supplied, so Apple map authorization and live rendering are pending.

An independent reviewer checked the deployed page: HTTPS, HTTP 200, and `geolocation=(self)`. A fresh Chrome test with synthetic coordinates proved inside-area location works, while outside-area success updated distances without moving the map because of an explicit code restriction. A separate synthetic cross-origin iframe test reproduced a policy block despite granted browser permission. This identifies concrete cases without guessing the user's real permissions or location.

## Changes

A separate implementation added browser preflight, distinct errors, timeout watchdog, coordinate validation, and cancellation/stale-callback protection. Success opens mobile map, closes details, updates the distance origin, and increments a recenter request. The map now centers outside the dataset area and explains the coverage limit. Show collection returns to the visible records. Stale account errors no longer hide location feedback.

The optional Apple adapter uses a muted standard map, clustered R pins, list selection, explicit recentering, and no SDK-initiated geolocation. Existing map colors were reduced in saturation while retaining source attribution. No missing venue facts were filled in.

## Verification

All 12 fast tests (seven location regressions and five existing waitlist tests) and TypeScript checking passed. The production static build passed. Browser checks with synthetic coordinates verified outside-area centering, Show collection, repeated identical-coordinate recentering, mobile map opening, denied-permission recovery, and cross-origin iframe policy detection. No browser runtime errors occurred; no Apple requests were made without a token. Evidence: `map-location-browser-checks.json` and `screenshots/map-location-1440.png`. Independent final review found no blockers; its privacy and environment-documentation notes were addressed before publication. Apple runtime verification requires the actual token; no substituted or fabricated token is used.
