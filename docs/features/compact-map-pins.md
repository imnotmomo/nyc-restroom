# Compact map pins

The team requested removing numeric map-pin labels because they made the citywide map too crowded. Replace the active Leaflet adapter's numbered teardrops with 12px blue circles; selection enlarges the circle to 18px and adds a ring. Keep a centered 24px interaction box, place-name tooltip and accessible label, selection styling, and the existing click/Enter/Space handlers. The full-size location list remains available as an equivalent browsing control.

Remove index storage and icon renumbering from the marker registry. Filters and sort changes retain each marker by its source ID. Directory data, list content, filters, GPS and account behavior are unchanged. The pending Apple adapter already uses an R glyph rather than individual place numbers and is outside this small change.

Independent plan and integrated reviews found no blocker. TypeScript checking, production build and whitespace checks passed. Browser QA confirmed all 1,064 markers have no numeric content, normal circles measure 12px inside their 24px interaction boxes, and the selected 18px circle stays centered. The geometry check caught Leaflet's later-loaded default `display: block` overriding the marker layout; the scoped `.finder-leaflet .finder-pin` selector fixes that CSS-order dependency.

Actual clicks and Enter/Space open the correct details after filtering and sorting; the marker DOM remains attached. The 390px mobile map has no horizontal overflow. No uncaught browser errors. Evidence: `docs/features/pin-browser-checks.json` and `screenshots/pins-1440.png` / `pins-390.png`, visually reviewed before publication.

Both existing hosts received the checked build on October 15, 2026, New York time, from source commit `7c9cde6a55d71e1d6f27e068f2e99f8451c8d466`:

- Team domain: `https://nyc.imfinethanku.me/find/`, VPS release `20261016T012514Z-7c9cde6a55d7`; runtime checksum and health check passed.
- Public preview: `https://restroom-ready-nyc.clcii.chatgpt.site/find/`, saved version 6, deployment `appgdep_6ad17d0427908191abb445aedde8afc5`, status `succeeded`.

Independent live browser checks passed on both hosts: all marker labels are empty, names remain accessible, normal/selected sizes and centered geometry match the checked build, and selecting a location opens details. No browser errors, login or data writes.

Release results were added after the matching source archive was published.
