# Unified Accessible status

Date: October 22, 2026
Status: Unified web change live and verified; no native distribution requested

The Peninsula community listing was marked `stepFreeAccess: yes`, but the released web and iPhone filters accepted only the city directory's exact `Fully Accessible` label. The reported elevator route and zero stairs did not participate in that predicate. An upper floor alone does not exclude a step-free route.

The user requested one shared Accessible status and no iPhone update. The web filter, card and detail view should consume the same derived accessibility result, with a shared Accessible label. Original positive city records and explicit positive community route reports map to that status. Unknown, partial, negative, malformed and notes-only claims must not become positive accessibility claims. Source details and route facts remain available without separate city accessibility terminology in the main interface. This does not certify stall features, entry permission, or current availability.

The user's Peninsula route correction is saved in the existing public notes field: 23rd floor, elevator destination Penthouse, and 0 stairs after entry. Its step-free flag remains yes. The observation date and entry permission remain unknown. Original city accessibility, floor and stair fields are not fabricated. The strict community schema is unchanged so existing installed clients continue to read the listing.

## Verification and release scope

- Web and Swift boundary tests cover a positive community report, unknown/negative/malformed values, and preservation of the city-label behavior. Each filter suite passes 10 tests.
- Main type checking passes. The main full test run's four socket-permission failures pass in the affected 8-test rerun with loopback access.
- An independent review found no blocking issues in the filter change.
- The web release is prepared from the exact active server source commit `8df71d7159be1a6ebab256b7de2d019de5cc6002`, with only the unified accessibility change included. The earlier two-file filter artifact is superseded and must not be deployed. This avoids publishing unrelated working-directory edits.
- Mac Studio native source previously received only the filter model and test updates. Ten Swift tests pass and unsigned archive 1.0 (4) succeeds with the expected bundle and 29 valid SDK privacy manifests. Ordinary SSH signing still fails with `errSecInternalComponent`. The user declined a new upload. No desktop job was launched, and the prepared templates remain inert.
- Archived native build 3 hard-codes the old city-only predicate, rejects additional community fields and bundles the city data. There is no valid data-only override for its filter. Slide 5 therefore uses All/search for the existing iPhone demo, with the corrected 23rd-floor/Penthouse/0-stairs route notes.

## Shipped result

The website now uses `lib/accessibility.ts` as the shared resolver for filtering, result cards and detail rows. The same **Accessible: Reported accessible** value appears for positive city and community reports; other values show **Not confirmed**. The original city value is available only inside collapsed source details. A community report, including an unknown or negative value, does not fall back to a city value.

Release `20261023T030834Z-8df71d7159be-unified-accessible` is active on the existing VPS. Its source delta is exactly six files: the shared resolver and tests, filter and tests, and the two finder views. Archive SHA-256: `058a078cfdeea71d6c54ed5ebcaa6baeccfb20f4df4f35ab7f7937f684e88490`. Runtime SHA-256: `5157e662ea9ac1d64a23add7cb7c44bb35e84f25dc8b14b6f6984002839ceee3`. Existing service, proxy configuration, secrets and application data were retained. The prior release remains available for rollback.

The isolated release passes 163 tests, type checking and its production build; the main checkout passes type checking and 32 focused tests. Independent source and package reviews found no blockers. A fresh signed-out browser check against the live site confirmed Peninsula and Herald Square remain under Accessible and share the same card/detail value. An unconfirmed city record stays excluded and shows Not confirmed. Peninsula's corrected notes and unknown observation date are visible. There were no browser errors or attempted production writes during the check.

Slide 5 now uses direct Peninsula search for the existing iPhone demo and shows the 23rd-floor/Penthouse/0-stairs route. No native signing job, export or upload was performed after the user declined the update. No Git commit, push, or tester-membership change is included.
