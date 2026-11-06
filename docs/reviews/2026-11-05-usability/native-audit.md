# Native iOS usability and function audit — November 5, 2026

Completed with findings and explicit coverage gaps. Recommendations only; product source and production data were not changed.

## Current results

- **170/170 pure model tests passed.** [Model evidence](native/model-test-summary.json).
- **20 real Firebase-linked simulator UI cases ran: 16 passed, 4 failed.** The initial 17-case run passed 14; the final three audit-only cases passed two. [Exact cases, durations, failures and cleanup](native/runtime-evidence.json).
- The two final expanded-card cases passed at normal text (94.555 seconds) and the largest accessibility text (135.758 seconds). They cover the actual pull-up gesture, Save cancellation, source navigation, empty/half-star drafts, vertical-scroll intent, rating cancellation, public-note cancellation and new-code cancellation.
- The current Hours-specific normal/largest-text cases also passed earlier today on the **identical 129-input snapshot**. [Hours record](../../features/native-hours-ui-checks-20261105.json).
- The long public-code-history path at largest text remains incomplete. This audit does not establish that every native function works.

## Scope and method

Inspected every current native screen/service path listed in the coverage matrix, current repository guidance, and the installed Firebase Authentication skill. The [129 frozen inputs](native/frozen-input-hashes.json) match both the final local checkout and the restored isolated Mac Studio source. Xcode 26.2 built the real Firebase-linked app for the isolated iPhone 17 Pro simulator running iOS 26.3.1. Dependencies were frozen, automatic package resolution was disabled, and this read-only QA build used no signing identity.

Existing signed-out public paths ran against public records. The unified public-note form used its existing DEBUG-only review entry: no Auth user was fabricated and Share stayed disabled. Three added [audit-only UI cases](native/NativeAuditCases.swift) were appended only to the isolated test copy, then restored automatically by the [bounded script](native/run-isolated-ui-audit.sh). No product Swift file was edited. A separate reviewer independently checked the forms/account source findings.

Actual Apple/Google credential exchange, private account data, signed-in mutations, production deletion, physical GPS/touch and real iPhone Apple Intelligence were excluded. A successful source/model check is not counted as an authenticated end-to-end result. Current TestFlight/released-artifact status was not queried.

## Findings

### N1 · P2 — Authorization recovery names an action the user cannot find

Evidence: source. Confidence: high.

1. A signed-in contribution receives permissionDenied or unauthenticated.
2. The shown error says to refresh your account.
3. Open Account: no Refresh account action is available.

Impact: The user has no matching recovery control and may abandon or recreate a pending draft.

Recommended change: Offer a clear reauthentication/retry action that retains the exact draft, or change the wording to the actual supported sign-in-again steps. Keep ambiguous-save wording.

Source: [NativeStore.swift:1115](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Services/NativeStore.swift:1115>), [NativeAccountView.swift:74](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NativeAccountView.swift:74>).

### N2 · P2 — A pending code report uses the ordinary discard warning

Evidence: source. Confidence: high.

1. Submit Report a new code.
2. The write response is not confirmed, leaving attempted nonnil and Retry on screen.
3. Tap Cancel: rrFormDismissal was not passed hasAttempt, so it says unsaved changes will be lost.

Impact: The warning implies that a possibly accepted report was never saved; leaving loses the stable retry ID. A later new report can duplicate a successful first report.

Recommended change: Pass hasAttempt: attempted != nil to the shared dismissal behavior and keep its existing may-already-have-reached-server explanation. Do not change the idempotent transaction.

Source: [ContributionForms.swift:375](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/ContributionForms.swift:375>), [NativeComponents.swift:292](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NativeComponents.swift:292>).

### N3 · P2 — Coincident map pins have no member-list fallback

Evidence: source-and-bundled-data. Confidence: medium.

1. Search Tompkins Square Park and frame both matching venues on the map.
2. Tap the grouped marker repeatedly.
3. Both stable IDs share exactly the same coordinate, while the handler only zooms the cluster bounds.

