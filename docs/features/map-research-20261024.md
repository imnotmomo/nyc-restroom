# Map source research — October 24, 2026

**Status:** Complete. Production import, exact server readback, signed-out SDK checks, zero-write replay and representative live website checks passed. Coverage remains bounded source research, with the limits below.

## Purpose and scope

The user requested Internet research for the locations already on the map, covering restroom hours, amenities, entry and route details, codes, conditions, comments and original dates where available. The research is bound to a fresh inventory of **1,167 distinct map places**: 1,064 city listings and 103 community listings, captured at `2026-10-24T04:43:44.421Z`.

This is bounded source research, not an inspection or an exhaustive search of every website, review platform or discussion. A current source retrieval does not establish current restroom availability. Missing facts and missing publication or observation dates remain unknown.

| Coverage outcome | Exact places | Meaning |
|---|---:|---|
| Additional source findings | 850 | Matched evidence beyond the unchanged city record; some identity-only evidence remains private |
| Official record rechecked | 302 | Current official directory row checked, with no additional matched finding |
| Searched without additional publishable facts | 15 | Source searches completed; no suitable new public claim |
| Pending in this bounded ledger | 0 | Every inventory ID has one of the outcomes above |

The official directory still has 1,066 raw rows and 1,064 semantically distinct map listings. Its fresh rows matched the existing source snapshot exactly: no additions, removals or field changes. Directory data was last updated June 27, 2025; retrieval in October 2026 does not refresh those observations.

## Delivered evidence

The final packet contains **1,936 evidence entries**. All **2,818 create-only targets** were committed and passed the importer's exact server readback:

| Target | Confirmed records |
|---|---:|
| Public anonymous source notes | 863 across 844 places |
| New structured access sidecars | 17 |
| Private research entries, batch header and manifest audit | 1,938 |
| Total | 2,818 |

The source-note schema remains unchanged. Each note retains its source link, original timestamp text where available, publication date or explicit unknown, retrieval time, server import time and limitations. Source publication, actual inspection/visit, retrieval and import times remain separate. Imported notes have `observedOn: null` and `verified: false`; the text identifies the source, including NYC Parks. No source author profiles or inspector identities are published.

The 17 sidecars contain only supported entrance, floor or restroom-route facts. They do not turn venue hours into restroom hours, general building elevators into restroom elevator routes, accessibility badges into stair-free routes, or missing values into positive flags. Existing direct sidecars, including Peninsula, are preserved. Ambiguous competing sources and overlong fields remain in source evidence instead of being flattened or truncated into access facts. Closure warnings remain visible; a reported accessible entrance does not establish that a closed venue can be used.

## Major research slices

**NYC Parks inspections:** 635 exact matched venues, comprising 611 site-name/polygon matches and 24 additional exact building-footprint matches. Their 1,270 room observations remain separate by restroom room and actual inspection date. Latest observations are in 2026 for 624 venues, 2025 for eight, and earlier years for three. The newest actual inspection in the captured dataset is **July 31, 2026**. After both matching passes, 91 NYC Parks listings remain unresolved and receive no forced inspection join. The 71 concessionaire-operated listings are outside this Parks matching slice.

The join uses the parent inspection's exact property ID and date. Local `PRNumber` is not the global restroom inventory ID. Multiple-restroom properties, ambiguous map points and unsupported name matches are withheld. Inspector categories such as acceptable/unacceptable are not app stars. A count of soap dispensers, toilet-paper dispensers or changing tables does not establish stocked supplies, working fixtures or current amenities. Park-wide cleanliness grades are not attached to a restroom. See the [Parks capture and matching record](../../data/research-map-2026-10-24/parks/README.md).

**Library pages:** 125 captured branch-page findings were assessed; **120 are eligible** for the packet. Five conflicting or unsuitable pages are quarantined. Branch hours remain venue hours unless a source explicitly identifies a restroom schedule. Building-access badges, elevators and exact restroom routes remain distinct.

**Community venues and public guides:** Evidence retains branch/address identity, dated restrictions and disagreements. Fifteen undated public-guide code claims appear only as qualified source notes and research facts. They do not create code reports, change verification dates or confirm successful use. Staff-only code guidance is excluded. Two external venue scores retain their original scope and displayed scale or unknown scale in the research archive. Any source-note mention identifies the score as a venue aggregate; neither changes app cleanliness votes or totals.

## Review and safeguards

