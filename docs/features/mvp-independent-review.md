# Independent MVP review

Date: October 20, 2026
Input: baseline `032f089b084d15ff5e59987225aa5af1552041da`, followed by the public-finder audit working tree.
Review type: independent source inspection and focused local regression checks. Browser observations and deployment evidence belong to [the integrated audit](public-mvp-audit.md); this document does not turn source inspection into a live end-to-end result.

## Plan review

Approved the access implementer's plan before implementation: remove the shared finder gate from Worker, Node preview and development routing; send legacy `/access/` links to `/find/`; retire `/api/finder-access`; remove lock UI and gate-secret dependencies. The user's request explicitly authorizes this change. Firebase account authentication, private account data, restroom-code ownership and signup/email-dispatch protections remain required.

## Findings sent to the implementer

1. **Apple Maps location did not zoom to the neighborhood — repaired.** `components/finder/mapkit-map.tsx` now sets a neighborhood region with latitude/longitude spans of 0.012 after an explicit successful location request. The Leaflet path already zoomed to level 16. Source and TypeScript checks support the repair; genuine Apple Maps rendering remains an explicitly recorded verification limit.
2. **Demo location was hidden on mobile — repaired.** `components/demo/explorer.tsx` now closes the detail, clears its previous map focus and selects Map after location success. GPS success/cancellation behavior has unit coverage; the browser session observed the timeout/recovery path rather than physical-device GPS success.
3. **Narrow filter row needed measurement — concern resolved without speculative CSS changes.** The coordinator's actual-width measurements passed for all 32 page/viewport combinations at 320, 390, 768 and 1440 pixels, with matching body/document widths and no horizontal overflow. Filter controls remained at least 44px high. This source concern did not become a confirmed defect.
4. **Marketing coverage copy needed reconciliation — repaired.** The landing page now describes the dated NYC city-data collection rather than promising coverage only in a small part of NYC. Public navigation leads directly to the finder and distinguishes the sample demo.

The list's `Purchase · Floor · Conditions / Not reported` summary was also questioned during review. Checking `communityRestroomToPlace` showed these specific fields remain null in the current community schema; entry permission and step-free-route reports are separate facts. It is accurate for the current schema and requires no correction.

## Source checks

- Search includes names, operators, venue types, addresses, neighborhoods and access notes; it normalizes accents and case. Empty and no-match queries have recovery actions.
- Filters distinguish official-directory provenance, visitor-reported public entry, attributable 4+ cleanliness averages, the exact city `Fully Accessible` label, and current-account saved IDs. Unrated places never become clean; community step-free reports never become a city accessibility label.
- Distance sorting starts only after actual geolocation. Directions use the selected destination and an origin only when location is available. Coordinates are excluded from Analytics.
- Map and list share the full filtered collection, with progressive list rendering. Leaflet has grouped markers, keyboard activation, selection reveal, resize handling, collection reset, and a list fallback when tiles fail. Apple Maps has equivalent list fallback and clustering; its location zoom issue is listed above.
- Location requests have a watchdog, permission/availability/policy messages, coordinate validation, accuracy handling and cancellation guards. No remembered university starting point is restored.
- New-place forms start with an empty venue pin. Explicit address/GPS lookup offers candidates; selection fills address and coordinates together. Manual corrections remain possible. Failed writes preserve the draft and stable retry ID; account changes clear the form and stale callbacks.
- The log form uses a native modal dialog, return-focus handling, Escape/save guards and a keyboard cycle. Invalid hidden coordinate fields open their containing details before focus. Inputs have persistent labels and field-specific errors. Physical iOS keyboard behavior still needs an actual device check.
- Venue codes are separate from the removed site access code. Public reports are readable signed out; signing in is required to contribute or verify. Private code editors and callbacks are UID/place scoped; Only me is the default. Visibility and code updates retain independent reports and timestamps.
- Half-star controls use the stars themselves, a 44px interaction surface, pointer capture, cancellation handling, keyboard steps and a focus outline. The supported range is 1 to 5 in 0.5 steps.
- Ratings and private note forms scope displayed data to account/place, preserve failed edits, require real observation dates, and avoid presenting a successful write as failed solely because refresh failed.
- The sample demo has no Firebase account initialization or cloud writes. It visibly labels sample facts and reset behavior; public preview hides private sample codes and editing controls. Its ratings, filters, save behavior and per-report ownership are separate from the real finder.
- Signup retains the email on failure and navigates to thank-you only after a successful response. Analytics accepts only known HTTPS production hosts/routes, strips arbitrary queries/referrer details, excludes email/code/account/coordinate values, and guards the confirmed-signup event against direct thank-you visits and reload duplication.

