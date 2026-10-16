# Zoom-dependent restroom clusters

## Brief and plan

The team requested replacing dense citywide dots with larger circles showing how many restroom locations are grouped together. Zooming in, selecting a cluster, or locating the user should reveal smaller local groups and individual unnumbered dots. Keep the current directory, filters, list/detail flow, and location-permission behavior.

Use the Leaflet marker-cluster plugin in the client-only adapter. Count the current filtered source IDs, not available stalls or live-open restrooms. Maintain the existing individual dot design and name-based accessibility. Clicking or keyboard-activating a cluster zooms toward its members. Coincident coordinates need a way to expose every listing. The user-location circle remains outside restroom clusters.

Independent plan review identified three requirements: reapply marker labels/styling when pruned children return to the map, reveal selected list items even when they are inside a cluster, and ignore stale reveal callbacks. Nearby clustering should become finer without losing access to the source's two same-coordinate pairs. Hidden mobile maps must render their groups when revealed.

The pending MapKit adapter already uses Apple's native clustering and cluster zoom behavior. Its rendering still requires the team's web token; the active Leaflet adapter is the implementation verified here.

## Implementation and review

Added `leaflet.markercluster` and its TypeScript definitions rather than maintaining a second spatial index and renderer. The plugin runs only in the browser, after Leaflet loads into a shared mutable namespace. Numbered circles use the existing blue/white palette and grow from 40 to 52 pixels with their count. Ordinary individual dots keep their existing 12-pixel appearance.

Groups count the complete filtered collection, including locations beyond the list's first 50 results. At zoom 16 and above, the grouping radius shrinks to one pixel; ordinary nearby points become individual dots, while the two coincident-coordinate pairs can still fan out into separate selectable markers. Locate me now centers at zoom 16. The user marker is separate from the restroom group, and viewport pruning avoids drawing off-screen markers.

Independent review caught a plugin lifecycle detail: replacing a cluster icon does not fire its add event. The final icon factory decorates the returned element with its current count and accessible label. Individual markers restore labels and selected styling when re-added. Selecting a list item reveals its clustered child, with stale-callback guards and a next-frame check that keeps coincident selections expanded when animations are disabled. The reviewer passed these corrections.

Independent browser review also found that a cluster's disappearing element could drop keyboard focus to the page body. Keyboard expansion now explicitly focuses the named map region; Enter and Space were rerun for both citywide groups and coincident points.

## Verification and release

TypeScript, all 27 existing tests, the production export/Worker build, and whitespace checks pass. The initial sandboxed test attempt could not open localhost sockets; the same suite passed with local-server permission.

Integrated Chrome checks pass at desktop and 390px, with a separate reviewer checking 320px. The initial 1440px view uses 17 groups and one individual dot, representing all 1,064 listings; the mobile view uses six groups. Cluster clicks and keyboard activation expand the view, selecting a list item reveals its correct dot, Accessible counts 619 listings, Public counts 1,064, and the unrated Clean view is empty. Synthetic Locate me at Columbia reaches zoom 16 and reveals individual dots; the location circle is excluded from group totals. Both Tompkins Square source IDs remain independently selectable. Repeated mobile view switching and rapid filter/search transitions pass with no uncaught browser errors or horizontal overflow.

Evidence: [main browser checks](cluster-browser-checks.json), [independent checks and focus regression](cluster-independent-checks.json), and [screenshots](screenshots/). A spiderfied group retains a faded parent element while its individual children are shown, and viewport pruning omits off-screen markers; source membership is the definitive count outside the initial full-collection view. Synthetic geolocation does not establish the user's Safari permission state.

Published the tested source `6507a268416e859f4c3f88862e81dd14662ea0e9` to both hosts. Sites version 7, deployment `appgdep_6ad17ff499e081918c3ce651b42db5c9`, returned `succeeded`. The VPS activated release `20261016T013806Z-6507a268416e`; public HTTPS `/find/` returned 200 and `/api/health` returned `ok`. Account data and source records are unchanged.

Independent fresh-browser release checks passed on both hosts: 1,064 group members, correct numbered circles, Accessible 619, keyboard expansion with map focus, and synthetic neighborhood location with individual dots. The first Sites visit requested an old CSS asset and failed; a fresh retry loaded the current release and passed without browser errors. Current Sites HTML asset references also match the VPS and local build. Refresh an already-open page to load the new version. The owned local preview was stopped after verification.
