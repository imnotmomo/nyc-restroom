# AGENTS.md

## Project and branches

`main` owns Restroom Ready's native SwiftUI/MapKit iOS app and shared Firebase/backend source. `webapp` preserves the Next.js website, moderator dashboard and marketing pages. See `docs/branches.md` for ownership. A branch push is not a website deployment, Firebase rollout or TestFlight release.

Read `README.md` and `ios/README.md` before changing the native app. Preserve other contributors' work and keep raw research captures, local account data, private deployment state and build artifacts out of commits. The current source includes unreleased App Store safeguards and the signup reliability repair; released builds 18/19 remain separate snapshots.

## Native application

The native iOS client is in `ios/`, using SwiftUI and MapKit with the same Firebase backend. Read `ios/README.md` and `docs/features/native-ios.md` before changing it. Preserve the web client on the `webapp` branch; do not restore its Next.js frontend to `main`. The iOS bundle ID is `coms4995.Restroom-Ready`; it has a separate iOS registration in `nye-restroom`. Google callback configuration must match that registration. Latest Firebase requires Xcode 26.2 or newer; do not downgrade SDKs to hide a build blocker or claim native runtime verification from syntax checks. Use the Xcode/Firebase skills, preserve memory-only Firestore cache and account-generation guards, and never commit local Firebase CLI credentials or signing keys.

Native iOS uses system fonts and Liquid Glass navigation/actions, without a branded page header or Explore NYC heading. Keep Account directly visible. Brand blue belongs to the logo and restroom pins; native controls stay neutral, with native system red for destructive actions such as Sign out. Existing location permission may be reused on launch to center the map, without a new permission prompt; preserve active searches/List mode and keep coordinates in memory. See `docs/features/native-mobile.md` for current interaction and verification details.

Account has no Your library section. Keep Saved places in Account. Add a restroom lives in a compact circular Liquid Glass + on the map, reusing the existing sign-in and form-resume flow. Align its right edge with the bottom glass bar using the same trailing inset. Account deletion removes authentication and private data while retaining public restroom submissions and cleanliness ratings without their account ownership links. Anonymous votes live in an Admin-only sibling collection; preserve public rating counts, sums and timestamps. Any future total repair must include both normal and anonymous votes. See `docs/features/native-map-add-and-anonymous-contributions.md`.

Show Saved places and Comments by you in Account only for a signed-in, nonanonymous user. Comments by you loads only that account’s bounded private ownership receipts and paired public notes, with separate loading, empty, error and truncated-history states. Opening a comment dismisses Account before presenting its restroom in the shared half-height card; an unavailable listing keeps the comments page open with a clear error. Omit the Browse without an account heading. Keep Privacy and data use as a small underlined dark-gray link, followed by the small dark-gray notice about dated listings and changing entry rules, codes and conditions. The signed-out sheet fits its content, with this footer directly below the sign-in card rather than pinned across a large empty gap. At accessibility text sizes, use a large scrolling sheet so the full footer and sign-in controls remain reachable. The signed-in account keeps its existing bottom footer.

In Saved mode, replace the bottom Filters control with Return to main map. That action clears the search and selections, leaves Saved mode, and uses the existing animated map transition without forcing a new camera position.

Rate and Comment has one Cleanliness rating section containing the public summary, saved-rating controls and empty interactive draft, and one Visitor notes section containing public comments and structured visit details. Keep only Add a public note: one protected form combines an optional public comment with optional observed details. What you noticed includes Elevator present and Automatic door present, both defaulting to Not reported. Preserve compatibility with existing notes and reports; unknown observations do not become amenity facts or positive filter matches. Anonymous defaults on directly below Visited; turning it off uses a safe exact account display name validated against a fresh Firebase name claim, never email or UID. Code required Yes reveals an optional immutable V2 code with a separate private-default visibility choice. New unified visits use an additive schema and an atomic visit/receipt/optional-code transaction; retain old schemas and records. See docs/features/unified-visit-reports.md. Keep visit and posting times separate, namespace the two source IDs and order the shared feed by posting time. Keep a compact Condition row before Passcodes on the main card, using dated reported observations on every device; do not infer conditions from star ratings or AI output.

