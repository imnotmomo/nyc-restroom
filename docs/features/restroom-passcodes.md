# Feature: Restroom passcodes

Status: Ready for frontend release
Date: October 16, 2026

## Brief and acceptance

Show visitor-reported restroom passcodes with separate code-update and successful-use verification times. Signed-in users can keep one own code per place, choose Only me or Everyone, edit/delete their code, change visibility later, and explicitly confirm that a code worked. Private codes are readable only by their owner and automatically save the place when written. Public readers can read shared code reports without signing in. Logging a new restroom supports an independent yes/no/unknown code-required report and an optional code; the listing and optional code save atomically.

Default code visibility is Only me. Saving, editing, or publishing is not verification. Changing the code invalidates prior verification. Anonymous or other-account reads must never return a private code. No code belongs in listing notes, URLs, Analytics, error messages, or logs. No production sample codes, reports, verifications, or accounts will be created for QA.

## Approved data contract v1

- `users/{uid}/restroomReadyPasscodes/{placeID}`: owner-only one-per-place record, with exact fields `placeID`, immutable opaque 20-alphanumeric `reportID`, `code` (trimmed printable ASCII, 1–40 characters), `visibility` (`private`/`public`), immutable `createdAt`, `codeUpdatedAt`, and nullable `lastVerifiedAt`. Timestamps use server time. Private verification is the owner's explicit confirmation.
- `restroomPasscodeOwners/{reportID}`: immutable private ownership reservation `{ownerUID, placeID, createdAt}`, atomically created with the first own record. Owner-only GET, no LIST. This prevents copying a known public report ID into another account to steal control. Delete it only atomically with removal of the own record and public projection.
- `restroomPasscodeReports/{placeID}/reports/{reportID}`: public projection, exact fields `{placeID, code, codeUpdatedAt, lastVerifiedAt}`; no UID, name, or email. Present only when its owner chooses Everyone. Only that reserved owner can edit code, delete, or change visibility. Public reads query the selected place ordered by codeUpdatedAt descending, limit 10; no new composite index is needed.
- `users/{uid}/restroomReadyPasscodeChecks/{reportID}`: private, version-pinned public-verification receipt `{placeID, codeUpdatedAt, verifiedAt}`. Public verification changes only lastVerifiedAt and is paired atomically with this signed-in non-anonymous user's receipt. Old-version confirmations and clock-only unpaired replays are denied. No receipt LIST is needed.
- `communityRestrooms/{placeID}` gains optional `passcodeRequired` (`yes`/`no`/`unknown`) only. Legacy records without the field decode as unknown. Codes and visibility NEVER enter this public listing document. `LogRestroomInput` can carry a separate optional passcode draft, explicitly stripped before listing normalization/storage.

Owner/public lastVerifiedAt can differ after another visitor verifies a public report. The UI uses the confirmed public timestamp for a public code, and the owner-only timestamp for a private code. Owner same-code edits preserve community verification; making a code private preserves the latest real verification read from its public projection. A code change clears both. Only a current exact version can be verified; display dates must not lose the timestamp precision used for concurrency checks.

Private code writes include the account's saved-place document atomically. Existing saves need not have their savedAt refreshed. The user may later unsave normally; the next private code save/verification can add the place again. Removing a code does not remove a saved place automatically. Multiple accounts can have separate codes/reports; changing one owner's privacy does not erase other public reports.

Creation of a new community restroom keeps the existing atomic listing/ownership receipt/empty-rating-summary creation, adding the optional code reservation, own code, public projection or saved place in the same batch. New-community validation may use the after-write state, without weakening existing note/rating rules. Passcode membership requires a trusted source rating-summary container or a valid same-batch community submission. Stable submission IDs and confirmed server readback prevent retry duplicates or false success.

## Ownership and plan review

Rules author owns `firebase/firestore.rules` and passcode emulator security tests. SDK author owns the passcode model/API and community model/API integration with behavioral tests. UI author owns passcode display/editor, logging fields, detail slot and finder styles. Parent owns explorer integration, privacy/docs, independent integration/browser checks, cloud validation and publication. Preserve unrelated existing changes.

