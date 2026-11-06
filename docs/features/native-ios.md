# Native iOS application

Status: Native app 1.0 (7) is Testing in the existing 4995 and Team groups; authenticated/device rehearsal checks remain
Date: October 23, 2026

## Brief and acceptance

Port Restroom Ready to native SwiftUI and MapKit, retaining the web application and the existing `nye-restroom` Firebase backend. Browse without an account; require the same Google account for private data and contributions. Preserve stable place IDs, explicit unknowns, original source dates and visitor observation times.

The native workflow is find a place → inspect entry, route and conditions → open walking directions → optionally save or contribute. Acceptance covers clustered native maps, inline search suggestions, list and combined Clean, Accessible, Stair Free, Public and Elevator access filters, permission-aware current location, real Google sign-in, saved places and private notes, half-star ratings, separate private/public passcodes with dated checks, atomic new-place submissions and public structured observations. Curated source reports and imported source comments retain their attribution and limits.

No new database, webview, invented ratings, automatic GPS disclosure, schema changes, public source writes or analytics instrumentation are required. App Store publication and an App Store review are separate from a local native build.

## Architecture and ownership

- Root: inspect/copy the user-created project, shared place models, MapKit/CLLocation, resources, package/signing configuration and integration.
- Backend implementer: native Firebase/Google authentication, session-scoped listeners and exact existing atomic contribution contracts in Services.
- Interface implementer: SwiftUI discovery/detail/account/forms, reusable accessible half-star gesture control.
- Independent review: plan/persona checks before implementation; integrated code and build checks afterward.

Retain **B — Inspection checklist** fact grouping and neutrals: #EEF2F3 ground, white surfaces, #1E2A30 ink and #56666E supporting text. Per the user's later color instruction, brand blue #2B59C3 belongs only to the mark and restroom pins; native controls are ink/gray, with system red for Sign out. Preserve separate Entry, Route inside and Condition groups, source dates, and persistent form labels. The [mobile refinement](native-mobile.md) replaces the initial web-like layout with a full-screen map, native sheets/forms, system typography and Liquid Glass controls. There is no branded header on discovery; the approved mark remains the app icon. The initial rectangular cards and button grids are historical, not the current native layout requirement.

On October 22 the user explicitly selected **native iOS fonts**. Body, heading and metadata styles therefore use Dynamic Type system fonts; no downloaded fonts are bundled. Native sheets and platform pickers remain native. Browse and contributions use the same records as the web; private caching is memory-only and clears on account changes.

## Dependencies and checks

The manually created project is copied from Downloads into `ios/`. Actual bundle ID: `coms4995.Restroom-Ready`; selected team preserved. Firebase 13.1.1 needs Xcode 26.2 or newer. The user authorized SSH builds on `zhelichen@Zhelis-Mac-Studio.local`; its Xcode 26.2 / Swift 6.2.3 were verified. The current isolated build folder is `/Users/zhelichen/Library/Developer/RestroomReadyNativeCard4`, with fresh `DerivedDataClean` and `SourcePackagesClean` caches; the primary simulator is iPhone 17 Pro. Older results below retain their original Documents paths.

Real dependency resolution exposed a Google Sign-in 10.0.0 App Check range conflict. The project pins Google's official compatibility commit `4ce331c226c24cfee688b31e9c3731cc5c5e2862`, which supports App Check 12. The local `NativeDependencies` package explicitly enables Firebase's `Firestore` trait for Xcode 26.2. These changes retain Firebase 13.1.1 and use no SDK fork. Two confirmed Swift compiler errors were corrected: Google's Swift error enum name and a caught-error/property name collision.

Checks: pure model/filter validation; Swift syntax/type checks where toolchain allows; package/project inspection; simulator build/run, denied-location/manual search, small/large text layouts, authentication and real backend read/write verification when a compatible toolchain is available. Production writes during QA require clearly bounded disposable records and cleanup; no invented production venue or rating.

## Current mobile verification

The current native interface follows [the mobile refinement](native-mobile.md), [approved compact card](native-place-card.md) and [multiple-filter/search revision](native-multiple-filters.md). It has neutral Liquid Glass controls, visible Account access, no branded/Explore heading, authorized-location auto-zoom, four combined filters and a scrollable search dropdown over the map. Empty successful searches say **No restroom was found** inline, without an alert or separate page. Compact filter and Sign out rows retain 44-point minimum tap areas. Build 6 adds a camera-preserving Map/List crossfade with Reduce Motion support and content-fitted filter-sheet sizing for iPhone, large text and iPad.