## Focused regression evidence

Executed from the product repository:

```sh
node --test tests/location.test.mjs tests/restroom-filters.test.mjs tests/geocoding.test.mjs tests/demo-state.test.mjs tests/analytics.test.mjs tests/nyc-import.test.mjs
```

Result: **46 passed, 0 failed, 0 skipped**. This covers the location model; geocoding privacy and malformed/out-of-area response handling; filter boundaries; citywide import provenance and stable IDs; demo rating/save/reset/code ownership behavior; and Analytics sanitization, navigation deduplication and success-only lead events. It does not establish real Google authentication, production Firestore writes, GA account receipt, physical-device geolocation, or email delivery.

After the gate slice was ready, independently ran `node --test tests/access.test.mjs`: **4 passed, 0 failed, 0 skipped**. The initial sandbox run could not open its temporary localhost listener (`EPERM`); rerunning with local-server permission passed. The suite exercises public finder HTML/RSC in the actual packaged Worker and Node fixture, legacy redirects/cookie expiry, the retired endpoint, and retained signup/dispatch protection. The integrated gate source diff has no blocking findings.

## Persona-grounded evaluation

These are review lenses from the existing fictional composite definitions in the course repository, applied by this independent reviewer. They are not new interviews or customer validation. Final behavior must still pass the integrated technical and browser checks.

### Maya — usable conditions and quick lookup

Removing shared access matches her low tolerance for setup. Public cleanliness is separate from unknown soap/paper/stall facts, with a clear explanation that an average does not establish current conditions. Dated private visit notes offer usable details without falsely publishing them as reviews. The source remains incomplete for her conditions-first decision; maintaining explicit unknowns is acceptable, while inventing condition facts would be a blocker.

### Chloe — sources, dates and uncertainty

The directory preserves city update/retrieval dates, visitor observation/submission distinctions and record provenance. Code updates and successful-use checks have separate times; changing a code clears its prior verification. Public browsing must not inherit a misleading team-access prompt or call demo facts real. The location-view concerns above were sent for correction; the current list unknown summary was checked against its data model and is accurate.

### Alex — entry rules and the route inside

Details keep purchase/code requirements, published hours and street-to-restroom route fields separate. City accessibility labels are qualified and do not certify stalls; community step-free reports do not become official accessibility labels. Accurate location zoom, working directions, narrow-screen details/back navigation and an accessible list alternative are the important completion checks for his on-the-move use.

## Integrated review

**Approved for the planned deployment; no blocking finding in the reviewed integrated artifact.** This is a pre-deployment engineering approval, not a claim that production has already been updated.

Independently inspected the final source diff, current setup/privacy guidance, production export, [the coordinator's audit](public-mvp-audit.md), [browser evidence](public-mvp-browser-checks.json), [Firebase audit](mvp-firebase-audit.md), and the separate [Maya](mvp-maya-review.md), [Chloe](mvp-chloe-review.md) and [Alex](mvp-alex-review.md) review records. Current hashes for the landing page, finder explorer/detail/ratings/passcodes, finder CSS, privacy page and filter implementation match the persona input hashes recorded for those files. The three separate persona sessions approve their scoped source artifact without blockers.

The coordinator reports 129 Node regressions, successful TypeScript and production build, 338 Firebase security-rule cases and 12 actual application SDK scenarios. Those broader suites were performed by the coordinator/backend auditor; the 50 independently executed focused checks are listed above. The browser JSON contains exactly 27 passing behavior checks and 32 passing actual-width layout checks, with no failed entry. The root's browser account/write flows used isolated emulators; they did not create production customers or venue data.

The earlier star-drag investigation found no implementation defect. The event trace records primary mouse pointerdown/move/up with buttons pressed during motion and a final 1.5 selection. Fresh settled-geometry reruns passed in the real finder and demo. Pointer, keyboard, disabling and component-state paths are consistent with these results; no speculative slider code change was introduced.

An independent scan of all **96 exported assets** found no temporary QA route/account heading, demo test project namespace, or shared finder-passcode/signing-secret variable. The removed QA page is absent from source routes. Existing emulator support is guarded by an explicit build-time flag, demo project ID and localhost hostname; the checked production bundle does not include the test identities or project namespace. `git diff --check` passes.

Deployment must preserve existing databases and unrelated runtime secrets, and the coordinator should confirm anonymous `/find/` access and legacy-route migration after publishing. Existing documented limits remain: actual Google OAuth completion, physical iOS touch/keyboards/GPS permissions, genuine Apple-token rendering, and new live GA/inbox receipt were not established by this local audit. These are stated accurately rather than represented as completed device or production tests.