- Exact inventory SHA256: `1472aac295ccbe6c90f22d4993598e52921fc934ed8e06c539fb830ee399935f`.
- Final manifest SHA256: `adee7ab48de4bbf78d8286c150f9a1d7b7f392490c4c7de2c224a021719c4b74`.
- Reviewed preview-plan SHA256: `b0615ffd24755188e719f5b5bd9140c9a8aeb777819df895338e0f84d0dbc48c`.
- Independent reconstruction reproduced the manifest and all 2,818 create-only targets. Maximum encoded write size is 654,805 bytes, below the importer's 900,000-byte limit.
- Actual current client decoders accepted all 863 source-note and 17 access projections in offline SDK plan mode, with no Firebase app, authentication or live reads. The maximum new source-note count per place is three, within the existing latest-ten feed.
- Six Parks geometry/date/identity checks passed. The importer, normalizer, source-note UI and final packet have focused regression checks; the separate production results are recorded below.
- The importer requires the exact reviewed manifest and fresh preview-plan hashes, checks fresh community names/addresses/pins, writes a private `0600` backup before mutation, uses create-only preconditions and stops on conflicting immutable targets. An uncertain commit requires reconciliation rather than blind retry.
- General building claims for Barclays and campus-only directions for Lincoln Center remain correctly scoped. Peninsula's direct report is not overwritten. The source-note UI identifies source platforms from safe domains and labels unknown publication dates without inventing a year.

No code collections, rating aggregates, user votes, authenticated visitor reports, account data, Firestore rules, TestFlight builds or tester groups are part of this research import.

## Production verification

The completed apply receipt is bound to the reviewed manifest and preview plan. It records 2,818 committed writes and successful exact readback at `2026-10-24T05:16:24.343Z`. Receipt SHA256: `ddce19102f16019829288cf019869d0b5d171a84f2e171a132bdf6bddeead1b1`.

The actual signed-out Web SDK check passed at `2026-10-24T05:17:33.702Z`:

- All **863 imported targets** were found in the app's bounded latest-ten feeds across **844 places**. All **875 returned documents**, including 12 pre-existing notes, passed actual client decoding; no older-target fallback GET was needed.
- All 863 imported notes retain Anonymous attribution, unverified status and a null visit-observation field. **Five have a known publication date; 858 do not.** Known Parks inspection dates remain explicitly labeled in their text and facts despite the unknown publication date.
- The bounded access feed decoded **18 records**, including **17 exact new sidecar matches** and the existing Peninsula report.
- **Three of three** representative private batch/manifest/entry reads were denied. No private research bodies were read.
- The validator performed **zero production writes**, loaded no Auth SDK and created no accounts. SDK receipt SHA256: `991ab74d584ef91ddd847b8857f27c8cb89a211d8379d266423771d5f0278842`.

A fresh read-only importer preview proposed **zero writes**, confirming replay does not duplicate or overwrite records. Replay receipt SHA256: `85abe78b44ab73deadc3883c0ae709f6f5045048633c631243a096ecb6059400`.

The active website release is `20261024T052246Z-378edaa8fc9f`. Its deployed bundle SHA256, `bacceebc39d1400f040b8f662124990227a4c7539e3832555a5364e52e68b6c8`, matches the local build; health is `ok` and the service is active.

Signed-out, read-only browser checks confirmed Whitney's scoped route evidence, St Nicholas's actual July 27 Parks inspection date, a Reddit comment's May 13, 2026 publication date, an undated FACILITY code claim retaining its leading zero, Canarsie's closure warning and Peninsula's existing contributor report. Source evidence did not replace original code verification or the Peninsula report.

An initial 320-pixel check found five pixels of horizontal overflow from long source-note date text. A scoped wrapping fix was independently reviewed, rebuilt and released. Final document/panel widths are **320/320**, **390/390**, and **1280/399**, with panel scroll widths matching their client widths. No console errors were observed. Independent screenshot inspection also confirmed readable mobile source limits, separate retrieval/import dates, the leading-zero code and the closure warning.

The aggregate [verification record](map-research-20261024-checks.json) matches the operational receipts and contains no credentials or private research bodies. Its SHA256 is `ba6e70ba9a09262be1a42d5ca16e93ccf3089363765835e1babac56a28bfadb7`. Representative screenshots: [390-pixel source code note](screenshots/research-source-code-mobile-390.jpg) and [320-pixel Canarsie closure note](screenshots/research-canarsie-source-320.jpg).

The evidence, capture manifests, explicit source exclusions, per-place coverage and final [manifest](../../data/research-map-2026-10-24/manifest.json) are under [data/research-map-2026-10-24](../../data/research-map-2026-10-24/README.md). Operational receipts and backups stay in the ignored local operator directory; only their hashes and aggregate results are recorded here.
