# User-supplied photo import review

Date: October 20, 2026
Status: Production import, anonymous SDK readback and zero-write replay evidence reviewed; no blocking finding.
Target: existing `nye-restroom` / `(default)` Standard Firestore database.
Scope: read-only review of the proposed import, current application decoders and security rules. No production records or rules were changed by this reviewer. Source images and raw access codes are excluded from this review document.

## Approved architecture

- Preserve the bundled city IDs and match existing community venues before creating new listings.
- Reuse the exact current public community-restroom, empty rating-summary and private receipt shapes. Keep observation dates null when unknown; do not infer public permission, route accessibility, cleanliness, current operation, or code verification from an address or image.
- Use trusted administrative create-only writes, atomically grouped by venue. Preserve every existing vote, summary, code, save and private note. Back up targeted paths, bind the dry run to a manifest hash, use existence preconditions, and inspect readback before reporting completion.
- Store complete image/row provenance and withheld entries in an administrative collection protected by the existing deny-by-default rules. Do not grant public access to raw screenshots, staff/service-entry inventories or personal metadata.
- Keep clear restroom-code variants as distinct public reports and preserve exact code text. Use a reserved service owner identity for imported public reports without creating fake Firebase Auth users or human private code records.

## Projection and verification compatibility

The existing public code decoder requires exactly `placeID`, `code`, `codeUpdatedAt` and `lastVerifiedAt`, with a 20-character alphanumeric report ID and Firestore Timestamp values. Imported report IDs must satisfy that shape; a 20-character hexadecimal digest satisfies the syntax.

The public verification rule and `verifyPublicPasscode` method validate the existing public report, bind the verification to its exact `codeUpdatedAt` version, and atomically write a real signed-in verifier's private receipt. That verification path does not require an own-code record for the reserved service identity. Thus an administratively seeded public projection can remain verifiable while non-owners cannot edit or delete it. The private owner reservation must point to the exact place/report and must not expose a user's identity.

This compatibility is source-reviewed, not assumed to have been runtime-tested. Before production commit, an emulator scenario must seed this exact administrative report/reservation variant and exercise the actual application SDK's public verification method under ordinary signed-in credentials. It must also confirm signed-out reads, non-owner code edits/deletes denied, private provenance unreadable, and stale-version verification denied. No rules changes are necessary for the planned import.

## Required execution conditions

1. **A venue address is not evidence of a restroom.** For source rows describing employee doors, management kiosks, service corridors, cleaning rooms or other access controls, withhold both the code and any new public restroom listing unless separate source evidence establishes a restroom. A matched existing city restroom can keep its independent city provenance without importing unsupported access claims.
2. **Do not publish ambiguous or out-of-area pins.** Exclude Philadelphia, unspecified chain branches and identity/borough conflicts until resolved. A GeoSearch result supports a candidate address coordinate; it does not verify a venue or restroom. Primary venue address evidence and the selected geocoder result must agree. Label an address point as approximate when the restroom's internal position is unknown.
3. **Dedupe before deterministic IDs.** Normalize venue/branch and unambiguous canonical address, including borough/ZIP where needed. Check all existing public reports for the same normalized `(placeID, code)`, including earlier reports with random IDs. Do not create a duplicate merely because its new hash-derived ID differs. Conflicting codes remain distinct and unverified; leading zeros and punctuation must survive as strings.
4. **Reruns preserve later information.** Compare immutable venue/code identity rather than requiring the same import-time or verification timestamps. Skip exact existing semantic records while preserving their original update time and later successful-use checks. A deterministic-ID collision or mismatched record must stop for review; it must never overwrite or silently count as a successful replay.
5. **Import time is not observation time.** New location notes must visibly explain the undated, unverified user-supplied source and approximate address pin. `submittedAt`/`codeUpdatedAt` can be the database import time, but `observedOn` and `lastVerifiedAt` stay null. Private provenance records retain original source wording/date uncertainty. Do not claim that importing a code establishes that it currently works.
6. **Preserve record bounds and exact schemas.** Names, addresses and English notes must fit 120/240/1,000 characters, respectively; coordinates must be numeric and in the permitted NYC bounds. No codes, account IDs or new metadata fields belong in the public venue document. Each place needs a valid rating summary without replacing an existing one. Up to ten public code reports are displayed by the current UI; any larger resolved group must be reviewed for the consequence of that existing limit.
7. **Review the final dry run before production.** The manifest must identify each created/matched/pending venue, coordinate evidence, source references, code disposition and planned document paths. Confirm exact source decisions independently before administrative commit; then read back actual public SDK results and inspect the rendered UI without manufacturing ratings or verification visits.

