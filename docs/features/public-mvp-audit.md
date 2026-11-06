# Public finder and MVP audit

Status: Deployed and live checks passed
Date: October 20, 2026
Owner: Zheli Chen / project engineering

## Brief

Make the complete NYC finder available without the shared team passcode. Google Sign-in continues to protect personal saves, notes, ratings, venue-code contributions and new-restroom submissions. Keep private restroom codes private; the removed site gate is separate from venue entry codes.

Audit the existing MVP on desktop and mobile, repair concrete failures, and publish the checked result. Preserve dated city-data provenance, honest unknowns, the isolated sample demo, privacy-conscious Analytics, and durable waitlist/email behavior. Do not manufacture production customers, ratings, venue reports, code checks or signup conversions during testing.

## Acceptance and plan

- `/find/` and its exported payloads load without a shared cookie or runtime gate secrets. Old `/access/` bookmarks lead to the finder; retired gate API requests cannot unlock or mutate accounts.
- Public navigation calls the finder a finder, with no obsolete lock or team-access controls. Venue passcodes and owner-only visibility remain intact.
- Verify search, all five filters, sorting, progressive results, map clusters, selection, directions, location success/error behavior, and account prompts.
- Check saved places, private notes, half-star ratings, new-place address selection and public/private passcodes with isolated demo Firebase emulators and security-rule regressions.
- Check the homepage, benefit pages, waitlist validation/failure handling, thank-you guards, deployed Analytics configuration and automated email regressions without sending unapproved production email.
- Inspect 320px, 390px, 768px and desktop layouts: no horizontal overflow, reachable actions, usable forms, map/list switching, detail back navigation, keyboard focus and error messages.
- Run Node regressions, TypeScript, the production build and an independent integrated review; deploy using existing destinations and preserve database/runtime configuration.

## Ownership and review

The access implementer owns Worker/Node/development routing, legacy access migration, related tests and current access documentation. Root owns finder/demo UI, responsive repairs, browser checks, integration and deployment. The Firebase auditor owns independent account/data review and isolated emulator verification. The independent reviewer checks the plan and integrated behavior against the acceptance criteria, with persona-grounded source review. Historical feature records remain historical.

The independent reviewer approved the access-removal plan before implementation. Completed browser evidence, exact checks, repairs and release results are recorded below.

## Verification

Completed checks:

- All **129 Node regression tests passed**. The first sandbox-only attempt could not open local test servers; the permitted run passed without failures or skips.
- TypeScript checking and the Next.js production static export/standalone Worker build passed. The final package contains 96 assets. No local QA route, synthetic account, emulator project, or shared finder credential setting is in the production client bundle. Production Firebase project and Analytics ID are present.
- The Firebase auditor passed **338 security-rule cases** and **12 integration scenarios using the actual application SDK methods**, on isolated demo namespaces. See [Firebase audit](mvp-firebase-audit.md).
- Root completed **27 browser checks** and **32 layout checks** across eight page types at actual widths of 320, 390, 768 and 1440 pixels. No document/body horizontal overflow was found. Mobile email fields remain 16px; filter controls remain at least 44px high. See [browser evidence](public-mvp-browser-checks.json).
- Browser flows covered search, progressive 50/100/150-result loading, filters, map clustering and individual pins, mobile detail/back navigation, walking-link destinations, account restoration, saves, native-date private notes and deletion confirmation, keyboard/tap/drag half-stars, public ratings while signed out, new-restroom address/pin selection and submission, private-code auto-saving, owner sharing changes, code verification and sign-out privacy.
- Demo checks covered private/public code previews, 40-character codes, verification invalidation, notes, low-rating Clean exclusion, sample creation and reset. Initial pointer coordinates were captured during focus scrolling; settled-coordinate reruns passed in the demo, real finder and a temporary event-trace page. No slider implementation change was needed.
- Signup failure retained the entered email in the UI. The final production preview saved one synthetic address to temporary SQLite and reached the thank-you page, with email credentials explicitly absent and zero confirmation jobs. No production signup, vote, location, code check or email was generated during QA.
- Source-level independent technical review and separate Maya/Chloe/Alex persona review sessions approved the artifact without blockers. The persona outputs are simulated source reviews, not customer interviews. Final integrated release review is recorded separately.

