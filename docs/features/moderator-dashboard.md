# Moderator dashboard

November 5, 2026. Web, moderator API, additive indexes and strict queue rules are deployed. The selected Google account is independently verified as the sole enrolled moderator. Native build 18 is Testing in Team and 4995 after the explicit class-release request. See [integration evidence](moderator-dashboard-qa.json).

## Brief and acceptance

Provide a restricted web workspace at `/admin/` to approve or deny new restroom requests and remove improper visitor comments. Initial moderator: the verified Google account `zc2856@columbia.edu`. Existing public restrooms remain unchanged. Public readers keep the exact existing schemas. New listings are private until approved, and requesting users can see their request status. Moderator access is enforced by the server on every API request; client UI is never an authorization boundary.

Acceptance includes cross-account/anonymous denial, closed public-create bypasses, stable submission/action retries, no private-code exposure, approval/rejection and account-deletion races, paired comment removal and replay prevention, responsive/keyboard dashboard flows, and actual deployment/readback. Ordinary users cannot assign moderator privileges. No production fake submissions/comments will be created for testing.

## Ownership and plan

- Root: moderator API/service, server authorization, integration/deployment, web request submission adapter, shared Analytics exclusion and final review.
- Data/rules agent: Firestore rules/indexes and emulator security/regression tests.
- Native agent: pending request models/store/form/status UI and meaningful tests; keep current reader/sheet behavior.
- Dashboard agent: `/admin/`, scoped styles, client API adapter and dashboard; review queue, decisions and visitor comment removal.

The separate reconnaissance reviews converged on the private-user queue below. A public status field would break existing strict native decoders and would not filter the shipped unfiltered public query. The design also fits account-deletion policy 4 without inventing a new cleanup namespace.

## Data contract

New private requests live at `users/{uid}/restroomReadySubmissionRequests/{communityID}`. Atomically create the existing `restroomSubmissions/{communityID}` reservation with exactly `ownerUID` and `submittedAt`. IDs keep the existing `community-` plus 20 alphanumeric format.

Initial request fields are exactly:

```text
schemaVersion: 1
status: "pending"
revision: 1
submittedAt: server timestamp
listing: exact existing communityRestrooms fields, including submittedAt at the same server timestamp
codeDraft: null | { code: validated code, visibility: "private" | "public" }
```

No public listing, rating summary, code projection, code owner reservation or Saved record is created by this submission. Client writes cannot update a request or decide its status. Owner-only bounded request reads are allowed; moderator collection-group access goes through the server.

Approval/rejection updates the private request to revision 2 with terminal status, `reviewedAt`, a bounded reason code, `codeDraft: null`, and a private `codeFingerprint` (null when absent) for exact stable-draft confirmation after raw draft scrubbing. The fingerprint is SHA-256 of UTF-8 `rr-request-code-v1\u0000` + visibility + `\u0000` + normalized code. It is owner-only, never a dashboard DTO/revision/cursor/audit field. It does not replace authentication or authorization. All original listing fields/timestamps remain immutable. Native/web confirmation compares the actual draft while pending and this private commitment for a reviewed request.

Only the backend approves. In one transaction it checks the request/reservation pair, revision and pending status, account deletion lock and absence of conflicting public records; then creates the **exact original public listing schema**, the empty rating summary and optional existing legacy code/owner/private-or-public/Saved pair. Use the original report timestamp for listing/code dates. Review time is private metadata. Approval never means accessibility, hours, conditions or codes have been independently verified. Rejection publishes nothing. Account-deletion locking fences approval; queues under the user root and their existing global receipts already participate in policy-4 cleanup.

Existing public records are grandfathered without modification. Rules cutover denies all direct client creation of community listings and rating parents. Older app builds still browse normally but must update to submit requests. Deploy new clients before activation; do not claim secure approval is active while the legacy write bypass is open.

## Moderator API contract

Same-origin `/api/moderation/`, loopback backend service, Firebase bearer token on every request; JSON and no-store responses. Verify token signature/project/audience/expiry/revocation, current enabled Google account, server-controlled moderator UID roster and absence of deletion lock. Pin the first verified selected Google account to its UID once; an email change/reuse does not silently regrant access. Credentials and roster live only on the VPS.

- `GET session` → `{ user: { email, displayName }, role: "moderator" }`.
- `GET requests?status=pending|approved|denied&limit=25&cursor=...` → `{ items: RequestDTO[], nextCursor: string|null }`.
- `POST requests/{id}/decision` with exactly `{ decision: "approve"|"deny", revision: number, reason: string, actionId: UUID }` → `{ id, status, revision, reviewedAt }`.
- `GET comments?limit=25&cursor=...` → `{ items: CommentDTO[], nextCursor: string|null }`, combining legacy public notes and unified visitor comments, by original submission time.
- `POST comments/{kind}/{placeID}/{id}/remove` with exactly `{ revision: string, reason: string, actionId: UUID }` → `{ id, placeID, kind, status: "removed", mode: "redacted"|"deleted" }`.

