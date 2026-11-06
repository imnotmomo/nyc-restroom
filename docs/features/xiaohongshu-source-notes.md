# Xiaohongshu locations and anonymous source notes

## Outcome

On October 21, 2026, the reviewed native Xiaohongshu collection was imported into Firebase project `nye-restroom`, database `(default)`, batch `xhs-2026-10-21-v1`.

- Created 14 deduplicated venue records and their empty cleanliness summaries.
- Added three unverified public code reports. Nine matching code reports retained their existing update and verification versions.
- Added 21 English source notes: 12 actual comments and nine post-body notes. All display **Anonymous user**; the interface identifies whether a note came from a post or a comment.
- Kept original handles, transcripts and evidence outside public projections. No account, visit, rating or verification was invented.

The venue inventory now contains 1,064 city records and 101 community records. These counts describe stored records, not currently available restrooms or complete NYC coverage.

## Collection and limits

Nine native-app posts were reviewed, including accessible comment replies. Some threads stopped loading before their reported comment counts were reached. Image carousels were not fully traversed; only captured images support the import. This is a bounded collection, not a claim that every image or comment was read.

Source dates are retained as displayed. Explicit older years and unknown years are preserved; screenshot and import dates never substitute for a source publication date or visit date. Relative dates are marked approximate. This batch is not a 2026-only source set.

The review retained 61 unresolved or general claims privately. Ambiguous branches, unresolved or closed venues, and employee/service-door codes were not published as usable restroom locations or codes. Address pins identify venues, not exact restroom doors. Reported stairs, floor, cleanliness and access details remain attributed source notes rather than overwriting original venue facts. Unknown accessibility stays unknown.

## Public display

The finder detail panel has a **Source notes** section. Notes are English paraphrases with anonymous attribution, the original source date where available, and an unverified-source label. Capture/import times and additional limitations are available under **Source and limits**. Source notes do not become cleanliness stars or authenticated visitor observations.

The browser reads at most ten recent notes per place. Client creation, modification and deletion of this imported collection are denied. Private research remains unreadable to browser clients. Existing Google account controls for ratings, saved places, codes and visit observations are preserved.

Implementation: `lib/source-comments.ts`, `components/finder/source-comments.tsx`, its stylesheet, and integration in `components/finder/detail.tsx`. Import tools are `scripts/import-xhs-restrooms.mjs` and `scripts/xhs-import-model.mjs`; their input contract is in `scripts/xhs-import-format.md`.

## Verification and release

- Independent semantic review approved manifest SHA-256 `21a3c7ab322bddf9045d5ba1d755d3e50c8750e1c3ce941968548ea04d9fcafb` before application.
- Create-only import committed 175 exact planned document paths, including private provenance. Readback passed; replay planned zero writes.
- 175 application tests (including 14 importer and ten source-note tests), TypeScript checks and the production build passed.
- Five Firestore emulator tests passed: signed-out reads, bounded lists, denied client writes, private-provenance denial and invalid/orphan place rejection.
- A fresh signed-out Firebase Web SDK client confirmed all 14 venues/summaries, three new codes, nine preserved code versions and 21 exact public notes. Private research, unbounded queries and over-limit queries were denied. The verification made zero production writes. See `xiaohongshu-public-sdk-checks.json`.
- Live browser checks on the team domain confirmed an actual comment and a post note, anonymous attribution, unknown-year labels, public code display and expandable source details. Mobile widths 390 and 320 pixels and the default desktop width had no page-width overflow.
- Published source-note UI to Sites version 24, managed source commit `8df71d7159be1a6ebab256b7de2d019de5cc6002`, and VPS release `20261021T221641Z-8df71d7159be`. Both publication operations succeeded. GitHub source changes remain uncommitted locally.

The managed Sites commit describes the frontend publication. Backend rules were released separately from this product checkout's `firebase/firestore.rules`, preserving all existing live rules and adding only the source-note block. The deployed rule source SHA-256 is `511a1452157be9cb3e4362b8c5114713d940b00958e99ddf3114d876fe45323b` (the reviewed live-source ordering). Do not use the older rule file retained in the isolated Sites checkout as a backend deployment source.

Live example: [anonymous comment at McDonald's, Seventh Avenue and West 40th Street](https://nyc.imfinethanku.me/find/?place=community-c9c254457691dfd890ff).
