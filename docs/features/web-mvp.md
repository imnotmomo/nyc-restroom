# Feature: NYC finder and Firebase web accounts

Status: published to the existing private Site

## Brief

Build the usable first slice of Restroom Ready in the existing Next.js web app: browse city-listed locations, inspect dated information and unknowns, get walking directions, and keep account-owned saved places and visit notes.

The team selected the existing Firebase project `nye-restroom`, Google Sign-in, and Firestore, and specified registering a **web** app. The app registered for this work is `Restroom Ready Web`, ID `1:547771536579:web:f651ddda4a81b2e9297e76`. The project has one existing Standard Firestore database, `(default)`, in `nam5`. No new database was created.

Scope: 55 real NYC Open Data places around Columbia, Harlem, and northern Central Park. Their source dataset was updated June 27, 2025. Retrieval is not an inspection. Public browsing uses a bundled official snapshot; personal favorites and visit notes use Firestore. Notes are private and do not become public visitor reports. Existing waitlist storage remains separate.

Acceptance:

- Browse, search, filter, select map pins/list records, and open walking directions without an account.
- Keep Entry, Route inside, and Conditions separate, with unknown facts labeled Not reported.
- Ask for location only on an explicit action; browsing still works if permission is denied.
- Use the actual registered Firebase web configuration, restore Google auth state, and show actionable sign-in errors.
- Allow only a record's account owner to read/write saved places and private notes. Validate fields and timestamp semantics in rules.
- Acknowledge a save only after the server confirms it. Preserve the form on a failed save. Never show another account's private data after account changes.
- Preserve static export, marketing routes, and the waitlist.

## Plan and review

The independent planner inspected the current Next.js/Sites architecture, brand/style guidance, and the 55 source records. It recommended one static `/find/` route and a client-only map, avoiding dynamic route/server assumptions. It identified the production geolocation policy blocking location; this was changed to `geolocation=(self)`.

Ownership: frontend implementation owns `components/finder/`, `app/find/`, and listing helpers; the Firebase service implementation owns lazy web initialization/auth and account-data operations; integration owns cloud registration/provider setup, rules, dependencies, hosting compatibility, documentation, and browser verification. The independent reviewer audits rules and tests isolation.

The Maya, Chloe, and Alex persona agents independently approved the October 15 MVP with no blocking copy/UX findings (scores 7, 8, and 7). Chloe’s suggestion to start observation time blank was implemented; other suggestions about richer conditions and route evidence are follow-up work requiring actual data. The source review found no blocking rules flaw. A robustness finding about retired listing IDs was resolved: reads preserve old references while new writes require a current listing. A separate integration review found that a successful note write followed by a failed refresh could invite duplicate reposting; the UI distinguishes acknowledged saves from refresh failures.

## Verification

Firebase CLI 15.34.0 verified access to `nye-restroom`; the official Firebase MCP server created the web app, downloaded its SDK config, read existing rules and collections, and validated the new rules syntax. Existing rules denied all access; the database contained no top-level collections when inspected. Google provider deployment completed successfully. No unrelated providers were disabled.

TypeScript checking, the production static build, all five existing signup tests, and 85 Firestore emulator tests passed. The exact deployed rules were compiled by Firebase before release. Browser checks verified real listings and map pins, type/search/empty states, directions, source/unknown labels, denied location fallback, focus restoration, and layouts at 1440, 390, and 320 pixels. Google popup reached Google Accounts through the new app’s actual OAuth client and Firebase handler. No Google credentials or production account notes were entered by the automated browser test. Final evidence: `web-mvp-browser-checks.json`, `web-mvp-reviews.json`, and `screenshots/finder-*.png`. Final phone detail sheets use normal page flow, hide the list/map, and restore focus through Back to results. The existing marketing/privacy pages were checked for overflow at 391/600/719/1440 pixels after adding the finder link.

## Delivery

Web app registration and backend configuration are authorized. The Sites workflow saved source commit `76d38b776fa55dfd83ff36086a4a0ad61321685b` and successfully published it to the existing private Site at https://restroom-ready-nyc.clcii.chatgpt.site/find/. Deployment `appgdep_6ad16edb537881918194ca0b291a690e` returned `succeeded` on October 16, 2026 UTC (October 15 in New York). This post-deployment note is a local documentation update after that source snapshot. No GitHub push/PR or site audience change is included. An independent final integration review found no blockers. A real Google account sign-in/save/readback remains a human review check; automated tests did not enter Google credentials.

Lessons: keep the Firebase platform explicit, detect the database edition before choosing SDK patterns, and separate write acknowledgement from refresh success. The source snapshot remains historical; collecting actual entry/internal-route/condition observations is the next data-quality task.