Impact: Zooming cannot spatially separate identical coordinates. A user may need to switch to List to select a member. The max-zoom interaction has not been separately runtime verified.

Recommended change: When cluster bounds are coincident or further zoom cannot split it, present its matching venue rows. Preserve each stable ID and the existing List fallback.

Source: [RestroomMapView.swift:121](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Map/RestroomMapView.swift:121>).

### N4 · P3 — The signed-in rating-loading state is rendered twice

Evidence: source. Confidence: high.

1. Open Rate and Comment while the own-rating request is loading or has failed.
2. Both ratings and its nested ratingEditor render the same progress/error/Retry loading rating UI.

Impact: Duplicate status copy and retry controls make an already dense page longer, especially with large text.

Recommended change: Keep one loading/error/retry block within Cleanliness rating, shared by the saved-rating summary and draft editor.

Source: [PlaceDetailSheet.swift:1155](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/PlaceDetailSheet.swift:1155>), [PlaceDetailSheet.swift:1209](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/PlaceDetailSheet.swift:1209>).

### N5 · P3 — Provider-error copy asks users to fix app configuration

Evidence: source. Confidence: high.

1. A noncancellation Google or Apple sign-in error reaches the generic catch branch.
2. The message asks the user to check native Firebase/account configuration.

Impact: Ordinary users cannot act on developer configuration instructions.

Recommended change: Show a concise user action such as check connection and try again or use the original sign-in provider; retain a non-sensitive diagnostic category outside the product copy.

Source: [NativeStore.swift:849](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Services/NativeStore.swift:849>), [NativeStore.swift:888](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Services/NativeStore.swift:888>).

### N6 · P2 — The unified-note disclosure omits the public visit time

Evidence: runtime-form-copy-and-source. Confidence: high.

1. Open Add a public note.
2. Choose a precise Visited date/time.
3. The footer says the note and observations are public but does not explicitly identify the visit time as public.

Impact: A user can publish a precise visit timestamp without the explicit disclosure required by the project guidance.

Recommended change: Include “visit time” in the existing single-line public disclosure, for both anonymous and named modes; keep the current anonymous default.

Source: [ContributionForms.swift:142](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/ContributionForms.swift:142>), [NativeStore.swift:1970](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Services/NativeStore.swift:1970>), [AGENTS.md:47](</Users/cc/Desktop/4995/nyc-restroom/AGENTS.md:47>).

[Screenshot](screenshots/native-visit-disclosure-normal.png).

### N7 · P2 — Invalid codes silently disable standalone and new-restroom submission

Evidence: source. Confidence: high.

1. Enter a code longer than 40 characters or with a non-ASCII symbol in Report a new code, or in Add restroom after choosing Code required.
2. Save/Add becomes disabled.
3. Neither form shows the length/character problem next to the code field.

Impact: The user cannot tell which field blocks submission or how to correct the pasted code.

Recommended change: Show a concise limit hint and inline code-validation message, reusing the unified-note form’s existing feedback behavior at ContributionForms.swift:192. Preserve leading zeros and allowed keypad symbols.

Source: [ContributionForms.swift:350](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/ContributionForms.swift:350>), [NewRestroomForm.swift:27](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NewRestroomForm.swift:27>), [NewRestroomForm.swift:120](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NewRestroomForm.swift:120>).

### N8 · P2 — Venue-hours Today text truncates the closing time at largest text

Evidence: runtime-screenshot-and-source. Confidence: high.

1. Use the largest accessibility text size.
2. Open Morgan Library & Museum and inspect its collapsed Hours row.
3. The value wraps its Venue hours qualifier and Today prefix, then ellipsizes at 10:… without a closing time.

Impact: The compact value does not provide a readable full Today schedule for this venue-scoped example; the user must expand it.

Recommended change: Allow the Today schedule to wrap fully at accessibility text sizes, or put the required venue/restroom-unconfirmed qualifier on a separate supporting line. Preserve the qualifier and the full expanded schedule; do not shrink the user’s system font.

