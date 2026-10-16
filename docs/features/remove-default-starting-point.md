# Remove the default starting point

Status: Shipped
Date: October 16, 2026

The requested change removes the "Your starting point / Columbia University" block. The finder must also stop calculating distances from that hardcoded fallback: hiding the label alone would leave distances with an undisclosed origin. Before location is shared, locations sort by name and list/detail distances stay absent. Successful Locate me enables and selects distance sorting from the actual browser location; a failed request preserves the current state. The map already fits the collection without a starting point, and walking directions already omit an origin until GPS is available.

Root owns the finder/detail rendering and compact header styling. The independent reviewer approved the GPS-only distance plan and integrated diff. No Firebase, map or data schema changes were needed. Production TypeScript, static export and Worker packaging passed.

Independent compiled-browser checks passed: no starting-point header; alphabetical default and disabled Distance option; no list/detail distances or walking-directions origin before GPS; denied location preserves browsing without a fallback; successful browser GPS selects distance sorting, including a genuine 0 m result and matching directions origin. Both 320px and 390px layouts have no horizontal overflow. No browser errors, sign-ins, writes or production Firebase connections occurred. Evidence: `finder-no-default-start-browser-checks.json` and `screenshots/finder-no-default-start.png`.

Source `b3b15885009b9df9d04e5fe003ea01bf89a9db4b` shipped as Sites version 14 and VPS release `20261016T150954Z-b3b15885009b`. Both public finder pages return HTTP 200 with matching assets, no starting-point block and name sorting selected. VPS health is `ok`; the live browser also shows the updated initial state. Screenshot: `screenshots/finder-no-default-start-live.jpg`. The owned local preview was stopped after verification.
