# Protected finder and interactive demo

Status: Ready for release
Date: October 16, 2026

## Brief and acceptance

The existing live finder at `/find/` requires a shared passcode. Public waitlist pages link to `/demo/`, which uses the same finder layout and starts with one example: Target Herald Square, 112 W 34th St, with the requested demo code 3434. A visitor can view details, rate, save, filter by Public / Clean (4+ stars) / Accessible / Saved, add a local example, and update or verify a demo code without Google Sign-in. These actions stay in local memory and reset on reload; they must never create real reports or account records. A persistent sample-data label distinguishes example ratings, entry/route attributes and code checks from venue evidence.

Target's [official store page](https://www.target.com/sl/manhattan-herald-square/3277) confirms its street address. NYC Planning GeoSearch returned the address point 40.749814, -73.989081 for 112 West 34th Street. This locates the address, not an internal restroom or an accessible route. Neither source establishes the demo restroom attributes or code.

## Plan and ownership

The server author owns a shared Worker-compatible access module, production/development server integration, build packaging and security tests. Root owns the passcode entry page, public links, privacy/docs, runtime secrets, integration and publication. The demo author owns an isolated client explorer, local state and map with no Firebase/account import. The independent reviewer owns security/UX acceptance and browser evidence.

Protect HTML and exported React payloads for `/find/` and its canonical/encoded aliases before asset resolution. Check the shared passcode on the server, issue a bounded signed HttpOnly cookie, reject cross-origin mutations and tampered/expired cookies, fail closed if runtime secrets are missing, and mark protected responses private/no-store. Keep the passcode and signing secret outside source and client bundles. Public marketing and waitlist endpoints remain available. This is page access protection; the existing public city collection and Firestore public-read policy are separate.

## Plan review

Independent review requires matching the asset resolver's aliases, protecting RSC/text variants, avoiding shared caches after unlocking, keeping Google/Firebase out of the demo, and using a fixed same-origin return to `/find/`. Chloe's plan review approves with conditions: label sample venue evidence clearly and ensure saves, ratings, code checks and added places remain local and resettable. The proposed persistent demo banner and isolated state model address these conditions.

## Verification

Planned: focused state and gate tests, full app Node checks, TypeScript/static export/Worker build, independent compiled-browser security and demo interaction checks at desktop and 320/390px, then both live hosts. Production checks are read-only or isolated access-cookie tests; never manufacture Firebase accounts, votes or restroom reports.

The integrated source passed all 84 Node tests, TypeScript, static export and standalone Worker packaging (97 assets). Eleven gate tests include the actual packaged Node server, signed-cookie tampering/expiry/rotation, same-origin checks, encoded/React-payload aliases, concurrent attempt limits, streaming-body limits, public signup and health. Five local-state tests exercise rating replacement/thresholds, saved filters, private-code auto-save, verification invalidation and local additions. A private configuration check inspected 233 source/build files and found neither production access secret in them.

The passcode and signing key are configured as masked Sites runtime secrets and in the existing VPS service environment. The prior VPS environment was privately backed up; unrelated settings were preserved. The proxy no longer overrides the access gate's no-referrer header.

Independent compiled-browser acceptance passed all 13 groups: actual form unlock/reload/lock; signed host-only Secure/HttpOnly/Lax eight-hour cookie; blocked HTML/encoded/React payload aliases and private headers; public marketing demo links; exactly one initial Target/3434 sample; all filters and the four-star cutoff; rating replacement/removal; saved places, private-code auto-save, code editing/visibility/verification invalidation; notes; local additions; reload/reset; 320/390px layouts; and keyboard detail/dialog focus. The demo issued no Firebase requests or API mutations. No browser errors or blocking review findings remain. See `protected-finder-demo-browser-checks.json` and its screenshot paths. The compiled implementation resolves Chloe's plan-review conditions: sample evidence is visible and demo changes stay isolated and resettable.