Source: [PlaceDetailSheet.swift:532](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/PlaceDetailSheet.swift:532>), [PlaceDetailSheet.swift:632](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/PlaceDetailSheet.swift:632>).

[Screenshot](screenshots/native-amenities-large.png).

### N9 · P2 — Long code history puts the primary report action below all reports; largest-text scrolling remains unresolved

Evidence: runtime-limitation-and-source. Confidence: high for placement; medium for gesture interpretation.

1. Open Whole Foods Market Passcodes with largest accessibility text.
2. The initial existing case reaches the Used and Invalid authentication gates, then cannot fully expose Report a new code in six bounded gutter pans.
3. A separate expanded-sheet centre-pan case opens Sign in during its first pan before an intentional feedback tap; it stops before measuring the report action.

Impact: Code history is long and the primary report action is placed after every code/source card. The largest-text action path is not fully verified, even though normal text passes.

Recommended change: Move Report a new code above the history or keep it readily available; consider compact older-report rows while retaining every date/code/evidence. Check real-touch scroll cancellation over the feedback buttons before changing gesture behavior.

Source: [PlaceDetailSheet.swift:971](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/PlaceDetailSheet.swift:971>), [PlaceDetailSheet.swift:1083](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/PlaceDetailSheet.swift:1083>).

[Screenshot](screenshots/native-code-history-large.png).

[Follow-up screenshot](screenshots/native-code-scroll-opened-signin-large.png).

Limit: An automated press-and-drag that activated Sign in is not proof of a physical swipe bug. No valid report-action pan count was obtained; do not describe it as permanently unreachable.

## Separate prior-request mismatch

### N10 · P2 — Filter-only empty results stay inline rather than showing the earlier requested native alert

Filter-only empty results are also inline. With an empty search, applying all five filters renders “No restroom was found”; Done closes the sheet without an iOS alert. This was exercised by the existing filter case and is visible in the [filter screenshot](screenshots/native-filters-normal.png).

The earlier user instruction requested a system popup for no matching bathrooms. The later instruction scoped inline/no-alert feedback to typed-search results. Current source, tests and AGENTS instead apply the inline rule to all empty results. This is a request/documentation divergence, separate from a heuristic preference about alerts.

Recommended contract: a native alert for a completed filter-only application that has a successful empty result, while typed-search remains inline. Preserve loading/failure distinctions; do not alert while required feeds are still loading. Source: [empty-state routing](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NativeRootView.swift:120>), [ready-state text](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NativeRootView.swift:292>), [Done action](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NativeRootView.swift:409>).

## Interpreting the runtime failures

The two initial normal-text failures stop while a legacy helper tries to expose a lower card action. An explicit native pull-up followed by the same reading/protected-action workflow passes in the independent follow-up, at both text sizes. This establishes an operable expanded path; the original failed cases remain recorded rather than relabeled as passing.

The existing largest-text code-history case reaches Used and Invalid provider-choice/cancel flows, but its six-pan helper cannot fully expose Report a new code. The separate expanded-sheet follow-up fails earlier: its first automated centre-content press-and-drag opens Sign in before an intentional code-button tap. It does not collect a valid Report-a-new-code pan count. This is unresolved scrolling/action friction, not proof that the report button is permanently unreachable or that a physical swipe has the same defect. No further test or product repair was attempted.

Native stars differ from the web control: [NativeComponents.swift:407](</Users/cc/Desktop/4995/nyc-restroom/ios/Restroom Ready/Views/NativeComponents.swift:407>) locks the first drag direction after the 12-point threshold and only updates a horizontal drag. Both final UI cases confirm that the chosen vertical gesture leaves all stars empty; taps and horizontal slides then choose 2.5/3.5 stars without a write. This is simulator-gesture evidence, not a physical-touch guarantee.

## Coverage matrix

Runtime here means this frozen simulator snapshot. Source/model means inspected code and pure checks; gated means a real account, device or mutation was deliberately not invoked.

