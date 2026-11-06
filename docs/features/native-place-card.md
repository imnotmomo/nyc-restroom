# Native place card

Status: historical build 4 record. The current revision is documented in [Hours and Amenities](native-hours-amenities-card.md) and [on-device Visitor reports / Rate and Comment](native-visitor-summary.md). Build 4's Entry / Route / Condition layout and editor placement are superseded.
Date: October 22, 2026
Owner: native app integration

## Brief and acceptance

The existing detail sheet put too many facts and contribution controls on the first screen. The user approved an interactive compact-card preview, then requested its implementation and one unified **Accessible** label. The native card now puts the venue name and a small current cleanliness average together, followed by Entry, Route inside, Condition, a passcode summary and **Details & reports**. Save is a bookmark beside the heading; at accessibility text sizes it moves into the toolbar to leave the full width for the venue name. Directions remains reachable at the bottom. The editable star control stays below, in Details & reports.

Acceptance: use real public rating totals; distinguish loading, failure and an empty feed; say **No known passcode** only after the relevant visible-code feeds have finished without an error. Missing codes do not mean that a venue needs no code. Keep source/observation dates and explicit unknowns. Passcodes and Details & reports open native destinations with a back path; Directions remains available on both. Long names and accessibility text sizes must wrap without hiding navigation or actions. Native system fonts, neutral controls, visible Account and the existing iOS 26 Liquid Glass/fallback rules remain.

## Plan and source changes

- `Views/PlaceDetailSheet.swift`: compact overview, small rating summary, native Passcodes and Details & reports destinations, heading bookmark/close controls, and persistent Directions. Public code summaries retain separate update and verification dates. Full ratings, visitor observations, private notes, original facts and source history remain in their respective detail sections.
- `Services/NativeStore.swift`: explicit public-rating loading state so a feed still loading is not shown as an empty rating history. Existing public read queries, selected-place/account guards, memory-only cache and contribution operations remain.
- `Models/Place.swift`: one derived accessibility status and label shared by the Accessible filter and detail display. An explicit community `stepFreeAccess == "yes"` qualifies a community listing; original directory records qualify only from their exact positive accessibility value. Community unknown/negative values take precedence over any directory field. Partial, missing or malformed values and free-text notes do not create a positive status. Raw source fields remain intact; the main interface has no separate city accessibility label.
- `Views/NewRestroomForm.swift`: use **Accessible** for the existing structured route answer. The explanation still states that a street-to-restroom step-free report does not certify stall features. This is a label/derived-status change, with no public schema migration.
- `UITests/NativeUISmokeTests.swift` and `Tests/DirectoryTests.swift`: cover compact-card navigation and retained anonymous rating sign-in action, standard/large text, and exact unified accessibility boundaries.

The layout reuses the existing signed-in rating, note, visit and code editors. It preserves private-by-default codes, owner-only visibility changes, exact-version code verification, safe retries, account/place guards and the existing half-star rating contract. Browsing stays anonymous; contribution actions still require Google Sign-in. No Firestore rules, collection schemas or public venue records change for this work. Native Analytics remains disabled.

## Review and verification

The approved preview included the small rating beside the name, lower rating controls, **No known passcode**, and one Accessible label. Independent source review identified a missing loading indicator; the integrated source now keeps rating loading, unavailable and no-rating states distinct. Persona feedback for the preview is a design simulation, not a customer test or verified venue evidence.

Twelve Swift model tests passed: ten directory/filter/source cases and two rating serialization/validation cases. The new accessibility cases cover community precedence, unknown/negative/malformed answers, positive directory values and preserved provenance. The actual Firebase-linked application builds on the Mac Studio with Xcode 26.2. All four anonymous simulator workflows passed in `native-place-card-v2.xcresult` (103.4 seconds): discovery/detail navigation, authorized-location startup, filter/Account recovery and largest text. After the final full-width accessibility heading refinement, both affected standard/large-text card workflows passed again in `native-place-card-v5.xcresult` (31.2 and 40.4 seconds). They exercise both drill-downs, the lower rating sign-in action without starting OAuth, persistent Directions, Back/Close and query restoration. No production writes were made.

The simulator uses a synthetic NYC location. Refresh that fixture immediately before these runs: the location service rejects samples older than 120 seconds. Earlier stale-fixture and superseded runs are not acceptance evidence. Actual native screenshots: [overview](screenshots/native-place-card-overview-17pro.png), [Passcodes](screenshots/native-place-card-passcodes-17pro.png), [ratings](screenshots/native-place-card-ratings-17pro.png), and [large text](screenshots/native-place-card-large-text-17pro.png). Independent source and separate Maya/Alex screenshot reviews found no blocking issues; persona reviews remain synthetic design checks.

Remaining device checks: inspect the card on an iPhone at standard and larger text sizes, exercise the real rating editor and code visibility/verification with the intended account, confirm walking directions and physical touch, and rehearse presentation mirroring. These are separate from anonymous simulator coverage. No invented production contribution is needed for layout QA.

## Delivery and follow-up

The final unsigned release archive `RestroomReady-1.0-4-card-unsigned.xcarchive` succeeded. Its package checks confirm arm64, iOS 18 minimum, version 1.0/build 4, the existing bundle and Firebase registration, 29 valid SDK privacy manifests, and no UI-test bundle or P12 file. All six changed native source/test hashes match between the primary checkout and Mac Studio. This is package verification, not signing or upload.

After the user's **Upload now** approval, the one-time desktop job signed and uploaded build 1.0 (4) at **11:44:24 PM, October 22, 2026, America/New_York**. The signed archive is `/Users/zhelichen/Library/Developer/RestroomReadyNativeCard4/archives/RestroomReady-1.0-4-card.xcarchive`. Independent inspection confirmed its strict deep signature, expected team/bundle/version, 29 valid privacy manifests and matching tested source hashes. The successful job exited 0; its exact launchd job and all four temporary files were confirmed removed. See [the distribution record](native-testflight.md#compact-card-and-unified-accessible-build-4) for retry and upload details.

Apple processing finished, and [build 1.0 (4)](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/36d668aa-afee-48e9-80fa-7b1127edf024) now shows **Testing** in both existing **4995** and **Team** groups. [The dashboard screenshot](screenshots/native-testflight-build4-testing.jpg) records the verified state. Only this build was assigned; no tester membership changed. Eligible existing testers can update through TestFlight, while device installation and real-account behavior remain unverified. No commit or push is included.

Keep a concise overview without dropping evidence: navigation can move editing and history lower, while current facts still need their loading state, source and date.
