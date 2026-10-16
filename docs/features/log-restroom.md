# Feature: Log a restroom

Status: Shipped
Date: October 15, 2026

## Brief and acceptance criteria

Visitors can discover a restroom missing from the city snapshot. Google Sign-in is required to submit its name, address, chosen coordinates, category, and optional entry, route, and observation details. Anyone can then read the listing on the existing map and list. Community submissions are visibly separate from city data and are not inspections or availability guarantees. Missing facts remain unknown.

Acceptance: signed-out users can browse but cannot submit; signed-in users can create one confirmed public location; it survives reload and appears to independent anonymous readers; existing search, clustering, rating, saving, and private notes work for its stable ID. Failed saves keep entered information. A retried submission reuses its ID, avoiding duplicates after an uncertain response. Observation dates and server submission times remain distinct.

## Plan and review

The existing static source remains unchanged. Public immutable `communityRestrooms/{id}` records are read alongside it through a bounded live query for the 1,000 most recent submissions. An atomic create also writes an owner-only private receipt and an empty rating summary. Public data contains no account ID or email. Rules reject anonymous creation, invalid fields, timestamps, off-region coordinates, unpaired writes, client changes to submitted listings, and fabricated summaries. The region rectangle is an approximate NYC extent, not proof of municipal membership.

Backend owns the community model, service, rules, and security tests. UI owns the accessible modal form. Integration owns source-aware details, list/map merging, ratings/favorites/notes membership, privacy copy, and publication. An independent reviewer approved the plan with conditions for atomicity, stable retry IDs, a bounded feed, public-coordinate notice, and distinct accessibility/provenance labels.

The optional step-free question refers to the entire route from the street entrance to the restroom. It does not become the city's Fully Accessible label. Public entry is reported permission, separate from the route. Supplied notes and the chosen coordinates become public only on submission; private visit notes remain private.

## Verification and delivery

Completed automated checks: TypeScript, all 41 Node regression tests, and 238 Firestore emulator security cases (103 new submission cases, 85 private-data cases, and 50 rating cases). The independent security review has no open findings; its focused service probes cover owner privacy, fixed-ID recovery without resetting later ratings, Unicode/date boundaries, and per-record malformed-data isolation. See [backend checks](log-restroom-backend-checks.json) and [independent review](log-restroom-review.md).

Separate source-level persona reviews approved the same contribution/detail/list artifact: [Chloe](log-restroom-persona-review.md), [Alex](log-restroom-alex-review.md), and [Maya](log-restroom-maya-review.md). These are research-grounded simulations and are not customer testimony or demand validation.

The final rules compiled successfully in a production dry run and were then released to the existing `nye-restroom` project's `(default)` Firestore database. The previous deployed rule source was preserved locally before release. No production venues, accounts, notes, or votes were manufactured. Integrated browser checks passed against disposable Auth/Firestore emulators with synthetic Google accounts: create and anonymous reload, map membership, ratings and filters, saved places and private notes on the new ID, required fields and location errors, failed-write retention, stable-ID retry and double-submit protection, account changes, 320/390px layouts, 44px targets, focus trapping, and Escape restoration. All temporary listing fixtures were removed. See [browser checks](log-restroom-browser-checks.json) and [320px form](screenshots/log-restroom-320.png). No real Google credentials were entered; no production test records were written. The owned dev server and emulators were stopped cleanly.

The production Next.js static export and Worker build passed (72 assets), with emulator mode unset. Published exact source `428bf5b5f24b0b890b90f9a11b69844aebee2003` to both existing hosts. Sites version 9, deployment `appgdep_6ad18a23d6608191a8288de6c06338c1`, returned `succeeded`; the VPS activated healthy release `20261016T022120Z-428bf5b5f24b`. The public audience was preserved.

Fresh independent anonymous browser checks passed on `https://nyc.imfinethanku.me/find/` and `https://restroom-ready-nyc.clcii.chatgpt.site/find/`: HTTP 200; real `nye-restroom` public community/rating feeds resolved; all 1,064 official locations remained in the map; the enabled Log button opened the named dialog with the public-data notice and enabled Google Sign-in action, with no anonymous contribution form. Escape restored opener focus. There were no page errors, emulator requests, logins, or verification writes. Live evidence is retained locally in `/private/tmp/log-restroom-live-browser.json`. The owned production preview was stopped after release verification.

Lessons: pair immutable public venues with private ownership receipts and initialized rating containers; compare retries against confirmed server data; validate stored observation dates against submission time; isolate malformed records without hiding valid reports. A visual chosen-pin preview and self-service corrections remain possible later work.
