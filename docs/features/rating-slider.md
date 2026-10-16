# Half-star rating slider

The current [direct-star control](star-drag.md) replaces this release's separate visible slider bar. Half-star storage and save behavior described below remain unchanged.

Status: Shipped
Date: October 16, 2026

Replace the five cleanliness rating buttons with one star slider in the real finder and public demo. Allow 1 through 5 stars in steps of 0.5. Show the chosen number and full/half/empty stars, preserve an unrated state, and require an explicit submit. Support dragging, touch, arrow keys and Home/End with a labeled native range and a touch target at least 44px high. Keep public summaries readable without sign-in and require sign-in for real votes. Demo ratings stay in local memory and reset on reload.

Use the existing numeric stars and sum schema; half steps have exact binary representations. Counts remain integers, averages still derive from sum/count, and old whole-star records remain valid. Widen both SDK decoding and Firestore validators without changing the paired vote/aggregate transaction, ownership, strict schemas, timestamps or other access rules. No production example votes or account data are needed.

Root owns model validation, SDK copy, focused tests, docs and release. The UI author owns the shared control, real/demo editors and CSS. A separate rules author owns the rule validators and emulator cases. The independent reviewer checks the plan, integrated diff and compiled-browser behavior. Model and rules checks cover all nine allowed values, replacements/removal, mixed existing whole-star votes, malformed/off-step input and atomic aggregate protections. Browser checks cover null selection, pointer/keyboard half steps, save/update/remove, auth/loading locks and 320/390px layout.

The independent reviewer approved the model, UI and rules plans, then reviewed the integrated diff without a blocking finding. A Maya persona review approved the control, with unrated/selected/saved states kept distinct. Root also inspected the compiled demo's 4.5-star control and its 44px touch target.

All 90 Node regression tests passed. The full Firestore suite passed 322 cases, then the final focused rating suite passed 90 cases after adding 16 more invalid-update checks. Firebase's production compiler dry run passed, and the validated rules were released to `nye-restroom` without creating any production votes.

All 10 independent compiled-browser groups passed against isolated Auth/Firestore emulators: every half-step and keyboard endpoint, unchanged-minimum pointer selection, explicit submission, half-star fill, actual SDK save/reload/update/remove, signed-out aggregate updates, two-account arithmetic, legacy whole-star coexistence, failed-save retention and 320/390px layout. Tests made no production Firebase requests. The demo remained Firebase-free. See [browser evidence](rating-slider-browser-checks.json) and the `rating-slider-*` screenshots.

The production build explicitly disables emulator mode. Source `5c46fb4754488674b9b2d4e68779765824baeaf5` shipped as Sites version 18 and VPS release `20261016T154747Z-5c46fb475448`. Both public demo routes returned 200 with matching application scripts, and unauthenticated finder requests still redirect through the uncached server access gate. Root verified a 4.5-star selection and local demo save on the live VPS host and captured `screenshots/rating-slider-live.png`. The temporary preview and Firebase emulators were stopped. Real account writes were exercised only in the isolated emulator environment.
