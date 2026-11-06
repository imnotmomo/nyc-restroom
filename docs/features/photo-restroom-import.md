# User-supplied photo import

Status: Imported and verified in production
Date: October 20, 2026

## Brief and boundaries

Import the ten user-supplied restroom-list images into the existing `nye-restroom/(default)` Standard Firestore database. Use English venue names and descriptions, preserve leading zeros and keypad symbols, and merge duplicates without disturbing existing city IDs, contributions, ratings, notes or saved places.

The images have no established observation date. A receipt explicitly names Zucker's Bagels at 143 Chambers Street and prints a bathroom code. Other screenshots contain conflicting code variants, vague branches, Philadelphia venues, questionable venue pairings and employee/service-entry codes. Import time is not an observation or successful-use verification.

## Plan and acceptance

- Independently extract all source rows, retaining image/row references and uncertainty flags. Keep source images outside public assets and Git.
- Preserve complete English transcriptions in an administrator-only provenance collection, including withheld rows. Never expose staff/service-entry codes through the restroom-code feed.
- Reuse an existing exact restroom ID when supported. Do not merge a whole park, mall or chain into an arbitrary restroom or branch. A venue's existence or address alone does not establish a restroom.
- Add only locatable NYC restroom reports to the existing community schema; use unknown route/observation fields and explicit source notes. Use primary address evidence and NYC Planning GeoSearch coordinates. Explain an approximate location when the source gives only an intersection.
- Exclude non-NYC, demonstrably closed, unlocatable or contradictory venue reports from public pins; retain them for review in provenance.
- Keep different restroom-code reports separate. Dedupe exact code strings across every existing public report at the same place before creating a stable import ID. Preserve existing verified records and timestamps.
- Code reports use separate public projections, a reserved system owner, import timestamps and `lastVerifiedAt: null`. No fabricated Google accounts, user records, ratings, or visit observations. Store no codes in public venue names, notes, URLs or Analytics.
- Prepare a dry-run manifest and read-only target snapshot before create-only atomic writes. Idempotent reruns skip already imported records; existing documents are never overwritten.
- Independently review the manifest and importer, run targeted schema/security tests including verification of system-seeded public reports, then import and verify the actual public SDK/browser reads.

## Ownership and review

Three independent extraction tasks cover Photo4, Photos2/3, and Photos1/5–10. Address resolution tasks use official venue pages and the city snapshot. Root owns deterministic matching, geocoding, the importer, production writes and live verification. An independent reviewer checks the plan and integrated manifest before production mutation.

No frontend or Firestore rule change is planned. The existing realtime community/code feeds will receive valid imported records. The user explicitly requested adding the data; no GitHub commit/push is included.

## Results

Imported into `nye-restroom/(default)` on October 20, 2026 at `04:41:25Z`, using the independently reviewed manifest SHA-256 `d48b43f48b0002959841573fa0a34cd7d1d267c915630a05927d0c5a55772bf2`.

- **296 English source rows** extracted from all ten images and retained in the administrator-only `photoImportSources/user-photos-20261020-v1/rows` collection.
- **86 new unique NYC restroom-location reports**, from 90 resolved source rows. Duplicate names for the same Bloomingdale's SoHo, Macy's Herald Square, Whole Foods Williamsburg and Trader Joe's 72nd Street branch were collapsed. Separate tenants in the same building remain distinct.
- **39 public code variants**, preserving leading zeros, `#` and one translated button sequence. All begin with `lastVerifiedAt: null`; the database update timestamp is import time, never an observation date or proof that a code works.
- **15 exact existing-facility matches** and **19 existing-venue groups** retained current city IDs. Group matches create no new pin and attach no code, hours, fee, route or no-code claim to an arbitrary city facility. No bundled city record was edited.
- **162 source rows pending review** and **two pending precise location evidence**, plus **five non-NYC** and **three closed-at-reported-location** rows, stay out of the public feed. This is not a claim that all source rows represent currently usable restrooms.
- All **100 numbered staff/service/management-entry code rows** from Photos2–4 remain private pending restroom-door evidence. Eleven independently documented museum/attraction/event visitor amenities use customer/admission entry labels; their screenshot staff-door codes were not imported. Unreadable Raising Cane's digits were not guessed.

Private transcriptions, source image hashes, coordinate evidence, reviewed manifests and immutable target snapshots remain outside the product repository, under the local `tmp/photo-restroom-import` staging directory. The supplied images were not added to public assets or Git.

## Verification and delivery

- Three isolated Firestore security tests passed: bounded public imported-code reads, real-account version-pinned verification of a system-owned report, and denial of private source/owner access and unauthorized edits/deletes.
- An additional isolated test called the actual app SDK's `verifyPublicPasscode` method successfully and rejected a stale version. It used demo Auth/Firestore emulators; no production check or customer account was manufactured. Emulators shut down cleanly.
- The final dry run saved **633 explicitly absent target paths** to an exclusive, mode-600 snapshot. Production applied **633 create-only writes in three batches**: 86 listing/receipt/zero-rating-summary groups, 39 public-code/reservation pairs, and 296 source rows plus a batch provenance document. No preexisting record was overwritten.
- A fresh anonymous Firebase SDK client read back **all 86 imported venues and all 39 codes**, checked exact schemas, English names, null observation/verification dates and an empty rating summary, and was denied access to private source rows. See [production checks](photo-import-production-checks.json).
- A post-import read-only replay planned **zero writes**, finding all 86 venues, 39 codes and 296 source rows already present with matching immutable payloads. Original timestamps and any later genuine code checks are preserved.
- Both existing public hosts loaded the updated Firebase feed without a frontend deployment. The primary finder displayed 1,064 city locations plus 86 visitor submissions. Zucker's receipt code and Target Herald Square code rendered as not verified; the Williamsburg Whole Foods detail preserved three separate code variants. At 390px the imported detail occupied the full viewport with no document overflow. See [mobile screenshot](screenshots/photo-import-zuckers-390.png).
- No production ratings, successful-use verifications, signups, outbound email or synthetic Auth accounts were created. No GitHub commit or push was requested or performed.

Independent plan, importer, source-legibility and manifest review: [photo import review](photo-import-review.md). The initial replay/backup review findings were fixed before production writes.

## Lessons

A recognizable venue or plausible keypad number is insufficient evidence for a public restroom. Preserve branch identity and source age, distinguish employee entrances from restroom doors, retain conflicting code variants, and use deterministic IDs plus semantic checks so importing the same photos cannot refresh dates or duplicate records.
