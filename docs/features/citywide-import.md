# Citywide public restroom import

## Brief and plan

The team requested importing all available locations after reviewing the initial Upper Manhattan sample. Use all valid coordinate-bearing records in the saved official NYC snapshot. Preserve its original retrieval and published dates, exact duplicate handling, unknown facts, and existing listing IDs. Coverage describes the source collection, not every restroom or current availability.

The data importer owns coordinate validation, citywide extents, source counts, deduplication and provenance. The frontend keeps every filtered location available for map, search, sorting and details, with 50 list results shown at a time and a Show more action. Both map adapters initially fit the citywide collection. Later GPS centering and user interaction remain unchanged. Retain the explicitly labeled Columbia default for distance sorting until a user supplies location.

An independent plan reviewer approved this scope and identified selection-triggered Leaflet marker rebuilding as a citywide performance concern. Markers will reconcile by ID and selection styling will update separately. All/search already includes parks, libraries, transit, public plazas, and privately owned public spaces; no additional type controls are required.

## Implementation and review

The saved snapshot contains 1,066 valid coordinate-bearing source rows, yielding 1,064 distinct listings after two duplicate rows are merged. No source rows have invalid coordinates. The types are 822 parks, 216 libraries, 14 privately owned public spaces, 7 public plazas, and 5 transit facilities. All 55 previous records are unchanged, including their IDs. No Firebase schema or security-rule change is required.

Independent integrated review found no blockers. Browser checks uncovered an existing Leaflet keyboard gap: focusable pins opened custom details on click but lacked Enter/Space activation. The new key handler is attached once to each persistent marker and survives icon updates; Enter and Space now open details without scrolling. A separate reviewer approved the fix, and actual Chrome key presses passed.

## Verification and release

- All 20 fast tests passed, including citywide source completeness, unchanged source hashes/dates, stable previous IDs, coordinate rejection, exact deduplication, durable signup, and location handling.
- TypeScript checking and the production build passed. The Worker contains 71 Next.js assets.
- Chrome verified all 1,064 map pins, full citywide initial bounds, 50-result progressive list, Show more and pagination reset, a map marker beyond the first list page, Enter/Space activation, every location type, and representative searches across all five boroughs.
- Synthetic Brooklyn GPS centering survives filters and repeated requests after Show collection. At 390px and 320px, an initially hidden map fits the citywide extent when revealed; list/search/details work without horizontal overflow.
- No uncaught browser errors. Evidence: `docs/features/citywide-browser-checks.json`.
- Published to the team's domain and retained public Sites preview after these checks.

Apple Maps still requires the team's domain-restricted web token. The active OpenStreetMap adapter was browser-tested. Official source data remains dated June 27, 2025; wider geographic coverage does not imply live availability or complete coverage of every NYC restroom.

## Release outcome

Both deployments completed on October 15, 2026, New York time, from source commit `d0166594506380f434b1f201a10decc124d01771`.

- Team domain: `https://nyc.imfinethanku.me/find/`; VPS release `20261016T011423Z-d01665945063`. Uploaded runtime checksum and local health check passed. Existing signup state remains outside releases.
- Original public preview: `https://restroom-ready-nyc.clcii.chatgpt.site/find/`; saved version 4, deployment `appgdep_6ad17a76caec8191b87de56b51dfe54a`, status `succeeded`. Its audience and D1 binding were retained.
- Independent live Chrome smoke passed on both hosts: HTTP 200, 1,064 pins, 50 initial list results, correct Staten Island and Brooklyn search results, Enter activation, and no browser errors. The check used fresh anonymous contexts and made no signup or account writes.

This release outcome was added after the matching source archive was published.
