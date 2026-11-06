# Website and shared backend source audit — November 5, 2026

This review covers the current website and the shared Firebase/account-deletion boundaries. It recommends changes; it does not change product code, data, authentication, rules, deployment or Git state. Live responsive and map-provider checks belong to the coordinating review. Authenticated production creation, rating, note, code and deletion actions were not exercised.

The accompanying [function-coverage.json](/Users/cc/Desktop/4995/nyc-restroom/docs/reviews/2026-11-05-usability/function-coverage.json) inventories **37 function groups**, their source locations, existing tests, gaps and hashes of 85 source files.

## Assessment

The public lookup and contribution infrastructure is present. The largest usability issue is that the website still exposes several older workflows while the iPhone app has moved to a simpler, unified experience. These differences should be made deliberate before adding more controls.

There is no evidence in this review of a newly exploitable cross-account read/write path. The source includes strict schemas, owner receipts, immutable public projections, exclusive version-pinned code feedback, atomic rating transitions and account-deletion locks. Passing pure/unit tests is not a substitute for running the current deployed rules or authenticated browser workflows.

### Executed verification

- **Website suite: 319/319 passed**, using Node 24.19.0 and `--test tests/*.test.mjs`.
- **TypeScript: passed**, `npm run typecheck`.
- **Account-deletion unit and deployment-policy suite: 26/26 passed**. These tests use mocks and local HTTP fixtures.
- The initial sandboxed runs failed only when local fixture servers attempted to bind localhost. Both suites passed when the existing tests received that local-listener permission.
- **Current Firestore rules/SDK suite: 696/696 passed** across 11 suites, using verified latest Firebase CLI 15.35.0, Firestore emulator 1.22.0 and temporary official Temurin Java 21.0.13+9. Host was `127.0.0.1:8298`; every test used a guarded `demo-*` namespace and an empty task-local CLI configuration. Rules/index copies were hash-checked against the audited repository. The CLI shut down its emulator processes afterward.
- No claim is made here that Google/Apple login, GA Realtime receipt, current Firebase provider configuration, deployed rules, external map authorization, email delivery or a live account deletion was verified through source inspection.

Logs: `/tmp/restroom-ready-web-audit-tests-20261105.log`, `/tmp/restroom-ready-backend-audit-tests-20261105.log`, and the sanitized [Firestore emulator summary](/Users/cc/Desktop/4995/nyc-restroom/docs/reviews/2026-11-05-usability/firestore-emulator-summary.log). An initial run accidentally used global CLI 13.22.1 / emulator 1.19.8; its newer-rule evaluation failures are excluded as an invalid tooling run. The corrected latest-CLI run passed all 696 tests.

## Confirmed implementation defects

### W01 — New-restroom retries retain the ID but allow the submitted payload to change — P2

**Reproduction:** sign in, fill Log a restroom, submit, then encounter an unconfirmed save/readback failure. Edit the name, address or other details and retry. The request ID is reused, but the payload is rebuilt from the edited draft. If the first request committed, the backend correctly rejects that different payload as an earlier saved version. The UI allowed an edit that cannot be applied as a retry.

Evidence: [log-restroom.tsx:88](/Users/cc/Desktop/4995/nyc-restroom/components/finder/log-restroom.tsx:88), [log-restroom.tsx:109](/Users/cc/Desktop/4995/nyc-restroom/components/finder/log-restroom.tsx:109), [log-restroom.tsx:153](/Users/cc/Desktop/4995/nyc-restroom/components/finder/log-restroom.tsx:153), [community-restrooms.ts:133](/Users/cc/Desktop/4995/nyc-restroom/lib/community-restrooms.ts:133).

**Recommendation:** pin `{requestID, normalizedInput}` on the first publish attempt and retry that exact pair. Freeze editing while its outcome is uncertain, as the existing public-note and code-report composers already do. Offer a separate explicit new draft after checking the old request. Keep the backend's mismatch rejection; never overwrite the immutable listing.

### W02 — A vertical scroll beginning on the stars changes the draft rating — P2

**Reproduction:** on a touch device, begin a vertical swipe over the star row while reading the long details page. Pointer-down immediately chooses a score and captures the pointer; the transparent input also has `touch-action:none`. There is no horizontal-versus-vertical intent threshold. This changes a draft score without a deliberate rating gesture. It does **not** automatically submit a vote.

Evidence: [star-rating-slider.tsx:41](/Users/cc/Desktop/4995/nyc-restroom/components/star-rating-slider.tsx:41), [star-rating-slider.tsx:49](/Users/cc/Desktop/4995/nyc-restroom/components/star-rating-slider.tsx:49), [star-rating-slider.module.css:10](/Users/cc/Desktop/4995/nyc-restroom/components/star-rating-slider.module.css:10).

