# Restroom Ready

A mobile-first NYC restroom project. This release includes a homepage, three value-proposition pages, and a durable email waitlist. The marketing illustration remains an example. `/find/` is a working map/list of 1,064 city-listed locations across NYC, with Google Sign-in and account-owned saved places and private visit notes in Firebase. The directory uses a dated official snapshot and does not establish current availability or complete restroom coverage.

## Run locally

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
- `/find/` — real city listings, map/search, source details, walking directions, Google accounts, saved places, and private visit notes

## Firebase web app

Firebase project: `nye-restroom`. Registered app: **Restroom Ready Web**, `1:547771536579:web:f651ddda4a81b2e9297e76`. The public SDK identifiers are in `firebase/web-config.json`; environment variables can override them. These client identifiers are not admin credentials. Account data is protected by Firestore rules. See [Firebase setup](docs/firebase-setup.md) for provider configuration, rules, and verification.

The existing Standard `(default)` database in `nam5` stores private saved places and notes. The source-backed directory is bundled in `data/nyc-restrooms/`, with a reproducible import script. It is historical source data, not a live availability feed.

## Analytics

Create your own GA4 web data stream. Put `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-...` in `.env.local` before building; use the environment example for other settings. No measurement ID is included in source, and no GA requests are made while it is unset.

Mark `generate_lead` as a key event in GA4. It is queued on the thank-you page only after a successful server save and guarded against reload duplication in that session. The event includes the source page, never the email. Campaign fields stored with the signup are lowercase. Validate the installed ID in GA Realtime; this cannot be certified without the team's property.

Never commit signup databases, export email addresses into this repository, or include email addresses in campaign URLs.

## Build and hosting

`next build` exports the pages to `out/`. `scripts/build-worker.mjs` embeds these assets into a self-contained Worker with `/api/waitlist`. This keeps the frontend in Next.js and makes the signup handler portable to Sites D1. Existing brand sources remain in `brand/logo/`; browser-served copies are in `public/brand/`.

The Sites publishing manifest is `.openai/hosting.json`. Site access starts private; public access is a separate audience setting. GitHub remains the development repository.

The team's VPS deployment at **https://nyc.imfinethanku.me** uses Caddy HTTPS and a nonroot Node.js service. Its signup database lives outside application releases. See [VPS deployment](docs/vps-deployment.md) for runtime configuration, updates, and rollback. Firebase continues to store account-owned saved places and notes; no Firebase administrative credentials are needed on the server.

## Product references

- [Brand position](docs/brand_position.md)
- [Style guide](docs/style_guide.md)
- [Feature process](docs/feature_development.md)
- [This feature's plan and verification](docs/features/live-pages.md)
- [UCSB Bathroom Finder reference](https://github.com/ucsb-cs184-f24/team02-bathroom): Swift/iOS, Firebase, search, posts/reviews and admin moderation. The reference informed the MVP scope; its code and campus data are not copied.
