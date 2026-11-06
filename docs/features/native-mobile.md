# Native mobile interaction refinement

Status: internal build 1.0 (6) is Testing in 4995 and Team; model, simulator and independent review checks passed
Date: October 23, 2026

## Brief and acceptance

The user found the first native screen too similar to a website, with too much text and too many buttons. The final screen has a full-height map, compact search, a directly visible Account profile button, and a Liquid Glass control panel for Filters/List/Locate. There is no branded header, Explore NYC heading or main-screen count. Search and body text use native 17-point defaults, with 20–22-point section/place headings. Adding a restroom and Saved are in Account; filters use a compact four-option sheet without descriptions. Buttons, ratings and navigation use neutral ink/gray. Brand blue belongs only to the app mark and restroom pins. The Google sign-in button is a neutral white pill with Google's unmodified original mark and native text. Entry / Route inside / Condition semantics remain; web-specific hero, border and page layouts do not govern the native interaction.

The user also requested Liquid Glass. Floating search/map controls use iOS 26 `glassEffect` in `GlassEffectContainer`; place actions use native glass button styles. These effects have iOS 18 material/button fallbacks and solid surfaces for Reduce Transparency. Content and forms remain readable native sections. Implementation follows [Apple’s custom Liquid Glass guidance](https://developer.apple.com/documentation/SwiftUI/Applying-Liquid-Glass-to-custom-views).

Acceptance: no hero/header on discovery; map independently pans and zooms; Map/List preserves the camera and query; search submit dismisses the keyboard and frames results; filtering shows selection/reset and explicit unknown semantics; detail has medium/large native presentation with reachable Directions/Save and dated evidence; native forms retain safe retries, labels and entered values after errors. Largest Dynamic Type uses a full-height detail sheet. Browsing remains anonymous; contribution schemas and ownership rules stay unchanged.

Location already authorized by the user is requested once on launch and centers/zooms the map. New permission prompts remain tied to explicit Locate. Automatic lookup preserves List and an active search. Coordinates remain in memory; GPS is not the public venue pin. Accuracy remains available in the venue form. Failure/outside-NYC messages remain available; successful lookup does not add a permanent status paragraph.

Build 5's filter sheet contains **Clean, Accessible, Public and Elevator access**, with independent selections combined with AND. Clear filters is red and Done is blue; there is no All row or explanatory copy. Clean keeps the public average threshold of at least 4 out of 5. Saved remains available through Account. Earlier three-filter checks below describe the prior interface.

## Plan and ownership

- Root: discovery, one presentation route, MapKit viewport/padding, UI tests and integration.
- Detail implementer: PlaceDetailSheet.swift and NativeAccountView.swift.
- Form implementer: NativeComponents.swift, NewRestroomForm.swift and ContributionForms.swift.
- Independent reviewer: source and final screenshot/interaction checks after integration.

Plan input: native mobile v3, existing source and iPhone 17 Pro screenshots. Separate Maya, Chloe and Alex persona sessions approved the direction, each 8/10 with no blocking findings. These are synthetic source/screenshot reviews, not customer tests. All recommended removing the marketing hierarchy, retaining dated facts, using native forms/sheets, and making List a complete alternative. Alex specifically identified camera loss on Map/List switching and sheet occlusion of selected pins; both are in scope.

Independent source review found three interaction issues: a returning user's code form could open before their own code loaded; Save/verify intent could be lost during sign-in; original unknowns could look like a claim that no visitor evidence existed. The revision waits for the right account/place/load state, saves only if not already saved, retains the exact code version until an explicit verification confirmation, and scopes original facts clearly. Follow-up v4 and final v7 source reviews approved with no remaining blockers. Native MapKit accessibility descendants are hidden in favor of a synthetic map entry that opens the complete venue list; List remains directly visible.

## Verification

Seven native data/filter tests pass. The actual Firebase-linked app and UI runner build on the authorized Mac Studio with Xcode 26.2. All four v7 XCUITests pass on iPhone 17 Pro:

- Search, full-row selection, medium/expanded detail actions and return with query preserved.
- Existing location permission reused on launch; nearest-first results and a zoomed current-location map.
- Filter selection/reset, empty-result recovery, visible Account and Saved sign-in gate.
- Largest accessibility text: bounded fields, reachable 44-point controls and full-height filter sheet.

Result: `/Users/zhelichen/Documents/RestroomReadyNative/native-mobile-v7.xcresult`. The simulator location test uses **40.7505, -73.9877**, a NYC test coordinate; it does not prove physical GPS accuracy. The app is left open at standard text size on the iPhone 17 Pro simulator.

Runtime checks found and fixed a plain list-row label that ignored taps on its blank space. Native row activation now covers the whole label. Replacing MapKit's accessibility tree reduced the complete large-text check to about eight seconds; earlier queries each took roughly seventeen seconds. Earlier v3/v4 interrupted runs and the v5 failed row assertion are not acceptance evidence; v6 and final v7 passed after correction.

Final screenshots: [Map](screenshots/native-mobile-map-17pro.png), [Account](screenshots/native-mobile-account-17pro.png), [Medium place](screenshots/native-mobile-place-medium-17pro.png), [Expanded place](screenshots/native-mobile-place-expanded-17pro.png), [Filters](screenshots/native-mobile-filters-17pro.png), [Accessibility text](screenshots/native-mobile-accessibility-17pro.png).

Final v7 visual input was the same four Map/Account/medium-place/expanded-place screenshots. Separate fresh Maya and Chloe persona sessions each approved, 8/10 with no blockers; the independent Alex reviewer also approved with no visual blockers. These are synthetic visual checks, not customer research or authenticated device validation. The inspected controls have clear Account access and readable neutral Directions/Save contrast.

No production records or authentication were created during UI testing. Real Google credential exchange, authenticated submissions, physical touch/GPS, on-device VoiceOver and older-iOS/Reduce Transparency appearance remain separate checks. Availability/fallback handling was reviewed in source. No commit, push or App Store release is included.

### Three-filter follow-up

The independent source reviewer approved the small filter revision with no blockers. Seven data/filter tests pass again, including unchanged Clean rating boundaries and Saved matching. The existing filter/empty-state/Account XCUITest also passes after rebuilding on the iPhone 17 Pro (v8, 22.3 seconds): exact All/Clean/Accessible labels, removed Public/No code/Saved sheet options, Clean selection, reset, empty-result recovery and Account → Saved sign-in gate. Result: `/Users/zhelichen/Documents/RestroomReadyNative/native-mobile-v8.xcresult`. This targeted rerun supplements the earlier four-case v7 run.

### Rating labels, destructive color and simulator sign-in

The user reported an unreadable rating button on a phone, requested red Sign out text, and reported unfinished simulator Google Sign-in. An ancestor ink foreground style was inherited by the two native prominent button labels. `RRProminentButtonLabel` now uses white while enabled and ink while disabled, fixing Save rating and the Saved sign-in gate without changing actions or authentication checks. Sign out has a nearest-level system-red label and retains its destructive role and disabled guards. Independent source review approved the final helper and both consumers with no blockers.

The final v10 Account/filter/Saved XCUITest passes (22.287 seconds) on iPhone 17 Pro, iOS 26.3. An isolated renderer using the actual style/helper and rating-label source verifies active, Saving and disabled contrast plus red Sign out; [the screenshot](screenshots/native-button-label-check-17pro.png) is a rendering check with inert actions, not a signed-in customer session. Earlier white-only disabled styling was rejected after visual inspection. Older-iOS visual appearance remains unverified.

Simulator Firebase startup logs identified error 17995 with OSStatus −34018, consistent with missing Keychain entitlements. The typed Xcode helper now configures simulator-only signing and app-specific Keychain entitlements; device/TestFlight signing stays automatic. Independent inspection parsed the rebuilt executable's simulated Mach-O entitlement section, verified fully expanded app/group identifiers, and confirmed the installed executable matches it. An isolated dummy-item Keychain probe passed create/read/delete with status 0 and matching data. Its exact item and temporary app were removed; it did not access user credentials or Firebase. The restored app's subsequent three-minute log window contained startup markers and no recurrence of either error. Google OAuth credential exchange itself still needs a real-account retry. Keychain failures now receive a specific message, without exposing raw errors or credentials.

Result bundle: `/Users/zhelichen/Documents/RestroomReadyNative/native-mobile-v10.xcresult`. Final implementation review approved the source and entitlement mechanism. The real app was restored at standard text size after the temporary checks. See the TestFlight record for internal build distribution.

### Approved compact card and unified Accessible follow-up

The user approved the compact-card preview and requested its native implementation. The integrated source now shows a small current rating beside the venue name, a bookmark Save, concise Entry/Route/Condition rows, Passcodes and Details & reports. Rating editing remains below in Details & reports; Directions stays reachable across the card's destinations. Empty visible-code feeds say **No known passcode**, with separate loading/error states. One Accessible label/status now serves the filter and detail view for both source types; explicit community answers take precedence, unknowns stay unconfirmed and raw source fields remain intact.

Twelve model tests passed. The actual Firebase-linked Mac Studio build and four anonymous workflows passed in `native-place-card-v2.xcresult`. After the final accessibility-size header refinement, both affected standard/large-text card flows passed again in `native-place-card-v5.xcresult`. The earlier v7–v10 results above describe the prior layout. Following the user's approval, internal build 1.0 (4) was signed and uploaded at 11:44:24 PM on October 22, 2026, America/New_York; the one-time desktop job and four temporary files were removed. Apple processing finished, and build 4 now shows **Testing** in both existing **4995** and **Team** groups. Only build assignment changed; no tester membership changed. Device installation and real-account checks remain pending. No commit or push is included. [The card feature record](native-place-card.md) holds the scope, screenshots, preserved contribution guards and remaining phone checks; [the distribution record](native-testflight.md#compact-card-and-unified-accessible-build-4) records the verified dashboard state.

### Multiple filters follow-up — October 23

The latest source exposes **Clean, Accessible, Public and Elevator access**, independently selected and combined with AND. There is no All row; no selections means unrestricted discovery. **Clear filters** is red, **Done** is blue, and selections persist after closing the sheet. Clearing preserves search and exits Saved mode. Elevator matching requires the reviewed source's explicit restroom-level route; a lobby elevator or general Accessible label does not qualify.

Nineteen model tests and both focused Firebase-linked iPhone 17 Pro checks passed for the initial multiple-filter revision, including normal and largest accessibility text. Independent source and screenshot reviews found no blockers. The final revision below retains these behaviors. [The filter record](native-multiple-filters.md) contains the actual screenshots, exact result bundles and data boundaries.

### Inline search and compact controls: build 5

Typing keeps the map visible and shows a bounded, scrollable Liquid Glass list of matching restrooms directly below the search field. It does not open a separate page or change the saved Map/List mode. Selecting a suggestion opens its existing place card and closes the keyboard; the query is retained. Empty successful reads show **No restroom was found** inline without an alert, with distinct loading/error messages. Filter descriptions are removed. Filter rows and Sign out retain 44-point minimum tap areas with less vertical padding; signed-in Sign out appearance and action remain a real-account check.

All 25 model tests passed. The actual Firebase-linked app passed four focused iPhone 17 Pro workflows covering filters/Account/Saved, inline empty recovery, suggestion selection and largest accessibility text. Targeted reruns verified map-dropdown scrolling/selection/mode retention and the final empty-result recovery change. Independent source and screenshot reviews found no blockers. Actual final screens: [map dropdown](screenshots/native-map-search-dropdown-17pro.png), [inline empty result](screenshots/native-search-no-matches-17pro.png) and [compact filters](screenshots/native-filters-minimal-17pro.png). The simulator was restored to normal system text size.

Internal-only **1.0 (5)** was signed and uploaded at **12:39:21 AM, October 23, 2026, America/New_York**, with signature/package checks and temporary-job cleanup independently confirmed. Apple processing finished; [build 5](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/0dee10da-4513-483a-8c45-5211e53f97c6) is **Testing** in both existing **4995** and **Team** groups. [The verified dashboard](screenshots/native-testflight-build5-testing.jpg) and [distribution record](native-testflight.md#multiple-filters-and-inline-search-build-5) record the result. No production data, tester membership, native Analytics or web deployment changed, and no testers were added or invited. Device installation and real-account checks remain pending. No Git commit or push is included.

### Map/List transition follow-up

The user reported an abrupt Map/List switch. Previously the toolbar changed `display` directly, with no animation transaction or explicit list transition. Manual and VoiceOver switching now use a scoped 0.22-second ease-in-out opacity transition. The existing MapKit view stays mounted to preserve its camera; the outgoing list remains above it during the fade, with Saved feedback above both. Reduce Motion disables this transition. Search, filters, source data and automatic location behavior are unchanged.

An independent source review found no blockers. The actual Firebase-linked app built on the Mac Studio and passed the existing anonymous map → searched list → compact place details → map workflow in **32.236 seconds**, with zero failures. Result: `/Users/zhelichen/Library/Developer/RestroomReadyNativeCard4/native-map-list-transition-v1.xcresult`. Tested `NativeRootView.swift` SHA-256: `ff002615dad7c80df78c73d59b71c71d299eb6b5c376338a2996c6acfb14c9a4`. The Reduce Motion branch is source-reviewed; no separate setting-enabled runtime check is claimed. No production writes were performed.

The subsequent [fitted filter sheet](native-multiple-filters.md#content-height-sheet-follow-up) uses the measured four-row height, supports scrolling and Dynamic Type, and fits its iPad presentation. Its Firebase-linked normal iPhone, largest-text and iPad checks passed in **38.277**, **53.166** and **38.794 seconds** respectively. Final reviewed `NativeRootView.swift` SHA-256: `acfda1e4120dd75dbc5e23eb2172d9638767163888d97e9f52600725c49c324a`.

Both refinements were signed and uploaded as internal-only **1.0 (6)** at **10:53:26 AM, October 23, 2026, America/New_York**. Signature/package checks, matching source hashes, successful upload and removal of the one-time desktop service and four temporary job files were independently confirmed. Apple processing finished; [build 6](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/20f55550-5618-4128-b918-c5e81b23df9e) is **Testing** in both existing **4995** and **Team** groups, with the final row and selected group options verified. [The dashboard screenshot](screenshots/native-testflight-build6-testing.jpg) and [distribution record](native-testflight.md#maplist-crossfade-and-fitted-filters-build-6) preserve the release evidence. No testers were added or invited; membership stayed unchanged. No production data, native Analytics or web deployment changed. Device installation and real-account checks remain pending. No Git commit or push is included.