| Workflow | Current evidence | Limits / checks |
| --- | --- | --- |
| Map / List / camera | passed navigation; camera invariance source-reviewed — NativeRootView.swift:86,339,466; RestroomMapView.swift:39 | Camera is retained by the mounted map; Reduce Motion path source-reviewed. Cluster taps and exact camera equivalence need explicit runtime inspection. |
| Search dropdown / keyboard / selection | passed — testSearchSuggestionsOpenPlaceWhileTyping | Bounded suggestions scroll, typing keeps keyboard, selection opens the place, query survives close. |
| Filters AND / Clear / no matches | passed — testFiltersEmptyRecoveryAndAccountMenu; testNoMatchesStayInlineAndFiltersRetainCriteria; DirectoryTests | All five options, persistence, AND logic, red/blue actions, inline empty results and clear-search criteria preservation. |
| Locate / denied permission / outside NYC | source-only — LocationService.swift:22-83; NativeRootView.swift:559-591 | No physical GPS or new permission decisions; no user device permissions changed. |
| Selected sheet half / full / reopen | passed normal and largest text — testRestroomSearchAndListOpenAtSameHalfHeight | Both opening paths start half-height, actual toolbar pull-up and collapse work; lower-row navigation needs separate explicit expansion coverage. |
| Hours today / full week / provenance | runtime-verified same snapshot — docs/features/native-hours-ui-checks-20261105.json; HoursScheduleTests | Two focused normal/largest-text cases passed earlier today on the identical 129-input snapshot. All seven rows frame-checked; NY midnight/DST model-tested. |
| Directions | source-and-control-visibility — PlaceDetailSheet.swift:725-738 | Opens Apple Maps walking mode in source; actual handoff/routing and physical wheelchair route not invoked or validated. |
| Save / signed-out continuation cancel | passed normal and largest-text explicit-expanded follow-up — testAppleAndGoogleChoicesFromAccountAndPlaceActions; PlaceDetailSheet.swift:741-851 | Save auth cancellation leaves Not saved; no authentication or saved-data write. Real signed-in save/unsave remains gated. |
| Saved / Return to main map | source-only — NativeRootView.swift:175,313-322,473-501 | A real private Saved library is not loaded; signed-in return action not runtime invoked. |
| Account signed out / privacy / cancellation | passed normal and largest text — testFiltersEmptyRecoveryAndAccountMenu; testMapAddRestroomCancellationAndSimplifiedAccount | No Saved/Comments/Delete/Sign out displayed anonymously; provider/footer reachability checked. |
| Account signed in / Sign out | source-only — NativeAccountView.swift:74-159; NativeStore.swift:243-264,903-907 | No genuine account used; real sign-out and session clearing not exercised. |
| Comments by you / owner history | source-only — NativeAccountView.swift:197-304; NativeStore.swift:665-745 | Owner-scoped bounded receipts, loading/empty/error/history and missing-listing branch inspected; not runtime loaded. |
| Apple / Google sign-in | choices and cancellation only — NativeSignInOptions.swift; NativeAppleSignIn.swift; AppleSignInChallengeTests | Real OAuth, Keychain persistence, restored account and first-account Analytics receipt remain gated. |
| Cleanliness draft / half stars / vertical scroll | passed normal and largest text; model passed — PlaceDetailSheet.swift:1149-1225; NativeComponents.swift:384-436; CleanlinessRatingTests | Vertical drags leave no score selected. Explicit taps and horizontal drags choose half stars; Submit opens provider choices; cancellation retains the draft. No vote is written. |
| Public notes read / sources / original dates | passed normal expanded follow-up and largest-text discovery/source case — PlaceDetailSheet.swift:1229-1455; NativeStore.swift:334-507 | Public reads only; contribution ownership/name/actual timestamps source/model reviewed. |
| Unified public-note form | passed normal and largest text, local review only — testUnifiedVisitFormReview; ContributionForms.swift:83-269; UnifiedVisitFieldsTests | Actual DEBUG form, no fabricated user, Share always disabled; observed-amenity choices, anonymous default, optional code and private default reviewed. |
| New restroom form | signed-out gate passed; form source-only — testMapAddRestroomCancellationAndSimplifiedAccount; NewRestroomForm.swift; AddressSearch.swift | Real address/nearby selection and new venue write require a signed-in user; not bypassed. |
| Public code history / Used / Invalid gate | normal passed; largest-text path incomplete — testPublicCodeHistoryAndProtectedFeedback; CodeEvidenceTests | The existing largest case reaches Used/Invalid cancellation but cannot fully expose Report a new code within six pans. Final centre-pan case opens Sign in before intentional feedback tap. No permanent-unreachability claim; no verification vote. |
| Private code / visibility / report confirmation | source/model; new-code auth cancellation passed normal and largest text — ContributionForms.swift:344-433; NativeStore.swift:1373-1490; CodeEvidenceTests | Actual private data, code creation, sharing/removal, consensus mutation and confirmation are gated. Only protected-entry/cancel behavior was run. |
| Amenities / Accessible / Report a problem | passed normal and largest text — testReviewedAccessibleAmenitiesMatchFilter; testRoomSpecificChangingStationUsesShortAmenity; ReviewedAccessibilityTests | Shared indexed filter/display contract and controlled labels checked. Report action auth-cancel only. |
| Condition / Apple Intelligence summary | source/model plus simulator empty-state visibility — PlaceDetailSheet.swift:556-611; OnDeviceVisitorSummary.swift; VisitorReportSummaryTests | The simulator displayed the optional Visitor reports heading and empty state. No real summary generation or iPhone inference is claimed. Structured-only prompt and stale/cancel/unavailable logic are model-tested; full public notes remain device-independent. |
| Delete account | source/model plus anonymous boundary — NativeAccountView.swift:33-48,186-194; NativeStore.swift:910-1088; AccountDeletionTests | No provider reauthentication/revocation, cleanup request or actual account deletion performed. |
| Analytics | source/model only — NativeAnalytics.swift; NewAccountAnalyticsTests | Simulator collection disabled. Only physical confirmed new accounts emit sign_up; no current Realtime receipt is claimed. |
| Offline / retry / malformed feeds | source/model only — NativeStore.swift selected feeds; DirectoryTests; CardResearchProfileTests | No network/firewall toggle or live permission failure induced. Memory-only data and loading/failure/unknown paths reviewed. |
| Large text / alternate systems / assistive settings | largest iPhone text passed in discovery, Account, sheet expansion, amenities, local unified form and expanded rating/note/code cancellation — selected Z UI cases; NativeGlass.swift; accessibility labels and adjustable action source | Full long code-history action path remains incomplete. Physical VoiceOver, iOS18, iPad/small iPhone, and enabled Reduce Transparency/Reduce Motion appearance were not runtime tested. |