Assign future internal TestFlight builds to the existing **Team** group only, unless the user explicitly specifies otherwise.

Every restroom card opens at half height and can be dragged to full height, including at accessibility text sizes. Keep both medium and large native detents, prioritize resizing before content scrolling, and reset the selected detent in the shared place-selection action when opening a card. Do not reset it during nested navigation, sign-in or form dismissal. Background map interaction is enabled only at half height.

The native filter sheet has independent **Clean, Accessible, Stair Free, Public and Elevator access** selections combined with AND; no selections means unrestricted discovery. There is no All option. Clear filters is system red and Done is system blue, as explicitly requested; other controls retain their established colors. Clearing preserves the search and leaves Saved mode. Stair Free requires an explicit complete-route report, not a city accessibility label or missing stair count. Elevator matching uses only an explicit structured report or reviewed evidence of an elevator to the restroom level, never a lobby elevator or a general accessibility inference. See `docs/features/native-multiple-filters.md` and `docs/features/structured-access-details.md`.

Keep that sheet compact, with no descriptions or instruction footer. While typing, show matching restroom suggestions directly below search; selection opens the place card. Successful empty results say “No restroom was found” inline, with no no-match alert or large map overlay. Loading/failure and Saved sign-in states stay distinct. Native rows retain at least 44-point tap targets without redundant vertical List/Form padding.

The native place card keeps the real rating beside the name, a bookmark control, two compact Hours / Amenities rows, a Rate and Comment destination, a Passcodes destination and one Directions action. Place Condition below Amenities and Passcodes directly below Condition. Group Rate and Comment and Sources & dates together below the optional Visitor reports summary. Sources & dates opens directly; do not add separate Entry & route or Visitor reports navigation destinations. Keep the rating editor and all visit-note actions inside Rate and Comment, with five initially empty interactive stars. Submit rating appears only after an explicit star choice. Sliding uses half-star steps; a vertical scroll must not choose a score. Signed-out choices stay in memory and require sign-in on Submit; provider selection never submits a vote. Restore the pinned draft only for the intended sign-in continuation, clear it on other account/place changes, retain it on failures and clear it after confirmed success. Existing saved ratings remain separate from a new empty draft. Known directory restroom hours remain visible while the optional entrance feed loads or fails. Amenities contain only supported positive facts, using short labels such as Elevator, Accessible and Stair free; do not infer automatic doors or accessible stall features. Entry restrictions, exact entrance instructions, floor, source dates and longer evidence remain reachable within Sources & dates; rating and public anonymous visit-note management stay together under Rate and Comment. Use “No known passcode” only after successful empty code reads; loading and failures have distinct states. See `docs/features/native-place-card.md` and `docs/features/native-hours-amenities-card.md`.

Sources & dates is the single reference destination. Preserve the exact entry, floor, route, original listing and research evidence there without duplicate Entry & route or Visitor reports navigation rows. Public/saved rating information, rating removal, public anonymous visit-note creation/read/delete, and the public Add a public note action belong in Rate and Comment on every device. Keep these rows at least 44 points high without redundant vertical padding. Show only known entry/route facts, preserving explicit negative answers and zero stairs; loading/failure must not become an empty result. Unknown entry permission stays hidden. An explicitly reported purchase requirement keeps its actual observation date and is not inferred from customer-only entry. Raw schedules, exact instructions, provenance and dates remain available in the focused destinations. Preserve Back, Close, Directions and existing protected contribution flows.

The native card keeps its dated Condition row and offers a separate short **Visitor reports** summary through Apple's on-device Foundation Models framework. Hide only the AI summary when the system model is unavailable or Apple Intelligence is disabled. Full public notes and reports remain readable on every device, and authenticated note/report contribution does not depend on AI availability. There is no cloud fallback. The model chooses one or two grounded highlights from bounded, strictly validated public structured observations; app-built clauses preserve conflicting answers, with deterministic observation dates/counts and an on-device AI label. Never send note body text, identities, coordinates or passcode values to the model. A summary never changes venue facts, ratings, filters or stored reports. Cancel/discard stale replies on snapshot/place/account changes, backgrounding and close. See `docs/features/native-visitor-summary.md`.