Repairs made:

1. Removed shared finder protection in the Worker, Node server and development proxy. Legacy access URLs redirect to `/find/`; the old API returns 410 and clears its cookie. Removed the unlock form, lock control and gate configuration examples.
2. Public marketing navigation and demo navigation now lead directly to the full finder. Updated current privacy/setup guidance and corrected the obsolete small-area coverage sentence.
3. Removed the obsolete full-width mobile access-control row, keeping the logo and sign-in control together where they fit.
4. Successful demo location requests switch to the map and close the detail sheet. The optional MapKit adapter now chooses a neighborhood-sized region when locating, rather than preserving citywide zoom.

Limits:

- The browser Google-provider account flows used an explicitly local-only test page and the Auth emulator. That page was removed before the production build. Actual Google OAuth completion was not established by this test harness.
- Native mouse-pointer and keyboard actions were tested at mobile viewport sizes. They do not substitute for physical iOS Safari touch, keyboard and operating-system permission checks.
- Browser location acquisition timed out in the embedded browser and displayed the recovery message. Unit tests cover success, denial, timeout, cancellation and accuracy. No GPS permission was bypassed.
- Leaflet/OpenStreetMap rendered and its tile/cluster controls worked. The optional Apple Maps adapter's zoom repair is type/source checked; a genuine Apple token/rendering session was not available for live verification.
- Existing email confirmation transport and Analytics privacy/lead guards passed regression tests; actual inbox delivery and GA account receipt were not re-created with fake production customers.

## Release

The final independent review approved the integrated diff, all 27 browser and 32 layout results, persona input hashes and the production asset scan, with no blockers.

- Primary host: [nyc.imfinethanku.me/find/](https://nyc.imfinethanku.me/find/), VPS release `20261020T042531Z-032f089b084d`. Deployment completed and `/api/health` returned 200. The release includes the checked local changes; its metadata records `source_dirty=true`. This task did not commit or push the user's GitHub repository.
- Existing Sites mirror: [restroom-ready-nyc.clcii.chatgpt.site/find/](https://restroom-ready-nyc.clcii.chatgpt.site/find/), version **21**, managed source commit `3a154e00644a1d3ffb17c9c807af36271ecfb5fa`, deployment `appgdep_6ad6ed9f04d88191884a75107d4dc8f5`, status **succeeded**. The packaged Worker matched the checked VPS build.
- Fresh anonymous requests on both hosts returned 200 for the homepage, three benefit pages, demo, finder, privacy, thank-you and the actual exported finder payload `/find/index.txt`. The nonexistent `/find.txt` returned the expected 404. Legacy `/access/` returned 308 to `/find/`; the retired access API returned 410. Both clear the obsolete access cookie. No unlock or lock control appeared.
- Live browser checks on the primary host confirmed 1,064 city locations, working Bryant Park search, loaded signed-out ratings, the full-width 320px detail sheet, 390px map/list navigation and citywide clusters. Both hosts completed their public Firebase reads without a browser console error. Screenshots: [finder at 390px](screenshots/public-mvp-finder-390.png), [detail at 320px](screenshots/public-mvp-detail-320.png), [map at 390px](screenshots/public-mvp-map-390.png).
- A live Google sign-in attempt entered the connecting state, but the embedded harness exposed no OAuth popup. This does not establish successful production OAuth completion; the account test limit above still applies.
- Existing databases and runtime credentials were preserved. Owned local preview servers and isolated Auth/Firestore emulators were stopped after verification; no production contribution, signup or email was generated.