**Recommendation:** allow vertical panning and commit a drag only after horizontal intent is established; preserve taps, half-star increments, keyboard controls and explicit Submit. Add a touch/scroll regression case rather than only testing numeric rounding.

### W03 — Structured visit feeds can omit a newly posted older visit — P2

**Reproduction:** a location already has ten reports with recent observation dates. Publish a report today about an older visit. Both legacy and unified queries select the ten greatest `observedAt` values; the merge sorts by observation date again. The new post can be absent even though it was just submitted. This differs from the current posting-time feed contract and from the public-note feed, which uses `submittedAt`.

Evidence: [visit-reports.ts:75](/Users/cc/Desktop/4995/nyc-restroom/lib/visit-reports.ts:75), [visit-reports.ts:99](/Users/cc/Desktop/4995/nyc-restroom/lib/visit-reports.ts:99), [visit-report-model.ts:125](/Users/cc/Desktop/4995/nyc-restroom/lib/visit-report-model.ts:125). Existing tests confirm the current observation-order behavior; they do not enforce the newer posting-order requirement.

**Recommendation:** query each bounded feed by posting time and merge by that same key, while displaying observation time separately. Update the tests and necessary index together. Keep `legacy:`/`unified:` identities distinct so equal raw IDs never inherit ownership or erase another source.

## Confirmed compatibility gaps and usability friction

### W04 — Save requires a second tap after signing in — P2 friction

**Reproduction:** while signed out, open a restroom and choose Save, then finish Google sign-in. `toggleFavorite()` awaits authentication and returns; it never resumes the save. The same button still needs to be pressed again. Saved filtering has a different continuation path and does resume after successful authentication.

Evidence: [explorer.tsx:389](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:389), [explorer.tsx:346](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:346).

**Recommendation:** preserve a place- and account-generation-pinned Save intent across successful sign-in, or state clearly that sign-in succeeded and ask for the final Save action. Never resume an old intent after a place/account switch or submit a rating simply because authentication succeeded.

### W05 — The website cannot create, manage or discover the full unified note workflow — P2 compatibility gap

The page renders both **Share a visit / Publish visit report** and **Add a visit note / Publish note**. Neither web composer has the native optional comment-plus-observations flow, Anonymous toggle, Elevator present, Automatic door present, or optional code input after Code required → Yes. The web reader can display native unified records, including optional amenities and the chosen public name, but expressly allows Remove only for legacy report records. A user cannot remove their native-created unified report through this website.

Evidence: [explorer.tsx:527](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:527), [public-notes.tsx:164](/Users/cc/Desktop/4995/nyc-restroom/components/finder/public-notes.tsx:164), [public-notes.tsx:173](/Users/cc/Desktop/4995/nyc-restroom/components/finder/public-notes.tsx:173), [visit-reports.tsx:53](/Users/cc/Desktop/4995/nyc-restroom/components/finder/visit-reports.tsx:53), [visit-reports.tsx:251](/Users/cc/Desktop/4995/nyc-restroom/components/finder/visit-reports.tsx:251), [visit-reports.ts:94](/Users/cc/Desktop/4995/nyc-restroom/lib/visit-reports.ts:94).

There is also no web **Comments by you** account page. Legacy ownership checks cover only the currently displayed bounded records, so an owner has no account-wide web route to find/remove an older post outside those feeds.

**Recommendation:** converge on one Add a public note composer using the additive unified schema and the existing paired ownership receipt. Default Anonymous on, place the optional comment in the same form, and keep the independently owned optional code private by default. Add owner history and unified deletion using the correct receipt namespace. Preserve existing legacy reads; do not republish, rename or silently migrate them.

### W06 — Reviewed accessibility evidence does not participate in web discovery — P2 parity gap

Web filtering and the compact Accessible value consistently use `accessibilityStatus()`, but that resolver examines only the base city field or the original community `stepFreeAccess`. The selected research profile is fetched only after selection. For example, the reviewed Morgan profile contains an operator wheelchair-accessibility claim, yet that claim cannot affect the web list/filter. Native's independently reviewed accessibility index is not used here.

Evidence: [accessibility.ts:5](/Users/cc/Desktop/4995/nyc-restroom/lib/accessibility.ts:5), [restroom-filters.ts:68](/Users/cc/Desktop/4995/nyc-restroom/lib/restroom-filters.ts:68), [explorer.tsx:226](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:226), [detail.tsx:45](/Users/cc/Desktop/4995/nyc-restroom/components/finder/detail.tsx:45). Morgan's existing exact profile ID is `community-82d3c2a31534b1f5fcfd`.