Legacy public visit notes stay **public** and displayed as **Anonymous**, with no account identity in their payload. The new unified visit form replaces standalone note creation and lets users explicitly opt into displaying their exact safe account name; anonymous remains the default. Never loosen the strict legacy note schema to add attribution or comments to legacy visits. Place all note input and management inside Rate and Comment. Public reads require no login; publishing/removing an owned note requires Apple or Google authentication, a stable draft, explicit action and the atomic public-note/private-receipt transition. The form must state that text and visit time are public. User-written body text can identify its author despite the Anonymous label; do not claim it contains no personal information. New clients do not load or write legacy private notes. The user authorized publication of team-owned legacy notes, but a complete authenticated audit found zero stored private notes, so no migration is required. Preserve old schemas for compatibility; never silently publish future legacy private writes. Account-deletion policy 3 must clean paired public notes before removing private receipts/Auth, with a persistent minimum policy of 3 before enabling new writes. See `docs/features/public-visit-notes.md`.

New native passcode reports use immutable per-report V2 records and a global private ownership reservation, preserving earlier public code versions. Main shows the public code with the latest successful-use verification; a verified code outranks an unverified one, and report time breaks verification ties or orders codes with no verification; Passcodes details retains all recent reports until the newest by report time has four distinct nonowner accounts currently reporting successful use; then keep that report and the main card’s preferred verified report if different. An older verified report must never hide a new unverified alternative. This hides history only in presentation. Keep Used and Code didn’t work as visible bordered buttons; Report a new code opens a private-default stable draft. Use exact version-pinned, paired public counts/private exclusive votes; repeated Used refreshes its time with zero count delta, and Invalid never creates a successful-use date. Owners cannot contribute to their own consensus. Preserve legacy schemas and private visibility. See `docs/features/native-code-reporting.md`; policy 3 and additive rules/indexes must be deployed before new writes.

Amenities uses short controlled labels across every restroom card. Keep its disclosure for the concise list and a small underlined Report a problem action; put exact source claims, dates and links in Sources & dates instead of the amenity dropdown. The problem action reuses the protected unified public-note form, defaults Anonymous on and explains that visitor reports do not automatically change venue facts.

Use one **Accessible** label across city and community listings. The web shared resolver and native `Place.isReportedAccessible` / `accessibilityLabel` drive both filtering and display. A supplied community report owns its status, including unknown or negative values; it cannot fall back to a positive city field. Retain original evidence and route details without a separate city accessibility label in the interface. A reported status does not confirm stall features, entry permission or current availability. For native discovery, the bounded reviewed-accessibility index makes independent research available before a card opens. The card and filter use the same Place resolver. Explicit negative or partial evidence vetoes a positive label; independent reviewed evidence may fill unknown primary accessibility without modifying original fields. It never creates a Stair Free or elevator match. Rebuild the index reproducibly from the existing reviewed profiles when those claims change.

Structured hours, entrance and route reports use the optional public, administrator-written `restroomAccessDetails/{placeID}` record. Preserve the existing strict community schema for older clients. Match exact stable IDs and validate the separate report, observation and update timestamps. An absent report preserves existing facts and unknowns; an explicit unknown or negative route/elevator answer takes precedence. Only Peninsula has newly supplied entrance/hour facts in the October 23 update. Never fill other venues' unknowns or infer public entry from 24/7 hours.

## Before making changes

Before editing user-facing copy, UX, or product behavior:

1. Read `docs/brand_position.md`.
2. Read `docs/style_guide.md`.
3. Check relevant persona-agent feedback when making major user-facing changes.
4. Do not invent product capabilities, live data, user counts, testimonials, or verified restroom information.
5. If information is missing or uncertain, label it clearly instead of guessing.

## Product principles

Follow these principles across product, copy, and design decisions:

- Make uncertainty visible.
- Let users judge what works for them.
- Prefer specific information over vague ratings.
- Keep interactions fast and practical.
- Separate building-entry access from restroom access.
- Do not claim information is real-time unless a real live data source supports that claim.
- Do not present visitor reports as guarantees.

