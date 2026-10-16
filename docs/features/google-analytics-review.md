# Independent review: Google Analytics

Date: October 16, 2026

## Source review

The independent review found no blocking issues in the integrated analytics controller or React wiring. Analytics is limited to the two production HTTPS origins and seven fixed page routes. The controller sanitizes page location and referrer before configuring the tag, disables the automatic configuration pageview, explicitly counts navigation, and excludes private search/hash parameters. Lead payloads contain only an allowlisted source, fixed method, and measurement destination. Successful signup responses create the session marker; the confirmation removes it and persists a duplicate guard before queueing the event. Direct confirmation visits and failed saves cannot create lead events.

The six behavioral tests cover measurement ID/origin gating; route and lowercase campaign sanitization; private referrer removal; duplicate effects and back/forward navigation; confirmed lead/session/reload deduplication; and direct, malformed, or unavailable-storage cases. The initial mock-bundle check preceded authenticated property access; the subsequent real-tag check below used the team's verified ID.

## Compiled-browser verification

The actual production bundle was built with the synthetic `G-MOCKTEST` ID and tested in fresh, isolated Chrome contexts. Requests for the canonical production host were redirected to the local preview. The Google loader was replaced with a deterministic consumer of the actual page's `dataLayer`; one case deliberately delayed this loader to verify queue ordering. All attempted collection requests were intercepted and answered locally. No Google event was sent to the real property and no real signup was written.

Checks passed:

- Sanitized global defaults precede tag configuration and the first queued pageview; `send_page_view` is false.
- A delayed tag consumer drains the pageview without duplicating it.
- Each of the seven initial routes emits one pageview.
- Next.js native-history navigation and browser back/forward each emit one pageview; private query/hash changes alone emit none.
- A mocked successful signup emits one `generate_lead` on confirmation, with the expected source and no email; reload emits no further lead.
- A mocked failed signup retains the email and displays the failure without navigating, writing a success marker, or emitting a lead.
- A normal localhost visit makes no tag or analytics requests despite the compiled public ID.
- Synthetic email, private account ID, notes, search input, coordinates, and private external referrer paths never appear in captured tag commands or attempted collection payloads.

There were 17 intercepted synthetic collection requests, zero page exceptions, zero production analytics events, and zero production signup writes. All external background requests, including Firebase/maps requests from `/find/`, were blocked in these contexts. See `google-analytics-browser-checks.json` for evidence.

## Real-tag verification

The property owner verified measurement ID `G-YJG2N05KY9` in authenticated account `370637629` / property `559243633` and confirmed enhanced measurement disabled on the web stream. A fresh production build using that verified ID then passed the same isolated browser checks with Google's real tag library instead of the mock consumer.

The real tag emitted 12 intercepted HTTP collection requests containing 16 events, including all five navigation/back/forward pageviews, one initial pageview for each of the seven routes, and exactly one `generate_lead` with `source_page=conditions`, `method=email_waitlist`, and the correct measurement destination. The harness waited for Google's batched requests before closing each relevant context. A deliberately late library load produced no duplicate initial pageview. Private sentinel values were absent from every command and captured transport payload. No collection request reached Google, and signup API responses remained mocked. See `google-analytics-real-library-checks.json`.

## Published-host verification

Both existing hosts passed fresh isolated browser checks after deployment of source `c60cbd699b340b995d6149bd9b2ece8ad2990ae5`:

- `https://nyc.imfinethanku.me/find/`
- `https://restroom-ready-nyc.clcii.chatgpt.site/find/`

Each returned HTTP 200, loaded Google's real tag for `G-YJG2N05KY9`, used `send_page_view=false`, and attempted exactly one real collection request for a sanitized `/find/` pageview. Synthetic email, notes, coordinates, and fragment values were absent from commands and transport. Neither host emitted a lead or a page exception. Both requests were intercepted and answered locally with 204; Google received no QA event. All non-read same-origin requests were blocked, including Sites' Cloudflare browser challenge. No account was signed in and no signup or other application record was written. Contexts were closed afterward. Evidence omits transient client/session identifiers and challenge paths; see `google-analytics-live-checks.json`.

The release owner confirmed `generate_lead` starred as a key event, counted once per event without a monetary value. An ordinary page visit visible in Realtime is verified separately by the release owner; this independent test deliberately creates no production conversion. The lead event measures successful completed waitlist submissions, not globally unique email inserts: the existing signup API also returns success for an already-subscribed address, while confirmation reloads are deduplicated.