All 25 model tests passed for the unchanged data/filter rules. The Firebase-linked app passed four focused anonymous iPhone 17 Pro workflows for build 5's search/filter revision, plus its affected dropdown and empty-result recovery reruns. The later crossfade roundtrip and fitted-sheet checks passed at normal/largest iPhone text and on iPad. Independent source and screenshot review found no blockers. The earlier whole-star correction passed nine model tests and 108 rating security/wire-type cases and is retained. Internal-only **1.0 (6)** was signed and uploaded at **10:53:26 AM on October 23, 2026, America/New_York**, with signature/package, source-hash, successful-upload and temporary-service/file cleanup checks independently confirmed. Apple processing finished; [build 1.0 (6)](native-testflight.md#maplist-crossfade-and-fitted-filters-build-6) is **Testing** in the existing **4995** and **Team** groups, with [the dashboard screenshot](screenshots/native-testflight-build6-testing.jpg) recording both assignments. No testers were added or invited, and membership stayed unchanged. Installation, a genuine signed-in iPhone contribution, physical GPS/touch and presentation mirroring remain rehearsal checks. The initial port checks below describe the earlier layout and dependency integration.

## Initial port reviews and verification

The independent style plan review identified the initial native rounded cards, capsule filters, system grouped surfaces and generic tab navigation as departures from direction B. Those were replaced with the approved finder hierarchy and controls. Follow-up review corrected field labels, touch targets, pressed contrast, body-size unknowns, original-source dates, large-text header wrapping and straight-line-distance wording.

Separate source-only persona review sessions used the current Maya, Chloe and Alex definitions against native style v2. Each returned approve (8/10), with no blocking findings. These are synthetic checks, not customer interviews or visual runtime approval. Their optional suggestions concerned a faster dated-observation summary above the original listing details.

Seven pure directory/filter/source tests pass with `swift test --package-path ios`. Updated map/location code and all views also type-check against the installed iOS SDK; the earlier isolated UI typecheck used temporary backend stubs and does not establish real Firebase behavior. The actual SDK-linked app and UI-test runner compile on the Mac Studio. Both read-only XCUITests passed on the iPhone 17 Pro: anonymous discovery/search/detail/account and the largest accessibility text size. Screenshot review identified a scaled Locate icon overflowing its button at accessibility text size; the supporting icon is now capped at 28 points while text and tap targets retain accessibility behavior. The Account title now uses inline native navigation. The anonymous workflow was rerun after these corrections and passed, including an explicit Account navigation-title assertion.

The final Xcode build succeeded. The full two-test result bundle is `/Users/zhelichen/Documents/RestroomReadyNative/native-ui-tests-2.xcresult`; the final anonymous workflow result is `native-ui-tests-final.xcresult` alongside it. The app is installed in the Mac Studio's iPhone 17 Pro simulator. Screenshots:

- [Discovery, native text](screenshots/native-ios-discovery-17pro.png)
- [Original source and entry details](screenshots/native-ios-detail-17pro.png)
- [Route inside and condition](screenshots/native-ios-route-condition-17pro.png)
- [Account](screenshots/native-ios-account-17pro.png)
- [Largest accessibility text](screenshots/native-ios-accessibility-17pro.png)

No production locations, votes, passcodes or accounts were created during these checks. Google credential exchange, authenticated writes, physical GPS/touch and App Store release are separate remaining checks unless later verification below explicitly records them.

## Structured hours, entrances and Stair Free: build 7

The [structured-access update](structured-access-details.md) adds Stair Free and separately sourced hours/entrance/route details. Only Peninsula received new facts; existing community documents stay unchanged. All **31 model tests** passed. The Firebase-linked simulator build succeeded, and focused run v6 `testStructuredPeninsulaHoursEntranceAndRoute` passed in **46.197 seconds** after correcting a test-only lazy-row scrolling assertion.

Apple accepted **1.0 (7)** at **12:18:41 PM, October 23, 2026, America/New_York**. Strict deep signature, expected team/bundle/build, 29 privacy manifests, the app's own dSYM and all six source hashes passed pre/post-build checks. Upload success and removal of the temporary desktop service and three job files were verified; the existing nonblocking prebuilt-SDK dSYM warnings remain. Apple processing finished. With the user's approval, [build 7](native-testflight.md#structured-hours-entrances-and-stair-free-build-7) is **Testing** in the existing **4995** and **Team** groups; both assignments were verified in the [dashboard](screenshots/native-testflight-build7-testing.jpg). No testers were added and membership stayed unchanged. Eligible existing testers can update through TestFlight; device installation remains unverified.
