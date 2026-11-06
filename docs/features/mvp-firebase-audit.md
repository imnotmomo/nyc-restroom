# MVP account and data audit

Status: verified locally and checked with signed-out production reads, October 20, 2026.

## Scope and isolation

Reviewed Google account initialization and error handling, public ratings, private saved places and visit notes, community restroom logging, address lookup, and private/public restroom codes. Removing the shared finder-page access gate does not remove Firebase authentication or change Firestore permissions.

The audit followed the installed Firebase Authentication, Standard Firestore Web SDK, and Security Rules Auditor guidance. The existing selected database is Standard edition. The local emulator also reported Standard edition.

All test writes used local Auth and Firestore emulators. No production accounts, ratings, places, notes, codes, or verification receipts were created. No email was sent by these checks. Public production queries returned counts only; no private records or credentials were printed.

## Security rules

Ran the complete repository rules suite against Firestore at `127.0.0.1:8088` with Firebase CLI 15.34.0 and an isolated Java 21 runtime:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 npm run test:firebase
```

Result: **338 tests passed across four suites; zero failures, cancellations, or skips**. The suites cover private account data, rating votes and aggregates, immutable community submissions, and code ownership/privacy/verification. Each suite uses a `demo-` project namespace and clears its test documents.

The review checked create-versus-update validation, ownership authority, strict schemas and bounded values, allowed reads and queries, paired atomic writes, account isolation, public projection ownership, stale verification versions, and server timestamps.

```json
{
  "score": 5,
  "summary": "No security-rule defect found in the reviewed operations and tested cases. Owner-only private records, strict validation, and paired rating/code transitions held in the emulator.",
  "findings": []
}
```

This assessment describes the reviewed rules and tested cases; it is not a claim that no future defect or abuse is possible.

## Actual application SDK functions

An additional temporary harness imported the actual TypeScript application libraries, rather than reimplementing their write logic. It ran in a separate `demo-mvp-sdk-audit` namespace with synthetic Google-provider users. All **12 integration scenarios passed**:

1. Google-provider emulator sign-in.
2. Saving and reading favorites, and saving, reading, and deleting private visit notes.
3. Creating, changing, and removing an individual cleanliness rating, including half-star values.
4. Saving an Only me code automatically saves the place and creates no public code projection.
5. Explicitly verifying a private code and sharing it publicly.
6. A second account retains its own private code alongside another contributor's public code.
7. A second signed-in account verifies the exact public code version.
8. Editing a code clears verification; attempting to verify its old version fails.
9. The owner can make a public code private and delete their own code.
10. Logging a new restroom with a private code creates the listing, receipt, empty rating summary, own code, ownership reservation, and saved place atomically. The public location has no code field.
11. Repeating the same submission ID and input recovers the existing listing; changing the payload for that saved request fails.
12. Signed-out calls to rating, favorite, and code write methods fail.

The harness used `lib/firebase-client.ts`, `lib/user-data.ts`, `lib/ratings.ts`, `lib/passcodes.ts`, and `lib/community-restrooms.ts`. It cleared its Firestore namespace afterward. Run evidence for this session is in `/private/tmp/restroom-mvp-sdk-audit.log`; the temporary harness is `/private/tmp/restroom-mvp-sdk-audit.mjs`.

## Live read and dependency checks

A fresh signed-out SDK client against `nye-restroom` successfully queried public rating summaries, the latest community submissions, and a selected place's public code reports. Those three queries returned zero records at the time of checking, so an empty Clean filter and "No ratings yet" are expected until real contributions exist.

The same client was denied private saved-place and note collections, an own-code record, and an individual vote record. No sign-in was needed to read the public feeds.

NYC Planning GeoSearch `/v2/search` and `/v2/reverse` each returned HTTP 200, a GeoJSON FeatureCollection with six suggestions, and an `Access-Control-Allow-Origin: *` header. These probes used a public Herald Square address and fixed public coordinates, not a visitor's location. Results remain address suggestions, not proof of a restroom or permission to enter.

## Limits and delivery

No backend/library change was necessary for the checked operations. Browser/mobile review, the shared finder-gate removal, and the integrated build are recorded separately by the coordinating reviewer. The emulator checks establish local account/write behavior; they do not establish successful production Google OAuth completion, real-device location permission behavior, or production email delivery. A signed-in production write was deliberately excluded to avoid adding invented public venue data.

After the coordinating reviewer completed browser checks, the owned Auth and Firestore emulator processes were stopped. Their command lines were confirmed before signaling, and ports 8088, 9099, 4400, 4500, and 9150 were verified closed. No production process was stopped.