**Recommendation:** reuse a reviewed, bounded public index for shared card/filter resolution before discovery, retaining explicit primary negatives/unknowns and evidence scope. Do not introduce one Firestore profile read per list row. Building accessibility must not create a complete Stair Free route, elevator, stall feature or current availability claim.

### W07 — Web filters retain the older one-at-a-time model — P2 friction

The current web options are ALL, Public, No code, Clean (4★+), Accessible, Stair Free and Saved. Only one can be selected; there is no Elevator access filter or Clear filters control, and Saved is a filter rather than an account destination with Return to main map. A visitor cannot ask for both Clean and Accessible on web.

Evidence: [restroom-filters.ts:5](/Users/cc/Desktop/4995/nyc-restroom/lib/restroom-filters.ts:5), [explorer.tsx:346](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:346), [explorer.tsx:463](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:463).

**Recommendation:** decide whether the native multi-select contract should apply to web, then implement independent AND filters and a clear reset. Keep concise user-facing labels. Retain accurate source explanations in an accessible secondary location; never label all directory venues unrestricted/free entry, or treat no public code record as No code.

### W08 — Marketing's main action still asks people to wait for an available product — P2 friction

Landing and feature pages still prioritize Get early access / Join the waitlist / “when it's ready,” while the public finder is already reachable and account signup is the current tracked conversion. The finder link is secondary. `/thank-you/` and email confirmation remain a real, separate legacy workflow rather than a new-account event.

Evidence: [landing.tsx:6](/Users/cc/Desktop/4995/nyc-restroom/components/landing.tsx:6), [landing.tsx:75](/Users/cc/Desktop/4995/nyc-restroom/components/landing.tsx:75), [signup.tsx:18](/Users/cc/Desktop/4995/nyc-restroom/components/signup.tsx:18), [analytics.ts:98](/Users/cc/Desktop/4995/nyc-restroom/lib/analytics.ts:98).

**Recommendation:** make Open the map the main action, with the current TestFlight route as a separate choice if desired. Keep an optional product-updates signup only if it still has a distinct purpose. Do not relabel historical waitlist activity as account creation or erase old subscriptions merely to change the CTA.

### W09 — Detail reading is still a long evidence/contribution page — P2 friction

The web card exposes Hours, Entry, Route inside, Amenities, Conditions, Passcodes, ratings, structured reports, notes, imported comments and provenance in a long flow. Rate and Comment is grouped but its child sections are immediately visible. Many unknown Entry/Route rows still occupy space, and a user's rating is far below the name. This differs from the native compact card with focused expandable destinations.

Evidence: [detail.tsx:111](/Users/cc/Desktop/4995/nyc-restroom/components/finder/detail.tsx:111), [detail.tsx:127](/Users/cc/Desktop/4995/nyc-restroom/components/finder/detail.tsx:127), [detail.tsx:139](/Users/cc/Desktop/4995/nyc-restroom/components/finder/detail.tsx:139), [detail.tsx:178](/Users/cc/Desktop/4995/nyc-restroom/components/finder/detail.tsx:178).

**Recommendation:** put the usable name/rating, compact hours, supported amenity labels, dated condition and preferred code first. Place source detail and contribution editors behind deliberate expandable destinations. Preserve conflicting evidence, negative route facts, sources and dates; reducing the initial reading burden must not turn unknowns into positive claims or delete evidence. Parent live mobile QA should determine the actual scroll/tap cost.

### W10 — Web account access and deletion remain limited — P2 parity gap

The only web account control switches between Sign in with Google and Sign out. It does not show which account is active, offer Apple login, show comment history or expose Delete account. Apple-only native users cannot select their original provider on web, and private saves/codes are tied to that Firebase identity. The privacy page documents iPhone deletion and a contact path for people who cannot access it.

Evidence: [firebase-account.tsx:55](/Users/cc/Desktop/4995/nyc-restroom/components/firebase-account.tsx:55), [firebase-account.tsx:167](/Users/cc/Desktop/4995/nyc-restroom/components/firebase-account.tsx:167), [app/privacy/page.tsx:3](/Users/cc/Desktop/4995/nyc-restroom/app/privacy/page.tsx:3), [backend/account-deletion/src/server.mjs:35](/Users/cc/Desktop/4995/nyc-restroom/backend/account-deletion/src/server.mjs:35).

**Recommendation:** add a concise account destination with provider identity, Saved, Comments by you and a deliberate deletion entry point. If Apple login is added, configure its web flow rather than merely rendering a provider button. Deletion must retain recent reauthentication, the backend lease/recovery contract and Apple token revocation requirements; do not call Firebase `deleteUser` alone.