Separate source-grounded persona plan reviews were requested. Chloe requires distinct edit/check times, reset on code changes, version-pinned verification, and visitor-report wording. Alex requires code requirement separate from permission to enter, unmistakable private visibility, and public reading without an account. Maya-informed UX review requires practical readable code access, visible unknown dates, no accidental public default, and immediate account/place clearing. These are design reviews, not customer demand evidence. The architecture review additionally identified the ownership-reservation requirement above.

## Verification plan

Run the full existing and new Firestore emulator suites, meaningful passcode model/API tests, TypeScript and production build. Check owner workflows, anonymous and cross-account denial, ID-copy hijacking, strict schemas/timestamps, code/version reset, paired verification, visibility transitions, new-restroom atomicity, favorites, retry/failure behavior, and stale account/place callbacks. Independently exercise the real compiled app against isolated Auth/Firestore emulators, including public reading, a second account, visibility changes, code edits, explicit verification, and mobile layout. Validate reviewed rules with official Firebase tools before deployment. Confirm production anonymous reads without creating fake production data.

## Independent review and revisions

UI source review against the Maya definition approved the integrated version (8/10): private default, clear dates and unknowns, anonymous shared-code reading, and short contributions; this is a simulated design review, not a customer test. Independent review of the parent wrapper and SDK found a verification readback race: the code or visibility could change between successful verification and the final read. Both own-verification paths now recheck the exact expected revision before reporting success.

The Firebase security auditor checklist was applied separately to the rules: strict create/update schemas, immutable ownership reservations, owner-only private reads, bounded public reads, and paired exact-version verification. A targeted owner-verification test found a rules expression-budget failure in branch evaluation; the verification-first branch and cheap field-change guard resolved it. All 298 security cases now pass, including owner verification and concurrent visitor confirmations. The two nullable-map warnings were removed; the official Firebase MCP validator returns “OK: No errors detected.” The Firebase CLI dry run and production rules deployment both succeeded for `nye-restroom/(default)`; the frontend release is pending.

## Verification results

- All **57 Node tests** pass, including eight passcode model cases and legacy/new community normalization. TypeScript and the optimized static/Worker build pass.
- All **298 Firestore emulator cases** pass (60 passcode cases and 238 existing cases). Final rules SHA-256: `a581b9fd86e4d88fd48c2e976ea49d1dd0d7a26a44571817cf4fbaeab5d1b594`. Independent SDK-author audit found no blocking ownership/privacy/schema issue; the rules author independently checked SDK/rule alignment.
- The compiled app passed isolated Auth/Firestore emulator browser checks with synthetic Google accounts: private default, confirmed automatic Saved, anonymous exclusion, unchanged saves without refreshed dates, explicit private/public owner verification, second-account verification, edit/reset, privatization, stale-owner-tab rejection with draft retention, deletion retaining Saved, sign-out clearing, atomic new-location/private-code saving, and 320/390px layouts. No production service request was attempted in these test contexts; all fixtures were cleared. See [browser results](passcodes-browser-checks.json), [320px editor](screenshots/passcodes-320.png), and [390px editor](screenshots/passcodes-390.png).
- Saving a code never proves actual successful use. Emulator tests check the reporting workflow and authorization, not physical venue facts. No production sample codes, accounts or verification reports were created.

Final Chloe review approved (8/10), with no remaining must-fix findings: updates, visitor checks and unknown evidence remain distinct. Final Maya-informed source UX review also approved (8/10). These are simulated persona reviews.

## Delivery and lessons

The user requested this feature in the existing public app; existing authorization covers release to the two current public hosts. Publish the reviewed production build after rules deployment, retaining existing auth, analytics and listing data. The previous deployed rule source was preserved locally before the release. No GitHub PR or origin push is part of this request.

Lessons: opaque IDs need a private ownership reservation; dates shown to people cannot be used as exact Firestore versions; verification needs a receipt tied to the current code; branch ordering can determine whether valid rule evaluation fits Firestore limits; unchanged transactions should confirm server state without submitting verification-only commits.
