# Map add action and anonymous public contributions

Status: shipped to the existing Team internal TestFlight group as 1.0 (11), October 23, 2026.

## Request and acceptance

Remove Your library from Account. Move Add a restroom from Account to a compact circular + on the map. Preserve the existing sign-in, cancellation and form-resume behavior; retain Account and Saved places. The neutral Liquid Glass control must have a useful accessibility label, a minimum 44-point target and room around the existing bottom controls. Hide it while searching, using List, or presenting a sheet.

Deleting an account must preserve submitted restroom listings and cleanliness ratings without retaining their account ownership. Public rating counts and averages must not change. Firebase Authentication and private account data are still removed. Existing public code/visit cleanup remains outside this requested retention change. The confirmation and privacy notice must describe the new distinction.

Future internal builds go to the existing **Team** group only unless the user explicitly specifies another group. This request does not change existing group membership or authorize a new external review submission.

## Plan and reviewed decisions

- Native views and UI tests: remove Account library/Add rows, keep Saved, and reuse `requestNewPlace` from a 48-point circular map action.
- Public community records have randomly generated IDs and no public owner UID. Preserve their complete payload and timestamps; remove only the private ownership receipt.
- Atomically create a cryptographically random Admin-only `anonymousRatings` record containing only the existing stars and timestamp, then remove the original UID-keyed rating. Do not write the public summary. A retry after the atomic move is a no-op. No UID, UID hash or reverse mapping is retained with the anonymous vote.
- Future aggregate repairs must count both `ratings` and `anonymousRatings`. Invalid own rating data fails closed rather than creating an invented rating. Unknown future deletion policies fail closed, including retention pruning.
- Use policy version 2 for new and remaining legacy pending work. Previously completed erasures cannot be reconstructed. Preserve the existing reauthentication, Apple revocation, server lock, lease, Auth-last and retry protections.
- Enter maintenance before replacing the destructive policy. Install a persistent minimum-policy startup guard so deployment rollback cannot reactivate version 1 after version 2 is accepted.

Independent plan review approved the native flow and the revised anonymous namespace design. The source-only Alex usability review had no blocking findings; it is a simulated review, not real user testing. File ownership is split between the native implementation, backend implementation, independent reviewer and coordinating deployment/privacy/docs work.

## Verification and delivery

The live database was checked as the existing Standard `(default)` database in `nye-restroom`, `nam5`. A read-only preflight found zero deletion records. No real account deletion is used as a development test.

The unchanged production rules passed eight focused emulator checks for anonymous-record client denial, normal owner rating transitions and stale-token write rejection. The deployment startup guard passed nine focused tests, including a real CLI rejection and a managed release symlink. Native source review and Swift parsing passed. The Firebase-linked simulator build passed in 20.047 seconds. All five focused UI workflows passed on the same 111-file source snapshot: Account, provider choices, filter/Saved recovery, map-add cancellation and simplified Account, and largest accessibility text. The largest-text test initially reached a disabled Locate me spinner before its new assertions; seeding the documented simulator-only NYC location allowed the unchanged test/source to pass in 61.253 seconds. No real account was authenticated, rated or deleted by these UI checks. Normal and largest-text screenshots were inspected.

The backend passed 10 unit tests and 17 isolated Auth/Firestore emulator checks, including atomic anonymous moves, stable public totals and listing payloads, retries, interruption, concurrency and legacy/future policies. Independent source and live read-only verification passed. Policy 2 is live in backend release `20261024T010347Z-378edaa8fc9f`, after a maintenance boundary and complete old-service stop. The persistent startup floor is 2; an actual read-only guard invocation rejects the old release and accepts the new release. No real account deletion was performed in production.

The revised privacy notice is live in web release `20261024T010631Z-378edaa8fc9f`. The deployed and local compiled bundle SHA-256 both equal `faa95188df3995546ff7b8feb8270433d1148cd8639d2f738beb1dc4da390ab0`; both services and HTTPS web health passed. Browser readback confirms preserved venue details, anonymous ratings and unchanged public totals. Next.js build and standalone typecheck pass. An additional production deletion-endpoint probe was rejected by automatic approval review and was not executed; live verification uses read-only health/configuration and the public notice.

Build 11 archive/upload started at 9:13:47 PM Eastern on October 23. Its frozen packet passed independent review with source, signature, entitlement, profile, privacy-manifest, Analytics and dSYM guards. Apple accepted the upload at 9:16:53 PM Eastern, with `Uploaded Restroom Ready`, `EXPORT SUCCEEDED` and exit 0. Independent checks verified all 143 signed app/dSYM file hashes and all 111 sources unchanged; only a single valid successful distribution event was added to outer archive metadata. Apple processing finished. The saved What to Test describes the map action, simplified Account, anonymous retention and text-size checks. The build detail shows exactly one assigned group, Team (Internal, 2 testers), and zero individual testers. The Team build table confirms 1.0 (11) is Testing. No tester membership changed, and neither 4995 nor Public Beta was assigned to build 11. Existing external build 10 is unchanged. The exact one-time service, three staged files and job directory were independently confirmed absent afterward; the archive and private receipts remain preserved, with no IPA retained. See [Team-only assignment](screenshots/native-testflight-build11-team.jpg) and [Testing status](screenshots/native-testflight-build11-testing.jpg). Installation and genuine provider reauthentication/deletion on a physical iPhone remain user-device checks; no production account was deleted for testing. No Git commit or push is included.

Actual simulator screenshots: [map +](screenshots/native-map-add-17pro.png), [simplified Account](screenshots/native-account-simplified-17pro.png), [largest text map](screenshots/native-map-add-large-text-17pro.png).
