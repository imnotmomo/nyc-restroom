# Feature: Live pages and email signup
Status: ready for hosted preview
Owner: Zheli Chen / Five Girls

## Brief
Help NYC visitors understand Restroom Ready's proposed value and register interest. This is a marketing and demand-test release, not a launched restroom directory. Sources: docs/brand_position.md, docs/style_guide.md and Class 5 slides, pages 85–90.

Acceptance: homepage and three distinct audience/value-proposition pages; public-ready responsive pages with B checklist typography and selected R tile; one functional email CTA per page; real server persistence and a success-only thank-you; page and lowercase campaign attribution; optional GA4 configuration; no unsupported claims or live venue information. No account is needed to join.

## Plan
Implementation owner: root agent, app/, components/, lib/, worker/, scripts/, tests/, configuration and docs. Independent reviewer: pages_review, read-only. Keep brand history and other contributors' edits.

Use Next.js static export for portable pages and a small Worker for server-side signup with D1. The local Node preview uses SQLite with the same validation and insert behavior. Ship static assets and the API together. No external form provider, map key, or account is needed for the first preview.

The UCSB Bathroom Finder README describes Swift/iOS, Firebase, Maps, search, posts and reviews, account roles and moderation. These are future NYC product references, not features claimed by this landing-page release. Current plan: web first; neighborhood/listing search, dated entry/route/condition facts and walking-directions links for the MVP; submissions and moderation follow as needed. Do not copy their code or campus listings.

## Reviews
Plan review completed by pages_review: approved, with required checks for durable persistence, duplicate handling, bounded source/UTMs, no email in analytics/URLs, errors retaining input, per-field evidence dates, keyboard/mobile layouts, and truthful private-preview/GA status. Implementation review found two issues: a session-storage error could block confirmation after saving, and the event queue used an inconsistent shape. Both were corrected. The follow-up independent review approved both fixes with no remaining implementation blockers. Public access and GA Realtime remain separate configuration checks. The combined reviewer read all three persona definitions; this was one reviewer assessment, not three independent persona runs.

## Verification
Passed `npm run build`, `npm run typecheck`, and five `npm test` cases. The tests cover input/campaign validation, rejected origins, storage failures, unique records, and persistence across reopening. Browser checks cover all six routes at 320/390/1440 px with HTTP 200, loaded images, no horizontal overflow, and no page exceptions. Main actions are at least 48 px high. The homepage passes 320 px with 200% text and visible keyboard focus. A failed POST retains the email without redirecting; a real successful POST reaches thank-you; blocked browser storage also reaches thank-you after a successful POST. Screenshots are in screenshots/. The browser report contains no collected email addresses.

## Delivery and lessons
Sites publication starts private. Public access and GA4 account configuration must be verified before describing these pages as ready for course traffic. The team supplied a GA4 property URL, which is not the G-prefixed measurement ID; that ID is still needed. No GitHub PR is being opened. iOS with MapKit and the existing Swift reference is a reasonable alternative for the product MVP; these public-facing pages stay in Next.js.
