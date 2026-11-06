# Public anonymous visit notes

Status: public notes, additive rules and policy-3 cleanup are live. Native **1.0 (12)** is Testing in the existing **4995** and **Team** internal groups, and the matching web compatibility release is deployed. See [release checks](public-notes-code-release-checks.json) and [web verification](web-code-compatibility.md). Future internal distribution defaults to Team only.

The user requested removal of private visit notes: all new notes are public, and their displayed owner is Anonymous. They confirmed that existing notes belong to consenting team/test accounts. An authenticated, read-only collection-group audit of the existing private-note namespace found zero documents (aggregate count and complete scan agree). No existing note publication, deletion, backup or migration is required.

## Accepted behavior

Rate and Comment owns cleanliness input and public visit notes. Everyone can read notes without signing in, on every device. Apple or Google sign-in is required to publish or remove an owned note. The form explains that its text and actual visit time will be public and displayed as Anonymous. Account identities are not attached to public records; user-written text can still identify its author. Publishing requires an explicit action and never follows automatically from sign-in.

Only the short on-device AI summary depends on Apple Intelligence availability. Public note feeds, contribution, ownership management and full structured reports remain usable with it off. The main card retains Hours and Amenities, with Passcodes directly below Amenities, a compact dated Condition row on every device and a contiguous Rate and Comment / Details & reports group below the optional summary. No editor appears on the main card. Rate and Comment groups the rating summary and editor in one Cleanliness rating section, and public notes and structured reports in one Visitor notes section.

The summary merges structured fields from public notes and legacy public visit reports, with namespaced in-memory identities (`note:` and `visit:`), bounded input, actual observation dates and no double creation. Public note body text stays out of the model and Analytics. The model's constrained highlights never change stored venue facts, ratings or filters. A text-only note remains fully readable in Rate and Comment without fabricating a structured summary.

## Data contract and compatibility

`restroomPublicNotes/{placeID}/notes/{noteID}` is an immutable, anonymous public projection. It has exactly nine fields: `schemaVersion: 1`, `placeID`, `observedAt`, `submittedAt`, `body`, `condition`, `soap`, `toiletPaper`, and `stairs`. IDs are 20 alphanumeric characters. Body text is at most 1,000 characters (clients use the conservative UTF-16 limit); require non-whitespace text or at least one known structured answer. Observation time must be real and in the past; submission is the atomic server commit time. Unknown answers stay unknown.

`users/{uid}/restroomReadyPublicNoteReceipts/{noteID}` contains exactly `placeID` and the matching `submittedAt`. It is private ownership evidence, never public identity. Create and owner deletion must atomically transition both documents, using the exact place, ID and timestamp. No partial transitions, edits, receipt adoption or public identity fields. Public reads are scoped to one place and the latest ten posted notes; private receipts support owner GET only. Non-anonymous authentication and the existing account-deletion lock protect mutations.

Keep the strict legacy private-note and structured visit-report schemas intact for existing clients. The updated clients stop fetching or writing private notes. The web counterpart uses the same new public contract and explicit anonymous display; there is no redesign of unrelated finder UI.

## Plan, ownership and rollout

The independent security and UX plan review passed before implementation. The native agent owns the model, guarded store, public form and pure validation checks; the coordinator owns the detail integration and summary merge. The backend agent owns new Firestore rules/tests and account-deletion policy 3. The web agent owns the scoped web store/component and SDK checks. Changes receive independent source and actual UI review before release.

Policy 3 must clean the new paired public notes before private recursive cleanup and Firebase Auth deletion. It preserves the existing public restroom and anonymous rating behavior, fenced leases, retries, and legacy policy 1/2 recovery. Deploy the tested backend and raise its persistent policy floor to 3 before enabling new note writes in rules or clients. This prevents policy 2 from losing the new private receipts before cleaning public text.

Verify exact schemas, invalid dates/text/Unicode boundaries, public bounded reads, Apple/Google owner creation, anonymous/signed-out mutation denial, paired transitions, ownership forgery, account locks, stable retry and late-account/place responses. Verify deletion interruption/recovery and unchanged public restroom/rating data. Then inspect real native and browser layouts, the grouped card, empty stars/conditional Submit and public-note sign-in cancellation at normal and large sizes. Use only emulator data for destructive/authenticated contribution checks; no fabricated production notes or ratings.

The earlier private-note candidate's 92 model checks and four UI flows are baseline evidence only. Final public-note/code/UI acceptance uses the fresh 119-file source manifest, 116 pure native tests and normal/largest-text runtime and independent visual checks recorded in the release evidence. Build 12 has been uploaded, independently verified and enabled for both explicitly requested internal groups; its temporary job was cleaned up. Future internal distribution remains Team only. No external submission, Git commit or push is included.
