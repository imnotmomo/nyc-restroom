# First-time Google account signup Analytics

October 23, 2026. Web deployed; native source prepared, build pending.

The conversion changed from a waitlist lead to a first-time Firebase Google account. Both clients use Firebase's successful credential result, require `isNewUser=true` and provider `google.com`, and compare the result account with the current account. Local duplicate guards hold IDs in memory only; the event contains only `sign_up` and `method=google`. The Firebase project is shared: creating an account on one client does not make it new again on the other.

The website preserves sanitized manual pageviews and private-referrer handling. Reading Auth metadata and delivering Analytics are best effort after successful authentication, so Analytics cannot fail a completed login. Returning or restored logins, canceled/failed requests, legacy email forms and direct thank-you visits do not emit signup. Existing waitlist data and email delivery are retained separately; this migration does not grant newsletter consent.

GA4 property `559243633` has `sign_up` marked as a code-emitted key event, once per event with no default monetary value. The `generate_lead` key-event flag was removed. The user approved deleting the two incorrect web modification rules, `Rename waitlist signup` and `eq`; the web modification list then showed no rules. Historical lead data is preserved and must not be relabeled as accounts. The key-event row currently has no detected stream data; no production account/conversion was invented to populate it.

A labeled QA visit appeared in Realtime as one `page_view` and one `session_start`. The course submission includes this Realtime screenshot separately from October 16–22 historical totals. QA traffic is not acquisition.

Independent review caught metadata extraction outside the Analytics error boundary; it was moved inside the best-effort catch and the fix was rechecked. Six Analytics tests, five existing waitlist tests, TypeScript and the production build pass. Thirty-three Swift model tests pass, including new/returning/stale/duplicate account cases. Native source uses FirebaseAnalyticsCore, disables IDFV and automatic screens, denies advertising consent, sends only a fixed finder screen and signup method, and disables collection on simulators.

Native SDK compilation, signing, upload and physical-device receipt remain unverified because `Zhelis-Mac-Studio.local` no longer resolves. TestFlight build 1.0 (7) is unchanged and contains no Analytics. Finish those checks on the authorized Mac Studio before distributing the native update. Web deployment and bundle verification are recorded below after release.

The final web release is `20261023T172627Z-032f089b084d`. The active server release and HTTPS health both passed. Local and deployed compiled server bundles matched SHA-256 `c75fd6d550787b6a1b8ff3d6a7238ecdffe67bb4d70e6995fec6038353373e46`. A fresh public finder loaded city/visitor records and its Google sign-in button without authentication. Genuine first-account credential exchange and Realtime signup receipt remain pending; the Realtime pageview check does not claim either.