## Evidence and cleanup

- [Full findings with exact source lines and reproduction steps](native/source-findings.json).
- [Per-workflow coverage JSON](native/coverage.json).
- [Initial UI summary](native/usability-summary-v1.json) and [final three-case summary](native/usability-summary-v2.json).
- [Initial screenshot manifest](native/proofs-v1.json) and [follow-up screenshot manifest](native/proofs-v2.json), with SHA-256 hashes; screenshots are unchanged exports.
- [Coincident-pin data evidence](native/coincident-pins.json): two groups / four bundled stable IDs. No IDs or records were merged.

Visually reviewed the normal filter sheet, search dropdown, signed-out Account, expanded Peninsula card, unified-note public disclosure and private-default optional code; also reviewed large-text concise amenities/Hours truncation and code-history/final Sign in screenshots. The full normal/largest-text seven-day Hours proofs were reviewed in the linked Hours record. Other saved captures supplement frame/content assertions; they are not all claimed as individually visually reviewed.

All 129 final local/remote input hashes match the frozen baseline. The temporary test extension was restored, the original dependency cache hash is unchanged, and the isolated simulator is Shutdown. The user simulator remained Shutdown. The original frozen release folder was not written by this audit. No temporary desktop signing job, provider sign-in, production contribution, account deletion, signing identity, TestFlight/group change, deployment, commit or push occurred.