## Brand language

Preferred language includes:

- “Know before you go.”
- “Find a restroom you can use.”
- “Purchase required”
- “Restroom floor”
- “Stairs to restroom”
- “Last reported”
- “Not reported”

Avoid unsupported or overly broad claims such as the following.
“Real-time” and “Available right now” are only allowed if a live data source supports them:

- “Guaranteed clean”
- “Always open”
- “Available right now”
- “Real-time”
- “The safest bathrooms”
- “Everyone can use it”

For complete positioning and copy rules, see `docs/brand_position.md`.

## Design

Follow `docs/style_guide.md` for:

- colors
- typography
- spacing
- visual tone
- logo usage
- UI patterns

Do not introduce new fonts, colors, or visual styles without a clear reason.

The selected logo is **03 — R tile**. Approved marks, outlined wordmarks, lockups, light/dark and one-color variants, avatars, and favicons are in `brand/logo/`. Follow `brand/logo/README.md` for sizing and clear space; use the supplied exports instead of redrawing the mark. The style guide specifies the three retained page directions, B/E/F. Keep one direction consistent within a page.

## Persona agents

The course repository contains the current definitions:

- [Maya](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-maya.md)
- [Chloe](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-chloe.md)
- [Alex](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-alex.md)

Load each relevant definition in a separate review session and give it the same version of the artifact. Record the input version, verdict, blocking feedback, revision, and rerun. The course repository also contains the installed Codex and Claude-compatible definitions and earlier review records. These definitions have not been installed in this product repository.

Use them to review major user-facing copy, landing-page changes, UX flows, or feature concepts. Their outputs are research-grounded simulations used to test decisions from different user perspectives; they are not customer interviews or demand validation.

## Feature development process

