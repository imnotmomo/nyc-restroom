# Firebase web backend

The Next.js app uses the team's existing **`nye-restroom`** project. Firebase agent skills were installed with `npx skills add firebase/agent-skills --agent=codex --yes`; setup followed the basics, web authentication, Standard Firestore, rules creation, and rules auditor guidance. The official Firebase MCP server was used for app creation, configuration retrieval, and rules inspection/validation.

## Registered app and database

- Platform: **Web**.
- App nickname: **Restroom Ready Web**.
- Firebase app ID: `1:547771536579:web:f651ddda4a81b2e9297e76`.
- Project number: `547771536579`.
- Existing database: `(default)`, **Standard edition**, `nam5`.
- Web client configuration: `firebase/web-config.json`.
- Default project mapping: `.firebaserc`.

The web SDK identifiers are public client configuration, not administrative credentials. Firebase Authentication and Firestore rules control access. No service account key or CLI login token is committed. `NEXT_PUBLIC_FIREBASE_*` environment variables optionally override the checked-in web configuration. The existing GA setting is independent; retrieving the Firebase app configuration does not certify the course's Google Analytics setup.

## Google Sign-in

`firebase.json` configures the Google provider with Restroom Ready's name and the authenticated project account as its support email. `npx -y firebase-tools@latest deploy --only auth --project nye-restroom` completed successfully.

Configured redirect domains include the Firebase auth handler, `nyc.imfinethanku.me`, `restroom-ready-nyc.clcii.chatgpt.site`, and `localhost`. The VPS hostname was added and the auth configuration redeployed on October 15, 2026. Use `http://localhost:4173` for the production preview or `http://localhost:3000` for development. Add future deployment hostnames to the provider configuration before deploying them. Google rejected a numeric-IP redirect URI during setup; it was removed before the successful deployment.

The app initializes Firebase in the browser, restores auth state, and opens Google Sign-in from a direct button click. There is no account-email or organization-domain allowlist in the application. The owner explicitly approved public browsing, and the Site access policy is now public (revision 2); Firebase sign-in still protects saved places and private notes. Browsing, source details, and directions work without an account. The UI explains blocked popups, cancellation, missing providers, and unauthorized domains without exposing credentials.

## Firestore data

Public location browsing uses the official snapshot bundled in `data/nyc-restrooms/`. The collection now includes all 1,064 distinct citywide listings with valid coordinates from the saved source; all 55 IDs from the initial Upper Manhattan sample are retained. The data importer preserves its source dates, IDs, and unknown fields. It is not a live availability feed. The bundled city snapshot stays separate from the public visitor-submission collection described below.

Account data uses these private paths:

| Path | Stored fields | Operations |
| --- | --- | --- |
| `users/{uid}/restroomReadySaved/{placeID}` | `placeID`, server `savedAt` | Owner read/create/update/delete |
| `users/{uid}/restroomReadyNotes/{autoID}` | `placeID`, `observedAt`, server `submittedAt`, `condition`, `soap`, `toiletPaper`, `stairs`, `entryNote` | Owner read/create/delete; immutable after creation |

No profile document, user email, written public review, or administrative role is written. A profile document is not needed: the authenticated UID and path establish ownership. All unmatched paths remain denied. The initial inspection found default-deny rules; existing private data is preserved as features are added.

## Public cleanliness ratings

`restroomRatingSummaries/{placeID}` stores only integer `ratingCount`, integer `ratingSum`, and timestamp `updatedAt`. The public average is derived from sum/count. Anyone can read a summary; the public feed queries summaries where `ratingCount > 0`. No contributor name, email, UID, private note, or location history is exposed through these totals.

The private `restroomRatingSummaries/{placeID}/ratings/{uid}` document stores `stars` (an integer from 1 to 5) and server `updatedAt`. Only that signed-in, non-anonymous account can read its individual rating. Raw vote lists and other users' votes are denied. One vote exists per account/place; updates replace it and removal deletes it.

Both changes must be atomic: the client transaction changes its own vote and the public totals together. Security Rules validate the exact before/after count and sum on both documents, strict schemas, and server timestamps. Clients cannot create city-listing summaries or delete summaries, write votes without their paired aggregate, change another account's vote, or increment totals alone. A trusted administrative initializer creates empty zero-count summaries for known source IDs, using create-only writes that preserve every existing document. Zero totals are not sample ratings and are not included in the public feed.

Read errors and pending/cache snapshots are not presented as confirmed empty ratings. The public feed is independent of sign-in; the selected account's individual rating is read separately and cleared when the account or place changes. No persistent Firestore disk cache is enabled. See [ratings feature record](features/public-ratings.md) for validation and deployment evidence.

## Visitor-submitted locations

Google Sign-in is required to log a missing restroom. Public `communityRestrooms/{community-<20-character-autoID>}` records contain only the name, address, coordinates, category, entry permission, step-free route report, optional notes, optional observation date, and server submission time. The public listener reads the most recent 1,000 records; rules require a bounded list query. Coordinates are checked against an approximate NYC rectangle, not municipal boundaries. These are visitor reports, not city records or inspections.

Each creation atomically includes an immutable private `restroomSubmissions/{sameID}` receipt with only `ownerUID` and server `submittedAt`, plus the same location’s zero-count rating summary. The rules require all three together and reject anonymous accounts, additional fields, malformed values, invalid observation times, reused IDs, client edits/deletes, and identity data in the public record. Empty summaries contain no votes. Receipt reads are owner-only; receipt lists are denied. Ratings, saved places, and private notes accept stable community IDs only when the public listing exists.

