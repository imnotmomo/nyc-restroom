# Web finder MVP readiness

Status: Verified and live on the primary domain; optional Sites mirror update awaits approval
Date: October 21, 2026
Owner: Zheli Chen / project engineering

This record documents the October 21 web-finder release and its checks. As of October 22, the native iPhone app is the main October 23 presentation client; the web finder is the backup. See the [current MVP scope](../mvp_doc.md), [native TestFlight record](native-testflight.md) and [presentation runbook](../mvp-presentation-runbook.md) for current delivery and remaining device/rehearsal checks. The web validation below does not establish native-device behavior.

## Brief

Prepare the real application at `/find/` for the October 23 presentation. The user clarified that readiness means the production app, not a separate demo page. The original `/demo/` was restored to its pre-task implementation. No fictional venues or reports are added to the real finder.

The primary job is to decide which restroom to try before walking: inspect available entry, route, condition and source information, then open directions. A real visitor can contribute structured dated observations to an existing listing. The pilot audience remains a segment to test, not a citywide market claim.

## Scope and acceptance

- Real finder cards expose actual public location entry, code requirement, step-free reports and separate observation/submission dates. Unknowns remain unknown.
- No code matches only explicit `passcodeRequired: no` in original public location reports. Later visitor observations stay separate; this filter does not merge or vote on them.
- Validated `?place=` links resolve exact public city/community IDs, wait for the community feed and recover safely without GPS or private URL data.
- Existing places expose bounded latest-10 public visit reports. Google accounts can publish only structured entry/purchase/code-requirement, floor/stairs, supplies and condition answers, with an actual observation time. All facts start Not reported and at least one known observation is required.
- Public reports contain no identities, notes, actual codes or coordinates. UID-scoped private receipts protect ownership. Public create/delete and private receipt create/delete are atomic; updates and ownership adoption are denied.
- Reports remain independent of original directory/source details, private notes and star averages. Owner removal needs confirmation. Failed requests preserve an exact draft and stable ID; account/place changes clear stale state and callbacks.
- Preserve current user changes, account privacy, ratings, venue-code ownership, waitlist/email behavior and established B checklist styling.
- No fabricated production users, ratings, locations, visits or code checks. A genuinely user-confirmed venue can be added with unknown dates/details, create-only writes, source provenance and no private code disclosure.

## Plan review

The backend author read the Firestore Standard SDK and rules guidance. Live metadata confirmed `nye-restroom/(default)`, STANDARD edition, nam5. An independent security reviewer approved the plan with explicit before/after paired-document and ownership safeguards. UI, SDK/model/rules and independent review were separately owned.

The user supplied Capital One Café in SoHo as a genuine venue. Its branch identity and address were checked separately. Visit time and code visibility remain pending; no date, public code or star score is inferred from that report.

## Verification

- **151 Node regression tests passed**, without failures or skips, including concurrent source-registry validation, finder filters/links and the new observation model.
- **400 full Firebase rules/SDK cases passed**, followed by an additional passing deletion-recovery regression. Existing private-data, rating, community and passcode cases remain covered.
- An independent reviewer passed **13 actual Auth/Firestore SDK scenarios**, using the real initializer and Google-provider Auth emulator in isolated demo namespaces. This includes stable/concurrent retries, forged ownership denial, public reading, private receipts, deletion and sign-out guards. No production data was written by tests.
- TypeScript, the current production export/Worker build and Firestore dry-run compilation passed. The build packages 96 assets and contains no temporary QA routes, emulator project IDs or test accounts. New visit-report rules were deployed successfully after backing up the previously active rules.
- **16 actual-finder browser checks passed** using only isolated Auth/Firestore emulators, with zero production Firebase requests or uncaught page errors. Checks covered public reading, blank-date/all-unknown validation, layouts at 1440/390/320px, offline failure/frozen draft/retry without duplicates, Alice/Bob account switching, signout, owner deletion and preservation of another visitor's report. See [actual UI evidence](actual-app-visit-browser-checks.json). Temporary QA accounts/data were removed and the isolated browser/server stopped.
- Browser QA caught a concurrent source-registry validator rejecting tildes in real NYC IDs, causing the actual finder to return 500. The validator now accepts preserved IDs, the actual-registry regression passes, and the production build succeeds. The concurrent source research remains separate from visitor observations.
- Earlier **24 real-finder browser checks** passed at 320/390px for search, map, directions, direct city/community links, invalid-link recovery and honest no-code cards. That check found 29 explicit no-code location reports. These checks predate the new visit-report UI and do not replace its browser checks.
- **21 final production browser checks passed** on the primary domain, with zero uncaught page errors or failed HTTP responses. The genuine SoHo Capital One listing, public report empty state/sign-in guard, original source separation, no invented condition/date/code, walking destination, mobile layouts and restored original single-seed sample were verified. See [live evidence](actual-app-live-checks.json) and [the actual mobile screenshot](screenshots/actual-app-live-capital-one-390.png). No sign-in or production write was performed in that check.

## Remaining physical and research work

A real Google OAuth login on the presenting browser, phone GPS permissions, the classroom projector and a genuine target-user test remain team tasks. The presentation runbook lists the precise preparation and timing. The new feature can collect real observations; empty public reports are never filled with examples to make the app appear active.

## Delivery

The genuine Capital One Café — SoHo listing was created with four atomic create-only documents after independent manifest/snapshot review. Its address was verified using the official Capital One SoHo page, the SoHo Broadway announcement and NYC GeoSearch. The point is a venue-address point, not a restroom-door survey. Observation, entry, code requirement and route remain unknown; no raw code, public rating or undated public visit report was published. Anonymous readback succeeded, private source/receipt reads were denied, and replay planned zero writes. See [readback evidence](capital-one-venue-readback.json). The manifest, before-snapshot and previous rules backup are private outside the repository.

The checked primary frontend is live at `https://nyc.imfinethanku.me/find/`, release `20261021T213129Z-032f089b084d`. An overlapping publication from another chat replaced the first release with an older finder bundle; the live check caught this and the combined checked build was restored. The active service and on-server Worker SHA-256 match the local checked build: `dfd94077ea194316b24032977698f8803eac84811cfcbd8dafb11b240cc1d1c2`.

Automatic approval review rejected the existing Sites mirror source publication because its complete source snapshot could include internal project documentation/research and the exact destination/payload was not explicitly authorized. No workaround or mirror write was attempted after rejection. The main app is live and does not depend on the mirror. The built mirror archive is prepared locally at `/Users/cc/Desktop/4995/tmp/actual-app-ready-site.tar.gz`; inspection found only the compiled Worker, hosting configuration and D1 migrations, plus macOS archive metadata. The source push and mirror publication remain pending user approval. A separate chat's existing mirror version 23 was preserved.

The checked Firestore rules are additive to the existing schemas. Only `firestore:rules` was deployed; existing records and runtime secrets were preserved. Both hosts retain their existing public access. No commit or push to the user's GitHub repository was made. All temporary QA servers, synthetic Auth/Firestore fixtures and root-owned emulators were stopped or cleared.
