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

Configured redirect domains include the Firebase auth handler, `restroom-ready-nyc.clcii.chatgpt.site`, and `localhost`. Use `http://localhost:4173` for the production preview or `http://localhost:3000` for development. Add future deployment hostnames to the provider configuration before deploying them. Google rejected a numeric-IP redirect URI during setup; it was removed before the successful deployment.

The app initializes Firebase in the browser, restores auth state, and opens Google Sign-in from a direct button click. Browsing, source details, and directions work without an account. The UI explains blocked popups, cancellation, missing providers, and unauthorized domains without exposing credentials.

## Firestore data

Public location browsing uses the official snapshot bundled in `data/nyc-restrooms/`. The data importer preserves its source dates, IDs, and unknown fields. It is not a live availability feed.

Account data uses these private paths:

| Path | Stored fields | Operations |
| --- | --- | --- |
| `users/{uid}/restroomReadySaved/{placeID}` | `placeID`, server `savedAt` | Owner read/create/update/delete |
| `users/{uid}/restroomReadyNotes/{autoID}` | `placeID`, `observedAt`, server `submittedAt`, `condition`, `soap`, `toiletPaper`, `stairs`, `entryNote` | Owner read/create/delete; immutable after creation |

No profile document, user email, public review, or administrative role is written. A profile document is not needed: the authenticated UID and path establish ownership. All unmatched paths remain denied. The project had default-deny rules and no top-level collections when inspected; no existing data was replaced.

The client uses server-only reads and waits for write acknowledgement. The UI clears private state when the account changes, discards stale results, and keeps form entries on a failed write. If a note save succeeds but a subsequent refresh fails, it reports that the note was saved and offers a refresh instead of prompting a duplicate submission. Persistent Firestore disk caching is not enabled. Reads retain references to retired listing IDs; new writes require a location in the current collection.

## Rules and checks

`firebase/firestore.rules` was independently reviewed, compiled successfully by Firebase, and deployed to the selected project. The rules enforce owner-only access, strict field/type/enum/length checks, server submission timestamps, and observed dates between January 1, 2000 and the submission time. Favorites validate creates and updates; notes cannot be updated. A newline/slash ID regression is covered.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for private account data through ownership checks, strict schemas, and bounded fields. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

Verification completed:

- TypeScript check and production static build passed.
- Existing five signup tests passed.
- **85 Firestore emulator tests passed** against `demo-restroom-ready`, including owner workflows, cross-user/anonymous denial, malformed/oversized records, forged timestamps, immutable notes, and default-denied paths. No production test records were created.
- Production browser preview showed all 55 records and map pins, type filters, search/empty states, source/unknown details, walking directions, no initial location request, and denied-location fallback.
- Google popup reached Google's actual sign-in page using the new app's OAuth client and `nye-restroom.firebaseapp.com/__/auth/handler`.
- Browser testing did not enter Google credentials or create a real signed-in visit note. Complete that final account flow with a team account when reviewing the app.

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