The reviewed backend correctly keeps public venue submissions and existing public cleanliness totals, unlinks ownership, moves each existing rating into an Admin-only anonymous namespace, removes owned public note/report text before its private receipts, and only then removes private data/Auth. Preserve that retention policy and its tests. This is verified source/unit behavior, not a performed production deletion.

### W11 — The new-restroom code help promises an unavailable edit action — P3 copy defect

The optional code help says the code can be edited later. The current owner UI offers visibility changes, private verification, delete and Report a new code; it does not provide code-text editing. Reporting a new immutable version is intentional.

Evidence: [log-restroom.tsx:225](/Users/cc/Desktop/4995/nyc-restroom/components/finder/log-restroom.tsx:225), [passcodes.tsx:166](/Users/cc/Desktop/4995/nyc-restroom/components/finder/passcodes.tsx:166).

**Recommendation:** say the owner can change visibility or report a new code. Preserve old versions and the four-distinct-user presentation gate; do not add in-place editing to immutable V2 records to match the old copy.

### W12 — Offline loading has no bounded explanatory state — needs runtime confirmation

Public Firebase listeners intentionally ignore cache/pending snapshots and wait for server-confirmed records. On a fresh offline load, the source contains no common offline branch or listener watchdog, so additional details, codes, ratings and visitor feeds can remain on Loading rather than explaining that a network connection is needed. The static city list remains available. GPS and address search already have explicit timeouts.

Evidence: [ratings.ts:78](/Users/cc/Desktop/4995/nyc-restroom/lib/ratings.ts:78), [public-notes.ts:103](/Users/cc/Desktop/4995/nyc-restroom/lib/public-notes.ts:103), [code-reports.ts:282](/Users/cc/Desktop/4995/nyc-restroom/lib/code-reports.ts:282), [components/finder/explorer.tsx:471](/Users/cc/Desktop/4995/nyc-restroom/components/finder/explorer.tsx:471).

**Recommendation:** test a cold page load offline and a connection loss after successful reads. Provide a bounded “Waiting for connection / Retry” state without presenting cached records as newly verified or converting an unavailable read into an empty result. Treat this as a runtime usability candidate, not a claim that a production failure was reproduced.

## Functional boundaries worth preserving

| Area | Source and existing tests establish | Remaining live check |
| --- | --- | --- |
| Browse/search/map | Public finder, exact IDs, paged list and full filtered pin set; clustered Apple/OSM providers; keyboard pin callbacks | Provider token/error states, cluster zoom and actual assistive-tech behavior |
| Location/address | Explicit GPS request, cancel/stale guards, NYC-bound suggestions, chosen address+pin together, manual correction | Safari prompt and real provider availability; prevent accidental venue selection |
| Hours | Reported restroom hours precede listed hours, followed by scoped research; labeled venue fallback; New York midnight refresh and full raw schedules | Current selected venue after public profile load; no open-now guarantee |
| Ratings | Public aggregates; private one-vote ownership; atomic aggregate/vote updates; half-star values and concurrent retry logic | One intentional authenticated submit/update/remove in a designated test environment |
| Public contributions | Immutable public content paired with private receipts; safe text rendering; distinct observation/submission times and anonymity | Unified web write/history/deletion parity is absent; real-account tests are outside this review |
| Codes | Private default, owner-only sharing, version-pinned feedback, Used vs Invalid, verified-first ordering, newest report needs four Used voters to hide old history | Cross-account authenticated experience; no need to fabricate votes in production |
| Privacy/Analytics | Explicit events use sanitized routes/campaigns and new Google credential metadata; no app-supplied email, note, code, search, account ID or precise-location payload | Actual GA network receipt and admin key-event/Realtime settings; source cannot establish delivery latency |
| Deletion | Recent-session auth, fixed endpoint/origin checks, bounded request, lease/recovery, preserving retention policy | Current deployed policy and authenticated full deletion require a separately authorized test |

## Recommended order

1. Fix retry payload pinning and touch gesture intent; align structured feed ordering with posting time.
2. Converge web contribution management and account history with the unified model, including removal of the owner's native posts.
3. Share reviewed accessibility resolution and make filter behavior consistent, preserving strict route/elevator evidence requirements.
4. Simplify initial card reading and promote the public finder from marketing; correct the code-edit promise.
5. Verify real offline, keyboard, map-provider and authenticated workflows in a disposable test environment before claiming end-to-end completion.

All recommendations preserve the current logo, visible uncertainty, sources and dates, anonymous defaults, private code boundaries and existing public rating totals. No product changes were made by this audit.
