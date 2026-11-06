# Signup-event reliability

Status: implemented and independently verified, November 5, 2026; not published. No historical conversions are injected. No Firebase account, Analytics setting or tester membership is changed by these checks.

## Problem and scope

A read-only audit found one Firebase Google account created on November 5 without a corresponding `sign_up` in the current GA report. Its originating client is unknown. Reporting latency, an older client and deliberately excluded moderator authentication remain possible explanations; the changes below are not proof of that account's delivery failure.

The review identified two concrete client failure paths: the website marked an account counted before its Analytics transport accepted the command, and both clients required optional provider metadata even when the successful credential flow already established Google or Apple.

## Plan and behavior

- Web: mark a confirmed signup consumed only after enqueue succeeds. Keep at most one pending confirmed-new candidate in memory for ten minutes. Retry on public-route initialization, tag readiness, online and foreground signals. Clear it on sign-out, account change, provider unmount, excluded routes or expiry. No persistent account identifier or signup queue is added.
- Web and iOS: recover an absent provider ID only from the fixed provider of the actual successful credential exchange. Reject contradictory or unsupported metadata. Require `isNewUser=true`, a matching current account, and the existing duplicate guard. Unknown and returning results never become signups.
- Native: preserve optional Analytics consent, withdrawal/reset and simulator suppression. The Firebase SDK already owns offline delivery; do not add a second queue or replay events captured before consent. The signed build 20 archive and distributed builds remain unchanged.
- Preserve moderator exclusion, sanitized public-route pageviews, event name `sign_up` and method-only signup payloads. No raw account IDs, emails, searches, coordinates or note/code text reach Analytics.

The independent plan review approved this bounded fix and rejected timestamp-based signup inference and a second native retry queue. A Measurement Protocol backend would add private secrets and consent/deduplication requirements while still lacking an ingestion acknowledgement; it is outside this repair.

## Acceptance and verification

Focused checks cover enqueue failure then one successful retry, delayed initialization, expiration, account changes, moderator/private-route exclusion, missing versus contradictory provider metadata, returning/unknown/stale accounts, duplicates and payload privacy. Native checks preserve consent and simulator boundaries.

- All 15 focused web checks pass, including the actual compiled component under deterministic hook/transport mocks. Initial configuration failure still renders the Google tag, and tag readiness drains exactly one pending event. This is component fault-injection evidence, not a live browser or Google ingestion check.
- All 359 web regression checks pass with `NODE_OPTIONS=--experimental-strip-types npm test`. The first sandbox run could not open loopback fixture servers and this machine's Node 23.4 required the explicit TypeScript-stripping flag; the rerun used local loopback permissions and the flag without changing application tests to skip failures.
- `npm run typecheck` and the production static/Worker build pass.
- All 199 native model tests pass, including four new provider-recovery/classification tests.
- An unsigned Firebase-linked simulator build passes on the Mac Studio with Xcode 26.2 and iOS Simulator 26.2, for arm64 and x86_64. All six transferred source/test hashes match local input. The separate candidate leaves existing frozen build sources and archives untouched. No app launch or real authentication was performed.
- Independent review found and resolved one tag-readiness issue, then approved the final patch with no remaining blocker. It separately executed the actual component and helper code under isolated mocks.

Analytics enqueue is not a receipt from Google. The browser tag and native SDK own subsequent network delivery, and standard GA reporting can be delayed. Live end-to-end confirmation requires an eligible real new-account sign-in; tests must not create artificial production accounts or conversions. Firebase account creation remains the authoritative account record.

## Delivery

Website publication and a new native binary are separate delivery steps and have not occurred. The currently distributed builds and signed build 20 archive cannot receive source edits. No Git commit, push, server/Firebase deployment or TestFlight assignment was performed. The existing web release is preserved; the local checkout also contains held App Store support/privacy/moderation work, so publishing its whole build would exceed this narrow Analytics repair.
