# Feature: Connect Google Analytics

Status: Ready to publish
Date: October 16, 2026

## Brief

Connect the existing Restroom Ready Google Analytics property to both public hosts. The authenticated Google Analytics UI confirmed account `370637629`, property `559243633` (`nye-restroom`), Web stream `16138957815` (`Restroom Ready Web`), and measurement ID **`G-YJG2N05KY9`**. The existing stream is reused for both public hosts; no new Analytics property or credentials are needed.

Acceptance: one page view for each supported route and client navigation; lowercase campaign attribution; `generate_lead` only after a successful waitlist response reaches the thank-you page; the event marked as a key event in the property; a real page visit visible in Realtime. Emails, account IDs, private notes, search input, and precise coordinates must stay out of analytics. Local browser QA must not manufacture production demand or conversions.

## Plan

The static Next.js export embeds its public configuration at build time. Use the verified public measurement ID in `analytics/web-config.json`, with an optional environment override, then build one bundle for both existing hosts. Preserve the existing signup persistence and success/error flow. Explicit sanitized pageviews handle initial and Next.js navigation; disable overlapping history tracking in the web stream. Disable automatic outbound link collection because walking-direction URLs may contain a user's location. Keep Google Signals and advertising personalization disabled.

An independent initial source audit identified those pageview/privacy settings and confirmed that the existing success marker is written after a successful signup response. Implementation and behavior tests are delegated separately from property setup and publication. A subsequent independent review will check the integrated result.

## Verification and delivery

The tracking implementation and source review passed, as did all 47 Node regression tests, TypeScript, and a static-export/Worker build with the dummy `G-MOCKTEST` ID. An independent compiled-bundle browser run used canonical-host routing to the isolated local server, a delayed synthetic Google tag queue consumer, and intercepted collection responses. It verified one pageview across all seven initial routes and client navigation/back/forward, deduplicated private-only URL changes, sanitized global defaults/referrers, one confirmed-signup lead, no leads for failure/direct visits/reloads, and no localhost tracking. Seventeen synthetic collection attempts were intercepted. No production metrics or signup records were created. See [independent review](google-analytics-review.md) and [browser checks](google-analytics-browser-checks.json).

The user completed Google sign-in. The verified measurement ID is now in the public tracked configuration. A production build with the actual ID passed (72 static assets plus the Worker). Enhanced Measurement was already disabled on the selected stream (`aria-checked=false`), and that setting was retained. The stream website URL was set to `https://nyc.imfinethanku.me`. Google Signals is off (the property offers a Turn on button). User-provided-data collection is not enabled; its setup still requires an industry selection, which was left untouched. The `generate_lead` event was created with code and marked as a key event, once per event, without a default monetary value. It measures completed successful submissions rather than globally unique email inserts. The real Google tag library passed isolated transport verification: 12 intercepted HTTP requests contained 16 events, including exactly one `generate_lead`, the initial views of all seven routes, and five client-navigation/back/forward pageviews. Private sentinel values were absent. See [real-library checks](google-analytics-real-library-checks.json). Publication and a real page visit in Realtime remain to be verified. The earlier dummy-ID bundle has been replaced locally. No signup conversions will be invented for verification.