The form keeps one request ID through retries. A server read checks the matching public payload, private ownership receipt, and rating setup before acknowledging success. An already saved earlier version with different details is surfaced explicitly rather than overwritten or duplicated. The user must contact the project team for corrections/removal in this version. Chosen pin coordinates become public on submission; private visit notes remain private. See [the feature record](features/log-restroom.md).

For local end-to-end checks, start the Auth/Firestore emulators with a `demo-` project and run Next.js with `NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true` and that demo project ID. This mode requires `localhost` or `127.0.0.1`; production builds leave it unset. Local Google-provider test users do not create accounts or votes in the real project.

The client uses server-only reads and waits for write acknowledgement. The UI clears private state when the account changes, discards stale results, and keeps form entries on a failed write. If a note save succeeds but a subsequent refresh fails, it reports that the note was saved and offers a refresh instead of prompting a duplicate submission. Persistent Firestore disk caching is not enabled. Reads retain references to retired listing IDs; new writes require a location in the current city collection or a valid community listing.

## Restroom passcodes

Codes are separate from public location records. A new location can report `passcodeRequired: yes/no/unknown`; legacy submissions without it remain unknown. Its optional code is saved in the same atomic batch as the listing, submission receipt and empty rating summary. No raw code or visibility is written to `communityRestrooms`.

| Path | Purpose and access |
| --- | --- |
| `users/{uid}/restroomReadyPasscodes/{placeID}` | One account-owned code per place, private/public visibility, creation time, exact code-update version and optional successful-use verification time. Owner-only reads and writes. |
| `restroomPasscodeOwners/{reportID}` | Immutable private ownership reservation, created/deleted atomically with the own code. Owner-only GET; no LIST. Prevents copying a public report ID to steal control. |
| `restroomPasscodeReports/{placeID}/reports/{reportID}` | Public projection only after the owner chooses Everyone. Code, place ID, code-update time and optional verification time; no account identity. Selected-place queries are bounded to the latest 10. |
| `users/{uid}/restroomReadyPasscodeChecks/{reportID}` | Private receipt for an explicit public-code verification, pinned to the exact current code timestamp. No public checker identity or receipt list. |

Only me is the default and atomically ensures a saved-place record exists. A user can later unsave the place normally; a subsequent private-code save or verification may add it again. Removing a code leaves the saved place intact. Only the reserved owner can edit, delete, publish or privatize their report. Multiple people may report different codes independently.

Saving/publishing does not verify a code. The user must explicitly confirm successful use; public confirmations require a signed-in non-anonymous account and an atomic, version-pinned receipt. Code changes clear verification. A same-code visibility change preserves a real check, including the latest community check when a public code becomes private. Transactions and exact timestamp versions reject stale edits and confirmations. Private codes are not sent to public feeds, Analytics, URLs or application error messages. These are visitor reports, not guarantees of entry or current validity. See [passcode feature record](features/restroom-passcodes.md) for current verification and release evidence.

## Rules and checks

`firebase/firestore.rules` was independently reviewed, compiled successfully by Firebase, and deployed to the selected project. The rules enforce owner-only access, strict field/type/enum/length checks, server submission timestamps, and observed dates between January 1, 2000 and the submission time. Favorites validate creates and updates; notes cannot be updated. A newline/slash ID regression is covered.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for private account data through ownership checks, strict schemas, and bounded fields. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

Verification completed:

- TypeScript check and production static build passed.
- All **41 Node regression tests passed**, including signup, location, source import, filters, and rating arithmetic.
- **238 Firestore emulator security cases passed**: 85 private-data cases in `demo-restroom-ready`, 50 ratings cases in `demo-restroom-ratings`, and 103 community-submission cases in `demo-restroom-community`. These cover owner workflows, cross-user/anonymous denial, malformed records, timestamps, immutable notes, exact aggregates, replay, and concurrent edits. No production votes were created.
- The current directory contains all 1,064 source listings. Public/private ratings flows were browser-tested with demo Google accounts, including a separate signed-out reader, submit/update/remove, reload, failure retention, and 320/390px layouts. Map clustering and source-detail checks are recorded separately under `docs/features/`.
- Google popup reached Google's actual sign-in page using the new app's OAuth client and `nye-restroom.firebaseapp.com/__/auth/handler`.
- Browser testing did not enter real Google credentials or create real signed-in notes/ratings. A fresh unauthenticated production SDK client verified the public ratings query and private-vote denial without writing data.

For rules tests, use Node.js 22.13+ and Java 21+. With `JAVA_HOME` pointing to Java 21, run:

```sh
npx -y firebase-tools@latest emulators:exec --only firestore --project demo-restroom-ready 'npm run test:firebase'
```

Production deployment commands target only the requested services:

```sh
npx -y firebase-tools@latest deploy --only auth --project nye-restroom
npx -y firebase-tools@latest deploy --only firestore:rules --dry-run --project nye-restroom
npx -y firebase-tools@latest deploy --only firestore:rules --project nye-restroom
```

This machine's pre-existing Firebase config directory is owned by root. Setup used the private, ignored `.firebase-agent/config` directory via `XDG_CONFIG_HOME` without changing the original directory. Repeat CLI operations with that variable when using this login. Never commit the directory, CLI debug logs, session tokens, or account exports.
