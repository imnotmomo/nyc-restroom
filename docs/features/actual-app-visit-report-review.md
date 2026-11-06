# Actual app visit-report independent review

Date: October 21, 2026

## Verdict

No blocking source or security finding in the reviewed public visit-report implementation. The implementation supports the real `/find/` workflow. The original sample `/demo/` remains separate. Coordinator production-build, browser and release evidence should be read alongside this review.

The security-rule audit used the Firebase security-rules-auditor skill. Assessment: **5/5**, with no actionable finding in this slice. This covers schema, identity, ownership, immutable updates, paired writes and bounded reads; it does not validate the truth of visitor observations.

## Source and ownership checks

- Public reports have exactly eleven fields: place ID, observation/submission timestamps and eight bounded structured facts. They accept no account identity, free text, code value or coordinates. At least one observed fact is required.
- The observation timestamp is bounded from 2000 through server request time. Submission timestamps are server timestamps, rather than substituted observation dates.
- Public report and private UID-scoped receipt creation are atomic. Both must be absent before creation; place and submission time must match. A user cannot attach a receipt to an existing report.
- Updates are denied. Owner deletion requires an existing matching private receipt and both documents absent after the atomic operation. Receipt lists and other-account receipt reads are denied.
- Public selected-place queries are limited to ten. The SDK orders by observation time. Ownership controls use at most ten private point reads for the displayed public IDs.
- UI inputs start with an empty observation time and Not reported answers. Public visibility is disclosed beside the form. Device-local input and New York display times are labeled.
- UI state and callbacks are scoped to account and place. Unconfirmed saves retain the exact draft and stable request ID; confirmed writes are not re-created. The original source, private notes, star ratings and passcodes remain separate.
- The privacy page describes the new public fields, private ownership receipt and owner removal.

## Independently executed actual SDK checks

The harness imports the unchanged `getFirebaseClient`, actual Auth/Firestore SDKs and actual visit-report modules. It signs in through the local Google-provider Auth emulator. No compat-app substitution, production test account or production test report was used.

Project: `demo-restroom-visit-independent`; Auth: `127.0.0.1:9099`; Firestore: `127.0.0.1:8088`. All thirteen scenarios passed:

1. Actual client allows signed-out public feed and rejects signed-out create.
2. Actual Google-provider SDK creates public structured facts and paired private receipt.
3. Stable request retries recover same report and reject changed draft without duplication.
4. Ownership API bounds private point reads and excludes another place.
5. Second account cannot read owner receipt, claim report, or delete first account report.
6. Signed-out actual listener reads latest observations with unknowns; receipt lists and oversized feeds denied.
7. Anonymous Auth accounts cannot create or delete public observations.
8. Actual SDK rejects invalid/future times, identity/code fields and empty observations.
9. Concurrent identical retries converge on one actual report.
10. Concurrent changed drafts do not silently overwrite the first confirmed observation.
11. Orphaned administrative report cannot be adopted or deleted through actual SDK.
12. Owner paired deletion and retry preserve another account report.
13. Account sign-out blocks stale-owner deletion while public browsing remains available.

The isolated Firestore namespace was cleared after the run. The test harness and machine-readable result are under `/private/tmp/restroom-actual-visit-independent.mjs` and `/private/tmp/restroom-actual-visit-independent-result.json`. **Production writes from this audit: 0.**

The backend implementer separately reports 50 passing visit-report rule cases. Those are supporting evidence, not cases independently executed by this reviewer. Browser account flows and the final release are coordinator checks; this independent SDK test does not establish physical Google OAuth completion, real-device input/GPS behavior or classroom projector readiness.

## Confirmed venue import boundary

The separate Capital One Café — SoHo manifest was reviewed before application. The reviewed manifest SHA-256 is `bf6c70f8477f49b4eb9c00ad1e023e1ffd5ec47719712559d643febd952c7403`. It contains a genuine user-reported venue, source-backed address and an address geocode. Observation time, restroom access rules, code requirement, route and supplies remain unknown. It contains no raw code, cleanliness rating or public visit report. Its four-document target snapshot is bound to that manifest; all targets were absent, and the apply script uses atomic create-only preconditions. Production application/readback/replay belong to the coordinator.

## Reviewed source fingerprints

```text
73c537ac64bd4fc8eb045e1ab86cabb19b23f182e19c043d2356d5602d99983f  firebase/firestore.rules
e1953cf13e82b0accc10516d0a7d3c0a52ea3e5468ed0af4373ff922f401d685  lib/visit-report-model.ts
fc2d345546148962fe78524eddd2620343881998a86dec5ad643fdb3321fb314  lib/visit-reports.ts
cc3f9c76caac4107419711e2540bb635ae7c1639292c11b08391ca0ea569e224  components/finder/visit-reports.tsx
5b7644021cd3af0f311db869f15cb2f5f90e9bb1fcb9332948f19fa49117a967  components/finder/detail.tsx
19d60d51f2a80de7a751f242654b50224c39e21d90dc6ee514eb9e0cbf08ebc1  components/finder/explorer.tsx
d9ce13eaf911d7a839d5bdf92ea71d5de7a7ee215d8646c2eacdcc463e54196e  app/privacy/page.tsx
```

## Independent final production check

After publication, this reviewer ran a fresh anonymous Chrome check of the actual Capital One Café — SoHo finder page at 390px and 320px. All 21 checks passed: correct address and destination coordinates, empty genuine public observations with sign-in guard, original source clearly separate, unknown observation date and code requirement, no public code or invented rating, no horizontal overflow, and no browser page errors or failed HTTP responses. The original sample demo was also confirmed restored to its single Target seed. Evidence: [actual-app-live-checks.json](actual-app-live-checks.json); [390px live screenshot](screenshots/actual-app-live-capital-one-390.png). No account sign-in or production contribution was performed.

The initial live check caught an older finder bundle after a separate publication replaced the intended release. The coordinator republished the verified build. The successful final pass independently confirmed current finder asset `42kq5nxwjbl8w.js` contains the actual visit-report UI and returns HTTP 200, with release `20261021T213129Z-032f089b084d` reported by the coordinator.
