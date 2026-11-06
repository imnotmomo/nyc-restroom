# Database compatibility audit — October 24, 2026 UTC

The live `nye-restroom/(default)` data needs no migration or cleanup within the audited scope. The audit found no malformed current-schema records, mismatched ownership pairs, rating-total discrepancies, or exact normalized duplicate community identities. Existing legacy collections remain necessary for installed clients and source provenance.

## Method and scope

The read-only Admin SDK audit ran on the existing VPS using its approved credential in place. It used one read-only Firestore transaction at **2026-10-24 03:43:33.122 UTC**. All 21 queries reported that exact same read time. Each query was bounded to 2,000 documents, with an 18,000-document total ceiling; every scope completed below its bound. Collection-group queries found private subcollections independently of whether a parent `users` document exists.

The snapshot read **1,563 documents**: **1,486 current app-schema records** were validated, while 77 records in other imported-research namespaces encountered by collection-group queries were counted but not schema-audited. Document bodies, code strings, account identifiers and credentials stayed in remote memory. The sanitized [aggregate evidence](database-compatibility-audit-20261024.json) records per-query counts, completeness, source-contract hashes and one whole-snapshot fingerprint. Production writes: **0**.

A separate current metadata read verified **Standard edition, `nam5`**, the V2 own-code composite index **READY**, and zero field overrides. Source and backend checks are bound to the deployed rules and policy-3 cleanup hashes in the evidence.

## Results

| Data | Verified count and outcome |
| --- | --- |
| Listings and summary coverage | 1,064 bundled city IDs plus 103 community listings; all 1,167 have a valid rating summary. No missing or extra summary IDs. |
| Ratings | 4 live votes, 0 anonymous votes, 3 nonzero summaries. Recomputed sums/counts include both collections and match every aggregate. |
| Saved places | 3 valid saved records; every ID still resolves to the current city snapshot or community listing. |
| Legacy public codes | 42 valid projections and 42 designated importer reservations: 39 photo-import and 3 source-import. Exact projection, version timestamp and deterministic report identity match. |
| Community ownership | All 103 submission receipts match their listing and submission timestamp. No exact normalized name/address duplicate group. |
| Source comments | 21 public comments pass the actual current public decoder and refer to known places. Private research copies remain separate. |
| Entrance details | 1 valid optional access sidecar, with restroom hours. No unsupported fields were filled from venue hours or inferred from other accessibility facts. |
| Notes and visits | 0 legacy private notes, 0 new public notes or receipts, 0 structured visitor reports or receipts. No private-note migration is needed for this snapshot. |
| V2 codes and feedback | 0 V2 own records, reservations, public projections, feedback summaries or private votes. The required index is ready; this audit creates no contribution to test the live write path. |
| Deletion state | 0 deletion locks. No account deletion was attempted. |

## Compatibility decision

The 42 importer reservations intentionally have no synthetic user-owned code document. The importer creates a reserved system ownership record alongside each public projection; treating these as orphans would break import ownership and could expose codes to unauthorized edits. They are preserved. Legacy code/check and private-note schemas also stay available for older installed clients, even when the current UI uses additive public notes and immutable V2 code reports.

There is no evidence-backed repair to apply, so no migration, private backup/export, forced schema rewrite or deletion is prepared. Future real inconsistencies should be repaired only after a fresh consistent read, an exact private backup and a manifest-bound zero-write replay. Unknown entrance, restroom-hours and source-observation facts stay unknown.

This is a schema, reference and aggregate audit of the declared scopes. It does not establish Firebase Auth-user existence, semantic truth or current venue conditions, the integrity of unqueried/private source archives, or a successful production contribution/account-deletion flow. Counts are a dated snapshot and can change with real use.