## Review outcome

The plan's service-owned projection approach is compatible with the current rules and UI, and its create-only/backup/provenance design preserves existing user data. Execution approval depends on applying the above conditions to the final resolved manifest. No user reconfirmation is required by this review; the user has already authorized adding the supplied data. This is a request for concrete implementation verification before a production write, not an additional permission step.

## Importer implementation review — initial pass

Reviewed `scripts/import-photo-restrooms.mjs` and `tests/firebase/photo-import-rules.test.mjs` before a production commit. The importer correctly fixes the project/database, checks Standard edition, gates apply by exact manifest SHA, uses server timestamp transforms and create-only preconditions, preserves listing/receipt/summary and report/reservation atomic groups, deduplicates codes across existing random report IDs, and performs no rating or verification manufacture. Tokens are reused in memory and excluded from reports.

The recorded emulator log at `/private/tmp/restroom-photo-import-emulator.log` shows three passing administrative-import rule cases: signed-out bounded reads with unknown observation/verification; real non-anonymous account verification with non-owner edit/delete rejection; and private provenance/service-reservation access rejection. This reviewer inspected the log and test source rather than rerunning them. The additional actual SDK verification scenario remains pending.

Before apply, the implementation needs these concrete corrections and dry-run checks:

- Existing deterministic venue replay must compare the normalized immutable venue payload, not just name/address. A changed coordinate, notes or metadata payload must be identified for review instead of silently counted present. Derive `canonicalIdentity` from normalized name/address and ensure the stored payload is itself normalized.
- Reusing a provenance batch ID with a different manifest must fail or use an explicit new batch version. Existing source rows must compare immutable source content/disposition as well as image/row identity. Reject duplicate source IDs in the input before attempting a commit.
- Capture a target-path snapshot entry for every planned write, including explicit absence and the relevant private receipt/reservation/summary reads. Preserve earlier snapshots through exclusive/fresh snapshot files; repeated dry runs must not overwrite the original pre-import backup.
- Validate the target rating summary for each code on an existing city/community place before writing, because later public verification requires its existence. Preserve existing summaries; initialize only missing, validly attributable summaries using create-only writes. Validate an existing same-code public report's place/schema/timestamps before counting it present.
- Validate batch IDs as one bounded safe path segment, ensure source image membership and scalar row identities, and keep progress counts explicitly planned versus committed. A committed-path journal should distinguish a partial apply from a completed import.

These are execution issues to resolve in code or the final reviewed dry run. The reviewed initial implementation is not yet approved for production apply.

## Corrected implementation and final execution approval

**Approved for apply against the exact manifest SHA-256 `d48b43f48b0002959841573fa0a34cd7d1d267c915630a05927d0c5a55772bf2`.** This approval covers the reviewed create-only data addition; it does not claim that the production commit or readback has already occurred. A changed manifest needs a new review.

Re-reviewed the corrected importer. It now derives canonical venue IDs from normalized payloads; stores normalized values; compares complete immutable venue/source payloads on replay; rejects duplicate source IDs, invalid source-image references and changed batch manifests; validates existing code/summary prerequisites; snapshots every planned path with explicit absence; creates snapshot files exclusively with mode 0600; and records planned versus committed counts and committed paths. The current dry run has no existing target venue/code records to preserve or collide with. Existing city groups are matched as provenance rather than rewritten. Create preconditions remain active during apply.

Inspected the final dry-run report and its snapshot in the local private import workspace. They match the approved SHA and plan **633 unique create paths**, each explicitly absent, with **zero committed writes**:

- 86 new venues, each with its receipt and empty summary: 258 writes.
- 39 public unverified code variants, each with a service reservation: 78 writes.
- 296 private provenance rows and one private batch record: 297 writes.

