# Native major-action Analytics

November 5, 2026. Implementation and verification record for the expanded iPhone event coverage and Account sign-out transition. Distribution status is recorded separately in the build receipt.

[Build **1.0 (17)**](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/510e5381-8af7-4db8-90c6-93041893df51) is **Testing in Team only**, with two existing testers. No public review was submitted. See the [distribution receipt](native-build17-distribution.json).

## Intended behavior

Track major discovery, navigation, authentication and contribution actions in the existing Firebase Analytics iOS stream. Keep first-time account creation distinct from returning login, attempts distinct from confirmed saves, and directions handoffs distinct from physical restroom visits. The Account screen fades between authenticated and signed-out content after the account state changes; Reduce Motion disables that fade. The explanatory sign-out footer was removed without changing sign-out or saved-data behavior.

## Event contract

`Models/NativeAnalyticsEvent.swift` is the closed, typed event contract. `Services/NativeAnalytics.swift` is the only SDK logging boundary. All events include bounded `event_schema` and `app_build` values. Screen reporting is manual; automatic screen reporting remains disabled.

| Workflow | Events | Meaning |
| --- | --- | --- |
| Navigation | `screen_view` | Actual screen appearances; consecutive identical screens are suppressed. |
| Restroom cards | `restroom_open`, `restroom_expand`, `restroom_collapse` | Open origin is a fixed category; height changes concern an already presented card. |
| Details | `detail_section_open`, `detail_section_close`, `source_open` | Fixed section labels and deliberate source-link actions; no linked URL is sent. |
| Search | `search_submit`, `venue_select` | Result-count bucket plus restroom/address context; no query, address or selected venue identity. |
| Filters and map | `filter_toggle`, `filters_apply`, `filters_clear`, `browse_mode_change`, `map_cluster_open` | Fixed filter names, Boolean selections and bounded count ranges. |
| Location | `locate_request`, `locate_result` | Explicit request and coarse outcome; no coordinates or location history. |
| Directions | `directions_open` | Accepted Apple Maps handoff; does not establish arrival or a restroom visit. |
| Forms | `form_open`, `form_cancel` | Form type only; cancellation means a clean Cancel or confirmed Discard, not Keep editing, success or account change. |
| Authentication | `auth_start`, `auth_cancel`, `auth_error`, `sign_up`, `login`, `sign_out` | Provider choice/outcome; `sign_up` requires Firebase's confirmed new-user result for the current account. Returning login is separate. |
| Saved places | `place_save`, `place_unsave` | Confirmed operation, not a button tap. |
| Cleanliness | `rating_submit`, `rating_remove` | Confirmed rating action; no rating value or restroom identity. |
| Public notes and problems | `visit_note_submit`, `visit_note_remove`, `amenity_problem_submit` | Confirmed action; no text, author, venue or visit time. |
| New restrooms | `restroom_submit` | Confirmed listing creation; no location or venue fields. |
| Passcodes | `code_report_submit`, `code_report_remove`, `code_visibility_change`, `code_verify`, `code_feedback_used`, `code_feedback_invalid` | Confirmed action only; no code, visibility value, report ID or verification timestamp. Code-used feedback is a user's report, not independently established use. |
| Account and privacy | `account_delete`, `privacy_open` | Confirmed deletion or deliberate privacy-link action. |
| Failed writes | `action_error` | Fixed action and coarse failure category. Stale-account and cancelled operations are excluded. |

The existing `sign_up` key event remains the account-acquisition conversion. Routine taps and actions are ordinary events; this work does not turn them into conversions or rename historical lead data. Event counts require use of the new physical-device build; no historic actions are backfilled.

## Confirmation and privacy boundaries

Mutation logging runs only after the existing server confirmation and final account-generation check. Stable draft/report receipts deduplicate successful retries in bounded device memory. Repeat explicit actions get a new local receipt. Receipt keys, Firebase user IDs and other local ownership identifiers never become event parameters or diagnostic trace content. Failed or stale operations do not emit success.

The payload API cannot accept arbitrary strings. It excludes email, names, account/record IDs, searches, addresses, coordinates, note text, passcodes, visit dates, source URLs and raw error strings. Advertising consent remains denied; IDFA/IDFV collection and automatic screen reporting remain disabled. No Analytics user ID is set. Firebase may still process normal app-instance, device, platform and usage data as described on the privacy page.

Simulator collection remains disabled. An opt-in DEBUG trace records only the allowlisted payload locally for UI verification, has a 500-event bound and resets on launch. Trace and Account-transition preview hooks must be absent from the Release binary. The presentation preview creates no Firebase user and does not call sign-out or emit a successful sign-out event.

## Verification

The pure-model suite passes 178 tests, including seven event-contract, GA4 limit, count-boundary, all-filter-combination, deduplication and new-versus-returning-account cases. The independent review, Firebase-linked simulator runs, Release guards, live privacy-page checks and final distribution readback are recorded in their separate receipts. Source/model verification does not establish real credential exchange, authenticated production writes, physical GPS, or GA4 Realtime delivery from a phone.

A recorded presentation check found that adding an opacity transition to the original `Group` still left an abrupt content switch while the Account sheet resized. The final presentation uses a top-aligned `ZStack` with explicit layer order so outgoing and incoming cards can overlap during the fade. A settled screenshot or source modifier alone is not evidence that an animation actually runs; the final runtime receipt records the video/frame check separately. The DEBUG reduced-motion preview checks the same animation-selection branch, without claiming that it changes the simulator's system accessibility preference.

No database schema, Firestore rules, Firebase app registration, tester membership or external distribution changes are part of this feature. No Git commit or push is included.
