# Restroom Ready — Web app

This `webapp` branch contains the Next.js website, web moderator dashboard and compatible shared backend source. The native iPhone application is maintained on [`main`](https://github.com/imnotmomo/nyc-restroom/tree/main); see [branch ownership](docs/branches.md).

Restroom Ready helps people choose a restroom in an unfamiliar NYC neighborhood before walking over. The MVP includes a **native iPhone app built with SwiftUI and MapKit**, a public web finder, and marketing pages with an email waitlist. Both app clients use the existing Firebase Authentication and Firestore project, `nye-restroom`.

As of **November 5, 2026**, native version **1.0 (18)** is **Testing** in **Team and 4995**, following the explicit class-release request. Build 18 adds private restroom requests and owner status history, with approval managed in the restricted web dashboard. Future internal builds default to Team unless specified. Public Beta **1.0 (19)** uses the same app source and is **Testing** through the existing [public TestFlight link](https://testflight.apple.com/join/PxWSpdJ8). See [the distribution record](docs/features/native-testflight.md) and [the public web finder](https://nyc.imfinethanku.me/find/).

The directory contains 1,064 city-listed locations from a dated official snapshot, alongside community listings and separate source/visitor reports. It does not establish current availability or complete NYC coverage. Anonymous visitors can browse; Google Sign-in is required for account-owned saves and contributions. New visit notes are public and Anonymous by default. Public ratings, dated entry/route observations and private or shared venue passcodes remain separate.

The public website also includes a homepage, three benefit pages, and a durable email waitlist with Cloudflare confirmation emails. `/demo/` is a separate one-place sample with simulated interactions and no Firebase writes; its changes reset on reload.

## Native iOS app

The SwiftUI and MapKit code, Xcode project and native build instructions are on the [`main` branch](https://github.com/imnotmomo/nyc-restroom/tree/main). This branch preserves the web finder and browser account workflows against the same Firebase project. Source changes here do not upload or replace an iPhone build.

## October 23 demo

The main workflow is **search a prepared venue or neighborhood → select a real restroom → inspect entry, route, conditions and dated evidence → open walking directions**. The [presentation runbook](docs/mvp-presentation-runbook.md) covers the required research story, all-member speaking allocation, 7.5-minute presentation and 7.5-minute Q&A, rehearsal and backup preparation. Signed-in actions are optional additions after testing them on the exact presenting device/account.

## Run the web app locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The local server saves signup records in ignored `.data/waitlist.sqlite`. Use test addresses during development.

```sh
npm run typecheck
npm test
npm run build
npm start
```

The production preview runs the built pages and the same signup validation using local SQLite. Hosted Sites uses D1, with the schema applied from `drizzle/0000_waitlist.sql`. `/api/waitlist` is owned by the hosting Worker or local Node server, rather than a statically exported Next.js API route.

## Pages

- `/` — the main promise and example listing
- `/conditions/` — supplies and condition reports
- `/entry-route/` — permission, floors, stairs, and the route inside
- `/dated-reports/` — sources, observation dates, and uncertainty
- `/thank-you/` — signup confirmation
- `/privacy/` — stored information and contact/removal options
- `/demo/` — one Target Herald Square example, simulated ratings/saves/filters/new locations/code checks, no Google account; public 3434 and owned private 3535 are separate reports with owner-only editing
- `/access/` — legacy bookmark that redirects to `/find/`
- `/find/` — public real city listings, map/search, source details, walking directions, Google accounts, login-only restroom requests, dated private/shared passcodes, saved places, and public visitor notes
- `/admin/` — restricted moderator review of pending/approved/denied restroom requests and visitor comments

## Web finder access

The **No code** filter includes only locations explicitly reported as not requiring a code. Missing codes and city provenance never imply free or unrestricted entry. A validated `?place=<public-listing-ID>` link can open an existing city or loaded community listing without geolocation; it never provides a starting location.

The finder is open without a shared passcode or account. Firebase Google Sign-in is still required to save places, publish or remove owned public notes, rate a restroom, log a location, and contribute or verify venue passcodes. Firestore rules continue to protect private records and owner-only changes. Old `/access/` links redirect to `/find/`; the retired `/api/finder-access` endpoint returns 410 and expires the old access cookie. No finder-access secrets are needed in local, Sites, or VPS configuration. Venue restroom passcodes remain a separate feature and retain their private/public visibility controls.

## Moderation

Open [the moderator dashboard](https://nyc.imfinethanku.me/admin/) and sign in with an approved Google account. Pending contains private new-restroom requests. Select one, then approve it to publish the venue or deny it with a reason. Approved and Denied retain the original submission date and review date. Comments contains public visitor text; removal requires a reason and confirmation. When a report also contains structured observations, those facts remain after its comment is removed.

New web and iPhone clients submit only private requests. In the iPhone app, Account → Restroom requests shows Awaiting approval, Approved or Not approved. Optional codes and private-code auto-saving take effect only after approval. Existing public listings stay available. Older native builds must update to submit a new restroom after the rules cutover. Moderator decisions do not verify venue information.

The static page holds no privileged dataset or credentials. A separate VPS service verifies Firebase identity and its server-controlled moderator roster on every request. The moderator workspace is excluded from product Analytics. See [the contract and verification](docs/features/moderator-dashboard.md) and [deployment guide](deploy/moderation/README.md).

## Shared Firebase backend

Firebase project: `nye-restroom`. The web and native iOS clients have separate registered app configurations and share the existing Authentication users and Firestore schema. The web registration is **Restroom Ready Web**, `1:547771536579:web:f651ddda4a81b2e9297e76`; its public SDK identifiers are in `firebase/web-config.json`, with environment overrides available. The matching iOS `GoogleService-Info.plist` stays local and is ignored by Git; [iOS setup](https://github.com/imnotmomo/nyc-restroom/blob/main/ios/README.md) explains how to download it. Client SDK identifiers do not grant administrative access. See [Firebase setup](docs/firebase-setup.md) for provider configuration, rules and verification.

The existing Standard `(default)` database in `nam5` stores private saved places and ownership receipts, public Anonymous notes and rating summaries, and visitor-submitted locations. Signed-in users can request a missing restroom; everyone can browse its details after moderator approval. Only the 1,000 most recent visitor submissions load alongside the city snapshot. In the web form, address search and Use my location offer NYC GeoSearch address suggestions; the native form uses MapKit candidates. Selecting a result fills its address and pin together, with manual corrections available. Names, addresses, chosen coordinates, optional notes and report dates become public after approval; pending requests and account identities remain private. Community entry/route reports do not imply a city accessibility label. See [Log a restroom](docs/features/log-restroom.md) for the schema and verification. Passcodes default to Only me and automatically save the place; owners can later choose Everyone. The web and updated iPhone clients create immutable code reports, preserving earlier reports. Public reports prioritize the latest successful-use verification, falling back to report time, and support exclusive Used/Invalid feedback. Only the owner can change visibility. Approval creates the compatible legacy initial-code records; older installed clients cannot directly publish new restrooms after the moderation rules cutover. See [Code reporting](docs/features/native-code-reporting.md) and [web compatibility](docs/features/web-code-compatibility.md). The source-backed directory is bundled in `data/nyc-restrooms/`, with a reproducible import script. It is historical source data, not a live availability feed.

## Public visit reports

For any existing listing, visitors can read up to ten recent structured observations. Signed-in non-anonymous accounts can share actual visit times and entry, route, supply and condition answers. Unknowns remain explicit. Public observations carry no account identity, code values, free-text notes or coordinates; private receipts authorize owner removal. Reports remain separate from original source data and star averages. Public comments and structured observations share Visitor notes inside the native Rate and Comment screen; free-text bodies never enter the on-device summary. See [the web finder readiness record](docs/features/mvp-demo-readiness.md).

## Analytics

Web Analytics uses sanitized manual pageviews; native Firebase Analytics records predefined screens and major actions, with first-time Apple/Google account signup events. Returning logins are not signups. Native simulator collection is disabled. Native usage and web visits remain separate stream contexts; see [the Analytics record](docs/features/account-signup-analytics.md).

Use the team's existing GA4 web stream. Its public measurement ID belongs in `analytics/web-config.json`; an optional `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-...` build-time setting overrides it. A blank override falls back to the tracked configuration. A missing or invalid ID makes no tracking requests. The connection status and actual-property verification are recorded in [the Analytics feature record](docs/features/google-analytics.md). Never put a Google password, OAuth token, or Measurement Protocol API secret in either setting.

Tracking runs only on HTTPS `nyc.imfinethanku.me` and `restroom-ready-nyc.clcii.chatgpt.site`, on the approved marketing, finder and demo routes. Legacy access routes and the retired access API are excluded. Local previews do not load the tag. Manual pageviews cover initial loads and Next.js navigation, using only approved page paths and bounded lowercase UTM labels. Referrers exclude query strings and fragments; external referrers retain only their origin.

Turn Enhanced Measurement off for the selected web stream to avoid duplicate history pageviews and automatic collection of search terms, form attempts, or outbound directions URLs containing coordinates. Keep user-provided-data collection off. The tag disables Google Signals and advertising personalization. Mark `generate_lead` as a key event in GA4. It is queued on the thank-you page only after a successful signup response and guarded against reload duplication in that session. It counts completed waitlist submissions, including an already-subscribed email that receives a success response; use distinct database records for unique leads. The event includes the source page and method, never the email, Firebase account ID, private notes, or map coordinates. Validate the actual stream in GA Realtime before claiming the account is connected. Local browser checks use intercepted collection requests with both a dummy consumer and Google’s real tag library; they do not establish real demand.

Never commit signup databases, export email addresses into this repository, or include email addresses in campaign URLs.

## Waitlist confirmation emails

New waitlist signups automatically queue a confirmation email sent through **Cloudflare Email Sending** from `welcome@nyc.imfinethanku.me`. The email confirms signup and includes a link to the public demo. Duplicate and historical signups do not send again.

The VPS dispatcher retries durable jobs and calls the original Sites deployment's authenticated dispatch endpoint every 30 seconds. Configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`, `WAITLIST_EMAIL_FROM`, and a shared random `WAITLIST_DISPATCH_SECRET` through runtime secrets. No mail is sent when these are absent. Rate limits reject excess signup requests before saving; subsequent delivery failures preserve accepted signup records. Ambiguous sends require operator review. See [confirmation behavior and checks](docs/features/waitlist-confirmations.md).

## Build and hosting

`next build` exports the pages to `out/`. `scripts/build-worker.mjs` embeds these assets into a self-contained Worker with `/api/waitlist`. This keeps the frontend in Next.js and makes the signup handler portable to Sites D1. Existing brand sources remain in `brand/logo/`; browser-served copies are in `public/brand/`.

The Sites publishing manifest is `.openai/hosting.json`. Site access starts private; public access is a separate audience setting. GitHub remains the development repository.

The team's VPS deployment at **https://nyc.imfinethanku.me** uses Caddy HTTPS and a nonroot Node.js service. Its signup database lives outside application releases. See [VPS deployment](docs/vps-deployment.md) for runtime configuration, updates, and rollback. Firebase continues to store account-owned saved places and notes; browser clients receive no administrative credentials. Separate restricted VPS credentials support account deletion and moderation, and remain outside Git and app bundles.

## Product references

- [Current MVP scope and October 23 presentation](docs/mvp_doc.md)
- [Native iOS setup](https://github.com/imnotmomo/nyc-restroom/blob/main/ios/README.md)
- [Internal TestFlight delivery](docs/features/native-testflight.md)
- [2026 restroom source catalog and matching limits](docs/research/restroom-sources-2026.md)
- [October 23 presentation runbook and remaining team checklist](docs/mvp-presentation-runbook.md)
- [Web finder readiness scope, checks and release evidence](docs/features/mvp-demo-readiness.md)
- [Brand position](docs/brand_position.md)
- [Style guide](docs/style_guide.md)
- [Feature process](docs/feature_development.md)
- [This feature's plan and verification](docs/features/live-pages.md)