Independently checked the manifest's English text, all source-image membership and unique source IDs, exact venue payload schemas, 120/240/1,000-character bounds, NYC coordinate bounds, observation/route unknowns, source-age and approximate-pin caveats, matching evidence coordinates, and deduplicated `(placeID, code)` pairs. Every public code has a corresponding explicitly public/unverified restroom-code source. No public code uses the numbered staff/service rows from photos 2–4. The largest per-place code group has three reports, within the existing ten-report feed limit. All ten original image hashes match the manifest's recorded hashes.

All 296 source rows are retained privately: 90 source rows consolidate to 86 new venues; 15 match existing city records; 19 refer to existing venue groups; five are outside NYC; three closed/historical venues are withheld; 162 remain pending review; and two remain pending location. One hundred staff/service credential rows are withheld from public codes. The visitor-restroom entries resolved from those source venues use independent venue evidence and admission caveats, rather than turning a staff-door claim into public restroom access. Direct official-source spot checks confirmed restroom amenities at [Brooklyn Botanic Garden](https://www.bbg.org/about/contact), [Whitney](https://whitney.org/visit/access), [Barclays Center](https://www.barclayscenter.com/center-info/a-z-guide), and [The Met](https://www.metmuseum.org/visit-guides/families); their documented admission limits remain relevant. This does not validate the screenshots' employee-door codes.

For flagged image legibility, independently viewed full-resolution photos 8, 9 and 10 and enlarged read-only crops. The flagged Guitar Center, Union Square McDonald's and Bay Ridge Panda Express values are readable and agree with their manifest transcriptions. The Bloomingdale's keypad instruction translates accurately as pressing 2 and 4 together, then 3. The uncertain Raising Cane's value remains omitted from public reports. No withheld credential values are reproduced in this review.

The three administrative-import rules cases passed as recorded earlier. The additional `/private/tmp/restroom-photo-import-sdk.log` records a passing scenario importing the actual application libraries, verifying an administratively seeded public report with a normal emulator account and rejecting a stale code version. This reviewer inspected that successful log rather than recreating a production verification visit. No Firebase Auth account, private human code record, public rating, or verified-use timestamp is manufactured by this import.

After apply, compare the committed journal with all target documents and the approved manifest, check public SDK decoding and rendered listings/code reports, confirm private provenance remains denied, and run a read-only idempotence dry run. Preserve the immutable snapshot and do not treat import timestamps as observation or successful-use times.

## Post-import evidence review

The coordinator completed the approved import at **2026-10-20T04:41:25.165Z**. Independently inspected the private `apply-final.json`, `apply-snapshot-final.json` and `replay-dry-run.json` records and the repository's [production SDK checks](photo-import-production-checks.json). No further database requests were made by this reviewer.

The apply record has the exact approved manifest hash, status `complete`, three committed batches and **633 unique committed document paths**. Its committed counts are 86 venues, 39 code reports and 296 source rows, together with the associated metadata already included in the approved 633-write total. The immutable pre-apply snapshot contains all 633 explicitly absent paths and retains mode 0600. These counts agree with the reviewed dry run; there is no evidence of an overwrite.

The anonymous actual Firebase SDK check reports all **86 imported locations and 39 public code reports verified**, all imported codes still unverified, private source access denied and an empty sample rating summary. Import observation times remain unknown, and no rating or successful-use report was created to make the dataset look active. The coordinator separately observed the combined 1,150-location finder, the English Zucker's listing with an unverified code, the three independent Whole Foods Williamsburg code variants, and the 390px rendered layout without horizontal overflow. Those browser observations belong to the coordinator; this reviewer did not repeat the browser session.

The post-import read-only replay matches the same manifest hash and plans **zero writes**. It recognizes all 86 venues, 39 code reports and 296 source rows as already present, commits zero batches and records no committed paths. Existing code update/verification state is therefore preserved on replay. No production account, rating, code verification, signup or email was generated as part of this readback.

**Final outcome: reviewed import completed successfully within its approved scope.** Pending/withheld rows remain private rather than being represented as additional public restroom coverage. Source images, manifest, immutable snapshot and detailed administrative journal remain in the private local import workspace.