We use [Feature Forge](https://github.com/kenxle/feature-forge) because its brief, plan, build, verify, ship, and learn stages keep a small feature connected to its user problem and acceptance evidence. SwiftUI and MapKit are the native application frameworks on this branch; Next.js belongs to `webapp`.

The project workflow is recorded in `docs/feature_development.md`. Follow it through Markdown records; Feature Forge slash-command skills have not been installed.

1. **Clarify and brief:** Read the research and product docs. State the user problem, scope, unknowns, and observable acceptance criteria in a feature record.
2. **Plan:** Inspect the existing code, compare relevant implementation options, and break the work into small slices with named file ownership and checks. Record dependencies before assigning parallel work.
3. **Review the plan:** Have a separate reviewer check the requirements, route and entry distinctions, data handling, and UX. Resolve blocking findings before building. Use customer personas for relevant copy or UX questions.
4. **Build:** Implement the agreed slices. Preserve other contributors' changes. Use clearly labeled examples in prototypes; never fill missing venue facts with guesses.
5. **Verify independently:** Have a reviewer who did not build the change compare the integrated result with the acceptance criteria. Run the repository's supported checks and inspect relevant mobile/browser flows. Fix blocking issues and record evidence.
6. **Ship:** Prepare a concise change summary, validation results, and known limitations. Commit, push, open a PR, merge, or deploy only when the team has authorized that action. A teammate checks the delivered result after release.
7. **Learn:** Record useful lessons and unresolved questions in the feature record, and update project guidance when a decision changes it.

A small, understood fix can use a shorter record with the problem, changed files, verification, and outcome. It still needs appropriate checks and review.

## Build and verification

Use Xcode 26.2 or newer, preserving the registered bundle and existing package pins. The native app's project, dependencies and bundled resources are under `ios/`. The ignored `GoogleService-Info.plist` must match its existing Firebase registration. Native MapKit needs no MapKit JS token.

Run pure model checks with `swift test --package-path ios`. Build the actual Xcode project against its linked Firebase/Google SDKs before claiming integration success. Model tests or syntax parsing alone do not prove the signed app, authenticated writes, physical-device behavior or Analytics ingestion. Preserve both simulator and device entitlement configuration.

The backend directories have their own package manifests and lockfiles. Use their documented local unit and emulator procedures; root Node tooling, if present, supports Firebase/backend verification rather than a web frontend. No server deployment, Firebase mutation, account operation or TestFlight upload follows automatically from a code change.

Keep the latest source/release distinction clear. The signup repair passed 199 model tests and an Xcode 26.2/iOS Simulator 26.2 SDK build before this branch split, but was not published. Analytics remains optional and off by default in the current source, with no pre-consent signup replay. A confirmed new account requires `isNewUser=true`, a matching active account and an allowlisted provider; use the trusted successful credential flow only to recover absent provider metadata, and reject contradictions. Do not infer signup from account age, restored sessions or returning logins.

## Firebase backend

Always find and use the appropriate Firebase agent skills for Firebase work. They are installed in this course workspace under `../.agents/skills/`; install them with `npx skills add firebase/agent-skills --agent=codex` if missing. Use the latest Firebase CLI through `npx -y firebase-tools@latest` and official Firebase MCP tools.

The selected project is **`nye-restroom`**, with separate existing iOS and web registrations, Apple and Google sign-in, and the existing Standard `(default)` Firestore database in `nam5`. The native bundle is `coms4995.Restroom-Ready`. Read `docs/firebase-setup.md` before backend changes. Download the native SDK configuration for the existing iOS registration into ignored `ios/GoogleService-Info.plist`; see `ios/README.md`. Never commit CLI tokens, service-account credentials or signing keys. Web SDK configuration belongs to `webapp`. Saved places stay in the UID-scoped private Saved collection. New visit notes use the public `restroomPublicNotes/{placeID}/notes/{noteID}` projection with private `restroomReadyPublicNoteReceipts` ownership evidence. Legacy private-note schemas remain compatible but are not used by updated clients. Public cleanliness totals use preinitialized `restroomRatingSummaries/{placeID}` documents; private votes use `ratings/{uid}` beneath each summary. Preserve the paired atomic vote/aggregate rules, and never create invented production ratings. New locations first create an owner-only `users/{uid}/restroomReadySubmissionRequests/{communityID}` request paired with the private `restroomSubmissions/{communityID}` reservation. Only the moderator backend may create the unchanged public `communityRestrooms` schema, empty rating parent and approved optional code/Saved projections. Clients cannot publish or decide requests. Keep raw drafts private and scrub them after review; see `docs/features/moderator-dashboard.md`. Preserve strict schemas, non-anonymous login, bounded latest-1,000 public reads, stable retry IDs, and separate observation/submission dates. Community step-free-route reports never become city accessibility labels. Validate rule changes against the emulator tests and preserve source/observation/submission date distinctions. Passcodes use separate private own records, immutable ownership reservations, and opt-in public projections. Preserve Only me by default, atomic private-code auto-saving, owner-only sharing changes, version-pinned verification receipts, and separate update/check timestamps. Code edits clear prior verification. Never put codes in public location fields, URLs, Analytics, or error messages. See `docs/features/restroom-passcodes.md`.

## Repository layout

- `ios/`: Xcode application, local Swift packages, resources, unit/model tests and UI tests.
- `backend/`: account deletion and moderator services shared with the web client.
- `firebase/`, `firebase.json`, `.firebaserc`: shared Firebase project/rules/index configuration.
- `deploy/account-deletion/`, `deploy/moderation/`: reviewed service packaging and explicit deployment procedures.
- `brand/`, `docs/`: approved identity, design, feature and branch guidance.
- `scripts/build-native-accessibility-index.py` and its reviewed input: reproducible native accessibility-index generation.

Keep service credentials and production account/roster state outside the repository. Preserve API and schema compatibility with `webapp`; port shared changes deliberately instead of merging one platform's whole tree over the other.

## Source of truth

Use these sources in this order:

1. `docs/brand_position.md`
2. `docs/style_guide.md`
3. the linked course persona definitions and recorded reviews
4. supporting interview and Reddit research

If sources conflict, identify the conflict and resolve it against the underlying evidence before making a major change. Ask the team only when a decision or missing fact cannot be resolved from the records.