`RequestDTO` contains only id, status, revision, submittedAt/reviewedAt ISO dates, reason, listing with ISO dates, and `hasCodeDraft`. Never return requester UID, private code/digest or private document path. `CommentDTO` contains id, placeID, venueName, kind (`public-note` or `unified-visit`), public text, public author label, observedAt/submittedAt ISO dates and an exact Firestore update-time revision. No raw content hash is used as a revision.

Approval reason is empty. Denial reasons: `duplicate`, `insufficient_details`, `incorrect_location`, `restricted_access`, `other`. Removal reasons: `personal_information`, `harassment`, `spam`, `misleading`, `other`. The UI presents understandable labels. No removed body, code or requester identity is copied into action/audit receipts. Receipts keep action ID, moderator UID, fixed action/target/reason, time and minimal result; repeated same action is idempotent, conflicting reuse or stale revision returns 409.

Pagination is bounded, uses opaque server cursors and does not expose UID-bearing paths, even encoded. Expired cursor → 410 `cursor_expired`. Unauthorized → 401, nonmoderator → 403, stale/action conflict → 409; fixed error codes, no raw SDK error leakage. Moderator data remains in page memory only, clears on account change/revocation and never enters product Analytics, URLs, localStorage or logs.

## Comment removal

Scope is user-written visitor text, including existing public notes and unified visit comments. Imported source research is not a visitor contribution and is unchanged.

If structured observations remain, redact only body/comment to empty while preserving exact dates, schema and ownership receipt. Otherwise remove public record and its exact matching private receipt atomically. A bounded server-only receipt lookup must fail closed on missing/ambiguous ownership. Never delete another user's receipt by inference.

For **both** redaction and deletion, write a server-only marker under `restroomModerationRemovals/{placeID}/publicNotes/{noteID}` or `/unifiedVisits/{reportID}`. Creation rules reject a marked ID, preventing old stable retries from undoing removal after the owner later deletes the pair. Markers contain no author identity or removed text. Existing public snapshot listeners handle removal/redaction without a native reader change; account history pairs remain valid.

## Verification and release

Use emulator identities and fixtures for meaningful full approval/rejection/removal/race tests; keep them out of production. Verify the static dashboard contains no credentials or privileged dataset, regular users cannot authorize themselves, and the public website and all existing Firestore contracts still work. Native changes require an actual Firebase-linked Xcode build and focused mobile runtime checks. Internal builds default to Team only; no public beta review is included. Record security, UX, package and live deployment evidence separately before claiming completion.

## Current delivery

The [moderator workspace](https://nyc.imfinethanku.me/admin/) uses the selected Google account. Its successful verified sign-in has pinned the server-controlled UID. Desktop approval, denial, private-code handling, comment removal/redaction and account-switch isolation passed through the actual local Firebase SDK/emulators. The production page has no fixture login or Analytics tag. The deployment uses a dedicated seven-permission service identity; the key stays only on the VPS. Existing 103 community listings were left intact.

The compatible web client is live, and the rules now close direct-public creation. Older native builds continue browsing but must update for Add restroom. Build 18 passed 184 model tests and five actual Firebase-linked simulator cases. The same signed archive uploaded successfully after the developer account was refreshed; Apple processing finished and its sole Team assignment is verified. Build 18 was initially assigned to Team only; the user then requested class and public distribution. It is now Testing in Team and 4995, with their two and five existing testers. The identical-code external-eligible build 19 uploaded successfully, finished processing and is now **Testing** in the existing **Public Beta** group, with the public link unchanged. No testers were added.

[Maya review](moderator-maya-review.md) approved the pending/status/code copy, with optional direct View request and correction/resubmission improvements left for later. Actual large-text reachability is recorded in [native QA](native-moderation-qa.json). The 320px web layout was visually checked; mobile touch/200% text interaction is not claimed. No production test users, locations, comments, codes, ratings or moderation decisions were created.

The independent [live review](moderator-live-review.json) verifies deployed code hashes, active process ownership, public browsing, ready indexes, the exact rules source, restricted IAM reads and single deferred no-cache/no-referrer/anti-framing headers. The selected moderator’s actual verified Google account now matches the sole private roster entry. The server’s enrollment path verifies the token, live account and deletion lock before pinning access. Build 18 package and export-retry details are in [the signed-archive receipt](native-build18-package-checks.json), and current internal Testing is recorded in [distribution](native-build18-distribution.json). The previous builds and tester memberships remain unchanged.
