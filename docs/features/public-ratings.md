# Public cleanliness ratings

## Brief and plan

Visitors can read restroom ratings without signing in. Google Sign-in is required to submit, change, or remove a rating. Ratings use a 1–5 cleanliness scale so the existing Clean (4★+) filter has a concrete meaning. Do not generate sample public votes or convert private visit notes into ratings.

Show the average, count, and rating-update time separately from dated city facts. Each account has one current rating per place. Public totals contain no contributor identity; individual votes remain readable only by their owner. Keep loading, unavailable, and confirmed unrated states distinct. Confirm a save only after Firestore acknowledges it, and retain the selected stars after an error.

The selected existing database was verified as Standard edition, `(default)` in `nam5`, project `nye-restroom`. An administrative initializer creates zero-count summaries for the 1,064 known listing IDs without overwriting existing documents. These are empty containers, not reviews. Client creation/deletion of summary documents is denied. A client transaction changes its own vote and the public sum/count together; both rules validate the exact before/after relationship. Removing the last vote retains a zero-count summary.

Independent architecture review required paired aggregate validation, trusted place membership, owner-only vote reads, no raw-vote queries, account-switch guards, strict integer/star/timestamp checks, and sparse public reads. The implementation uses one listener for summaries with a positive rating count, plus an owner read for the selected place. No new provider or Cloud Function is needed.

Ownership: the backend agent owns the rules, ratings API, and rule tests; the UI agent owns the ratings form; the main agent owns integration, styling, initialization, documentation, and deployment. An independent reviewer audits the integrated rules and browser behavior before release.

## Verification and release

Implemented the public summary listener, per-account rating form, list averages/counts, and Clean (4★+) integration. Empty, loading, and read-error states remain separate. The form uses native 1–5 radio controls; changes are explicit and failed saves retain the selection. Individual rating state is scoped to account/place and synchronized from confirmed server reads, including competing-tab changes.

Independent security review passed after timestamp-only replays were denied. The emulator exposed contention cases where stale absolute writes were rejected before the SDK retried. The final API uses atomic increments and at most three whole-transaction attempts, only after a fresh server read proves that the summary/vote version changed. Confirmed no-ops abort without attempting a verification-only write. The strict paired rules remain unchanged in strength.

All **135 Firestore emulator tests** pass (85 existing private-data tests and 50 new ratings cases), including anonymous reads, private vote denial, ownership, forged totals, malformed fields/timestamps, replay, removal, and concurrent edits. All **31 Node tests**, TypeScript, and whitespace checks pass. The official Firebase MCP validator and production CLI dry run both compiled the rules successfully.

The official MCP create-document operation initialized 1,064 zero-count containers using only bundled listing IDs. Existing documents were never updated; the operation has create-only semantics. See [initialization record](rating-initialization.json). No production votes or Google-account test users were created.

Browser tests passed using local Auth/Firestore emulators and synthetic Google-provider accounts: signed-out empty and positive views, actual Google-emulator sign-in, keyboard controls, submit/update/remove, a separate signed-out reader receiving changes, failure retention, account/place changes, final-vote removal, and read-error recovery. Independent 320px and 390px checks found no overflow; each radio target measured 52×58px at 320px. No uncaught browser errors or production Firebase requests occurred during these test writes. See [browser evidence](ratings-browser-checks.json) and the ratings screenshots. The demo servers were stopped afterward, and production builds explicitly disable emulator mode.

The reviewed rules were deployed successfully to `nye-restroom`. A fresh production Web SDK client with no authentication read the public query and a known empty container; an individual-vote read was denied. It made zero writes and found zero rated locations. See [production read check](ratings-production-checks.json). Real user votes were not manufactured for deployment validation.

The production static export and Worker build passed with emulator mode disabled. An independent browser check of that bundle loaded confirmed public ratings from `nye-restroom`, showed the signed-out Google-to-rate action with no voting controls, retained all 1,064 clustered locations, and made no emulator requests or data writes.

Published source `8ee2606da2cdee091ec762ef3c6b1a47ca6edebb` to both existing hosts. Sites version 8, deployment `appgdep_6ad1869f77c081918cb60a23ff9474b1`, returned `succeeded`. The VPS activated healthy release `20261016T020639Z-8ee2606da2cd`. Independent fresh-browser checks of both public URLs returned 200, resolved public ratings without login, showed the Google-to-rate action without voting controls while signed out, retained all 1,064 source members in the map, and used only the real `nye-restroom` database. There were no page errors, emulator requests, or verification writes. Real Google credentials were not entered. The owned local production preview was stopped after verification.
