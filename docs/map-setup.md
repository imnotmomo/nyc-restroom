# Browser maps and location

The finder supports Apple's **MapKit JS 6**, loaded through Apple's official `@apple/mapkit-loader`. To activate it, provide a real MapKit JS Maps token in `NEXT_PUBLIC_MAPKIT_JS_TOKEN`, then rebuild and publish. There is no token in the repository and Apple map authorization/rendering has not yet been verified.

Create a domain-restricted **MapKit JS** token in the Apple Developer Account under Certificates, Identifiers & Profiles → Services → Maps → Tokens. Allow `restroom-ready-nyc.clcii.chatgpt.site` and any development domains the team actually uses. The static web-token flow does not require putting an Apple signing private key in the application. Follow [Apple's token instructions](https://developer.apple.com/documentation/mapkitjs/creating-a-maps-token).

Apple mode uses a muted standard map, blue R pins, clustering, selected-place synchronization, and a distinct user-location dot. The SDK's automatic location controls and tracking are disabled. The application's explicit Locate me action owns location permission. See [Apple's web framework guide](https://webkit.org/blog/18027/discover-mapkit-js-6-rebuilt-for-todays-web-developer/).

Without an Apple token, the existing OpenStreetMap directory remains available. Its map colors are quieter; it is still attributed as OpenStreetMap and is not presented as Apple Maps.

## Locate me

- No location request runs on initial page load.
- A successful request centers the map on the supplied browser coordinates, including outside the first dataset's bounds. Distances use that same location.
- The first collection still only covers upper Manhattan. The coverage notice explains this rather than implying nearby restrooms exist everywhere.
- **Show collection** fits the visible city listings again. Pressing Locate me again recenters even if the browser returns identical coordinates.
- Location success opens the mobile Map view and closes a selected detail sheet.
- Missing browser support, insecure pages, effective policy blocks, denied permission, unavailable position, and timeouts have distinct messages. A watchdog stops a browser that never calls back. Cancelled or unmounted requests ignore late callbacks.
- Embedded browsers may need geolocation delegation or may be blocked by browser/macOS settings. Opening the public page directly in Safari or Chrome is a supported fallback; changing map providers cannot override those settings.

The site serves `Permissions-Policy: geolocation=(self)`. Independent live tests reproduced success with granted synthetic coordinates and reproduced a cross-origin iframe policy block. These tests did not read or alter the user's real location or OS permissions. Location is not stored in Firestore or sent to analytics; opening directions intentionally passes the chosen origin/destination to Google Maps.
