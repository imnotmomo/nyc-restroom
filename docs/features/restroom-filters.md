# Restroom discovery filters

## Request and plan

Replace the location-type buttons with the team's requested **ALL, Public, Clean (4★+), Accessible, and Saved**. Keep the existing brand, citywide directory, search/sort/paging, map selection and private saved-place flow. Let the five buttons wrap with 44px minimum touch targets on mobile.

The source audit found 1,064 official public-directory listings, 619 facilities with the exact city label `Fully Accessible`, and no cleanliness ratings. Public-directory inclusion does not establish free admission, public ownership or unrestricted entry. The city's accessibility field describes the building facility; it does not establish the internal route or restroom stall. Existing private condition notes are not public star ratings.

Independent plan review recommended literal source predicates, a dedicated Clean empty state, visible accessibility/source explanations, and narrow-screen wrapping. No backend change or generated ratings are needed.

## Semantics

| Filter | Match | Current source |
| --- | --- | --- |
| ALL | Every imported location | 1,064 |
| Public | Official public-restroom dataset URL and a source record ID, including privately owned public spaces | 1,064; entry rules and fees may vary |
| Clean (4★+) | Attributable public cleanliness rating with a finite 0–5 average at least 4, positive integer rating count, and HTTP(S) source URL | None; the source has no public star ratings |
| Accessible | City facility label exactly `Fully Accessible` | 619; partial/limited/not reported do not qualify |
| Saved | IDs saved to the current signed-in account | Account-dependent |

Clean remains usable and explains the missing ratings instead of guessing. Accessible results display available source access notes in the list, including cautions about lifts, keys and particular restrooms. The existing dated status and unknown route/stall details remain visible.

## Verification and release

- All 27 fast tests passed, including the seven new filter tests for source identity, star thresholds/provenance, missing/private observations, exact facility labels, saved IDs and unchanged source records.
- TypeScript checking, production build and whitespace checks passed.
- Independent integrated review found no blocking issues.
- Chrome verified the exact filter order and counts (ALL/Public 1,064, Clean 0, Accessible 619), privately owned public-space inclusion, Clean empty-state recovery, the visible facility qualifier, and Countee Cullen's source note about its out-of-order lift.
- Signed-out Saved opened the actual Google sign-in screen; cancelling preserved the current filter. No Google credentials were entered and no account records were written.
- At 320, 390, 650 and 850px, all five controls remained visible with at least 44px targets and no horizontal overflow. Buttons wrap at 320px. Clean recovery and Accessible worked at each size. Mobile and desktop screenshots were visually reviewed.
- Browser evidence: `docs/features/filter-browser-checks.json`; screenshots under `docs/features/screenshots/filters-*.png`. No uncaught browser errors.

No Firebase rules, records, authentication configuration or database schema changes are included.

## Release outcome

Both hosts were updated on October 15, 2026, New York time, from source commit `7f7469cc1e9e29d87c6e19213ba222da890a59bb`.

- `https://nyc.imfinethanku.me/find/`: VPS release `20261016T012053Z-7f7469cc1e9e`; runtime checksum and health check passed. Signup storage remains outside releases.
- `https://restroom-ready-nyc.clcii.chatgpt.site/find/`: saved version 5, deployment `appgdep_6ad17bfbd98081918e3babdc00fc6322`, status `succeeded`. Existing public access and database binding were preserved.
- Independent live Chrome verification passed on both hosts: exact five labels, Public 1,064, Clean 0 with its explanation, working recovery to ALL, Accessible 619 with its visible qualifier, and no browser errors. No login or data writes were performed.

This release outcome was added after publication of the matching source archive.
