# Code reporting and feedback

Build 1.0 (12) combines the public rating summary and star editor in one Cleanliness rating section, and public notes and structured visit details in one Visitor notes section. Add a note or comment and Report visit details retain their existing protected forms. A compact Condition row sits below Passcodes, showing a dated reported condition independently of Apple Intelligence. Signed-out Account omits Browse without an account and Saved places. Its sheet fits the sign-in card, followed immediately by the small dark-gray privacy link and dated-information notice; accessibility text uses a scrolling sheet. Saved mode replaces the bottom Filters control with Return to main map. The bottom map bar is eight points shorter with unchanged touch targets. Normal and largest-text simulator checks and independent visual review passed.

Status: build **1.0 (12)** is **Testing** in the existing **4995** and **Team** internal groups, as explicitly requested for this version. The matching [web code compatibility update](web-code-compatibility.md) is live. Future internal builds default to Team only.

Passcodes sits directly under Amenities on the native place card. The main card shows one public code. A reported successful-use verification takes priority: choose the latest verification date, with a verified code ahead of an unverified one. If neither has been verified, choose the latest report date. Display the date used for this choice. Private codes stay account-scoped. The Passcodes destination uses compact code cards with visible **I used this code** and **Code didn’t work** buttons and a **Report a new code** action. Actions keep 44-point targets and grow for Dynamic Type; facts are not separate padded List rows.

Every new code report has a new immutable ID. Reporting a replacement preserves earlier public reports; changing visibility or removing a code remains restricted to its owner. Only me stays the default and automatically saves the restroom. Do not publish private codes or seed production reports for testing.

The main card prioritizes the latest verification date; exact report time and stable source/ID break ties. For legacy codes, use the latest current-version date across legacy successful-use checks and the new feedback summary, without turning legacy dates into distinct-user counts. Details keeps all recent reports while the newest report by report time has fewer than **four distinct nonowner signed-in accounts** currently reporting successful use. Once it reaches four, that report remains visible, together with the main card’s most recently verified code if that is a different report. An older verified code cannot hide a newly reported alternative before people can check it. This only hides older details; it never deletes history or asserts a code works now. Invalid feedback remains visible as a reported result and does not automatically remove the newest code. Legacy verification dates never become a distinct-user count.

## Additive contract

Legacy code schemas remain unchanged. New reports use:

- `users/{uid}/restroomReadyPasscodesV2/{reportID}`: exactly `placeID`, `code`, `visibility`, `createdAt`, `codeUpdatedAt`, `lastVerifiedAt`. Code and report time are immutable; a changed code needs a new ID.
- `restroomPasscodeV2Owners/{reportID}`: immutable private `ownerUID`, `placeID`, `createdAt` reservation, paired with creation/deletion. A private report reserves its ID too.
- `restroomPasscodeReportsV2/{placeID}/reports/{reportID}`: anonymous public `placeID`, `code`, `codeUpdatedAt`, only while its owner selects Everyone.
- `restroomPasscodeFeedback/{placeID}/codes/{kind}_{reportID}`: exactly `placeID`, `kind`, `reportID`, `codeUpdatedAt`, `usedCount`, `invalidCount`, `lastUsedAt`, `updatedAt`. Kind is `legacy` or `v2`; exact current code version is required.
- `users/{uid}/restroomReadyPasscodeVotes/{placeID}~{kind}_{reportID}`: exactly `placeID`, `kind`, `reportID`, `codeUpdatedAt`, `vote`, `updatedAt`. Place is part of the private key because imported legacy IDs can recur at different venues.

Feedback is one exclusive current Used/Invalid vote per account and exact code version. A transaction changes the matching private receipt and public counters atomically. Repeated Used refreshes the successful-use time with a zero count delta. Switching outcomes moves one vote between counts. Invalid never fabricates a successful-use time. Owners cannot contribute to their own public consensus. Anonymous reads expose counts and dates, never voting identities. A changed legacy version ignores old-version votes and resets its summary through a valid paired current vote. Hiding/deleting a code makes its feedback unreadable too.

Public anonymous notes are included in the same release. Store/model/form, security/backend and independent review checks were completed separately from card layout work.

## Rollout and checks

Policy 3 is live and the persistent minimum policy is 3. It cleans the new owned code pairs and feedback before removing private receipts and Auth, while preserving public restroom submissions and anonymous cleanliness totals. The reviewed additive rules and READY index are deployed. Production verification used read-only checks; no real account was deleted for QA. See [the release checks](public-notes-code-release-checks.json) for exact deployed releases and test evidence.

Checks covered immutable reports, reservation hijack denial, owner-only visibility/deletion, private-code exclusion, exact versions, four distinct nonowners, repeat/switch/concurrent votes, malformed ownership fail-closed recovery and unchanged legacy behavior. Compact native layouts and protected-action Cancel flows passed at normal and largest text sizes. The final 119-file source manifest and 143 signed payload files were verified before and after upload. Build 12 is already delivered; do not rerun its one-time upload packet. Temporary job files were removed. No external submission or Git commit/push is included. See [the distribution record](native-testflight.md).
