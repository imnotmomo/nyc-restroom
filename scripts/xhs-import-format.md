# Native Xiaohongshu import

`import-xhs-restrooms.mjs` is an administrator tool. Its default is a read-only dry run. It creates no Auth accounts, ratings, actual-visit reports, user notes or successful code checks. It writes no existing document. Native authors and original transcripts are private provenance.

The exact manifest fields are:

```js
{
  schemaVersion: 1,
  project: 'nye-restroom', database: '(default)',
  batchID: 'xhs-2026-10-21-v1', cutoff: '2026-10-21',
  eligibilityPolicy: 'confirmed-2026-only',
  sources: [], venues: [], codes: [], reports: [], comments: []
}
```

`eligibilityPolicy` is either `confirmed-2026-only` or an explicitly authorized `all-source-dates`. Both values are bound to the manifest, target digest, private archive and independent review. Unknown-year and historical sources can always be retained privately. The first policy rejects public targets based on those sources; the second permits them with the required caveats.

Each source has these exact fields:

```js
{
  id, nativeID: null, kind: 'post', parentSourceID: null,
  title, author: null, url: null,
  displayedDate, publishedOn: null, dateStatus: 'unknown-year',
  dateEvidence, capturedAt: '2026-10-21T12:00:00.000Z',
  captures: [{ file: 'capture.png', sha256 }], transcript, limitations
}
```

`kind` is `post` or `comment`; a comment references its captured parent post. `dateStatus` is `explicit-year`, `resolved-relative`, `unknown-year` or `unknown`. The first two require a real ISO date in `publishedOn`; the latter two require null. A relative date needs the visible text, capture time/timezone and resolution explanation in `dateEvidence`. Never assign the parent's date to a comment. Nullable URLs accommodate sources available only in the native app. Non-null URLs must be public HTTPS links without credentials or security tokens; use null when a clean link is unavailable. Screenshot paths are relative to `--evidence-root`; every file hash and resolved path is checked before authentication. Original Chinese titles/authors/transcripts may remain private.

Each new venue is `{id, canonicalIdentity, payload, sourceIDs, identityEvidence, restroomEvidence}`. `payload` is the exact normalized current community input, including `passcodeRequired`; `observedOn` must be null and `stepFreeAccess` unknown. Keep English, code-free notes containing `Not independently verified`. If any supporting source has no resolved year, notes must also contain `Source year not established`. `canonicalIdentity` is the canonical English name and address joined with `|`; its ID is `community-` plus the first 20 hexadecimal SHA-256 characters. Exact existing city/community identities must reuse their existing ID. A matching nearby building or chain name alone is insufficient.

Each code is:

```js
{ placeID, reportID, code, sourceIDs, doorType: 'restroom',
  restroomLabel, scopeEvidence, limitations }
```

`reportID = id20(placeID + '|' + code)`. Preserve exact normalized strings, leading zeroes and symbols. `scopeEvidence` must establish the branch and restroom door, excluding staff/security entrances. `limitations` must carry the same verification/year caveats as venue notes. The importer scans every existing public variant, preserves matching code versions and checks, and rejects malformed/missing ownership reservations. New reports use server `codeUpdatedAt` and null `lastVerifiedAt`; publication dates never become code versions. Additional variants cannot push a place beyond the public latest-ten window without a separate visibility change.

Each route/source report is the exact current source-report shape:

```js
{ id, placeID, sourceID, venueLabel, reportedOn, observedOn: null,
  facts: [{ field, value }], limitations }
```

`reportedOn` equals that precise source's `publishedOn`, including null in explicitly authorized all-date imports. `id = id20(sourceID + '|' + placeID + '|' + stable(facts))`, where `stable` sorts object keys recursively. Facts and public labels are code-free English. A source's publication or comment date is never an observation date. These source reports are archived privately; the existing source-report UI requires a separate reviewed registry publication to display them.

Each useful public source note is:

```js
{ id, placeID, sourceID, sourceKind: 'comment', text, displayName: 'Anonymous user',
  publishedOn, observedOn: null, verified: false,
  limitations, scopeEvidence, sourceTitle, sourceURL: null }
```

`sourceKind` is `post` or `comment` and must equal the original source's `kind`. Body facts are rendered as an imported post; they are never described as a comment. `id = id20(sourceID + '|' + placeID + '|' + text)`. `text` is an English paraphrase of the useful original source, at most 1,000 characters. Preserve the original privately, omit personal identity and raw codes from public text, and retain uncertainty. `sourceTitle` is a separately sanitized English title; `sourceURL` is null or the source's clean URL. The original displayed date must also be code-free English/date notation for public projection; otherwise retain the source privately until its public date presentation is resolved.

Source notes create immutable `restroomSourceComments/{placeID}/comments/{id}` records. Their public fields are exactly `placeID`, `sourceID`, `sourceKind`, `text`, `displayName`, `publishedOn`, `displayedDate`, `dateStatus`, `sourceURL`, `sourceTitle`, `capturedAt`, `observedOn`, `verified`, `limitations`, and server `submittedAt`. Public `sourceID` is an opaque `id20(privateSourceID)` because extraction IDs may contain an author's handle. Source/capture/import dates remain separate. A public display name does not create or impersonate an Auth account. This new collection needs separately reviewed bounded public-read rules and a UI integration before publication; this tool does not alter either.

The private immutable archive is `restroomResearch/{batchID}` with `sources`, `venues`, `codes`, `reports`, and `comments` subcollections. Unresolved sources stay in `sources` even when no public target is accepted. Never deploy a broad public read rule for this archive.

Dry-run invocation:

```sh
XDG_CONFIG_HOME=/path/to/private/firebase/config node scripts/import-xhs-restrooms.mjs \
  --manifest /absolute/staging/manifest.json \
  --evidence-root /absolute/staging \
  --snapshot /absolute/staging/snapshot-dry.json \
  --report /absolute/staging/report-dry.json \
  --firebase-tools-dir /absolute/path/to/firebase-tools
```

The snapshot and report are exclusive mode-600 files; use fresh filenames for every run. The target digest binds current complete community inventory, targeted code feeds, existing target/metadata documents, bundled city inventory and proposed creates. A later code check, new listing or target change invalidates the old review. Apply additionally requires `--apply --expected-sha MANIFEST_SHA --expected-target-sha TARGET_SHA --review /absolute/staging/review.json` with an independent review file:

```js
{ reviewer, reviewedAt, verdict: 'approved', manifestHash,
  captureDigest, targetDigest, eligibilityPolicy }
```

Review expires after 24 hours. Review the actual screenshots, English interpretation, branch/door matches, date eligibility, public comment anonymity, code-feed visibility and exact planned targets. A digest establishes byte/state identity; it cannot itself establish semantic accuracy or reviewer independence. Reads are fresh when apply begins, and every write has an absent-document precondition. A concurrent human contribution after that read can still create a semantic duplicate; reconcile such reports rather than overwriting them.

After apply, the importer replans from server records and requires zero proposed writes. It preserves genuine later ratings and code checks. If a commit response is uncertain, the private journal records pending paths as `commit-outcome-unknown`; rerun read-only reconciliation before attempting another apply. Anonymous SDK readback/security checks and UI display checks remain necessary release evidence.

Focused offline checks: `node --test tests/xhs-import.test.mjs`. Tests use mock storage and synthetic local captures; they never write production data.
