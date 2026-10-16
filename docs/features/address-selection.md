# Feature: Choose an address when logging a restroom

Status: Shipped
Date: October 16, 2026

## Problem and acceptance

Use my location currently fills coordinates only, leaving the required address blank. A signed-in visitor should be able to search an NYC address or choose a nearby address after a GPS fix. Choosing a suggestion sets the public address and pin together. Suggestions describe locations, not evidence of a restroom, permission or a step-free route. The visitor can correct details manually and submit only when the address and pin are present.

## Approved plan v1

Use NYC Planning's GeoSearch API for explicit forward search (`/v2/search`) and nearby addresses (`/v2/reverse`). Both endpoints were verified HTTP 200 with browser CORS support against a public NYC test point. Requests go directly from the browser to that fixed provider, with no credentials or referrer; no new application proxy is needed. No lookup on every keystroke. Bound query size/results, validate GeoJSON and NYC coordinates, de-duplicate suggestions, abort stale requests, use a timeout, and avoid echoing query/coordinates in errors. No search or GPS is written to app URLs, logs, analytics or durable storage by lookup.

The form keeps search text separate from the final public address. Use my location requests GPS, shows its approximate accuracy when provided, and then fetches a shortlist. A GPS fix or first result must never silently become a venue address. Selection updates address + latitude/longitude atomically; keep manual address and coordinate entry available. Search/GPS/manual changes, closing, and account changes invalidate pending requests. Provider failures, empty results, denied GPS and outside-NYC fixes retain the final location and all passcode/other form drafts. A prior chosen address remains visibly selected until the visitor chooses or edits it. A new form starts with no venue pin even if the finder already knows the browser location; prior GPS is not a venue selection.

Frontend-design guidance is applied within the established checklist style, with real labels, 44px targets, readable mobile results, keyboard submission limited to address search, and no decorative redesign.

## Ownership and reviews

SDK author owns the pure GeoSearch parser/client and meaningful model/client tests. UI author owns the address picker, log form integration and finder styles. Parent owns browser accuracy preservation, privacy/docs, publication and integration. Independent reviewer owns source review and local compiled-browser acceptance checks. No Firebase schema/rule changes are needed.

Alex/Maya-informed plan review requires explicit selection, manual fallback, location/pin consistency, stale-result protection and no venue-access inference. The architecture review originally considered a server proxy; direct CORS-supported provider requests avoid application query logging, an open-proxy surface and duplicate server wiring. Provider privacy/attribution remains visible in the form and privacy page.

## Verification plan

TypeScript, Node model/client tests, production build, and independent browser checks against isolated Firebase emulators. Exercise typed search, GPS shortlist, selection/address-pin matching, manual fallback, empty/failing lookups, outside-NYC/denied GPS, keyboard behavior, late results after typing/manual edits/account changes, passcode retention, and 320/390px layout. Use fixtures only locally; read-only real provider checks establish connectivity separately. Publish both existing public hosts and verify the live result without manufacturing production submissions.

## Plan review decisions

The actual client returned six validated search results and six nearby results within 73m of a public test coordinate. Both calls were read-only and used no user location. The model/client’s ten focused tests and the existing app tests pass (68 Node tests total). Browser accuracy now retains a finite, nonnegative provider estimate; unknown estimates remain unknown. Independent source review also required removing automatic inheritance of a previous finder GPS pin from a new restroom form.

Provider reference: [NYC GeoSearch documentation](https://geosearch.planninglabs.nyc/docs/). Reverse lookup was additionally checked against the actual fixed `/v2/reverse` endpoint; results remain suggestions requiring a user choice.

## Integrated implementation

The picker now uses a separate search query and explicit result buttons. GPS accuracy is a reported browser estimate; distances are approximate straight-line distances. A selection fills public address/coordinates together without changing the venue name, entry/route answers or passcode. Manual address and coordinates remain editable; missing-coordinate validation opens the disclosure before focusing its input. New forms and resets always start with empty venue coordinates, even after Finder Locate me. Requests are ignored/cancelled after query edits, manual edits, account changes and unmount.

The frozen integrated demo build passed TypeScript/static export and Worker packaging. No new dependencies, server routes, Firebase schemas, rules or auth configuration were added.

Independent compiled-browser acceptance passed all ten groups against `demo-restroom-address-ui`: no inherited GPS pin; missing-coordinate disclosure/focus; explicit typed search and paired selection; GPS shortlist/accuracy; empty, failed, outside-NYC and denied-location fallbacks; stale search/manual-edit responses; closed form/account changes; keyboard and 320/390px layout; private passcode plus Saved persistence on an actual emulator submission; and separate unmocked browser CORS checks for both provider endpoints. There were no page errors, production Firebase requests or provider privacy-header violations. Local fixtures were cleared. Evidence: `address-selection-browser-checks.json` and `screenshots/address-picker-320.png` / `address-picker-390.png`.

Alex's final review approved the compiled implementation and acceptance evidence, with no blocking findings: the public address/pin remains an explicit choice, manual fallback works, and address suggestions do not imply permission or a step-free route. Earlier review findings about GPS accuracy, straight-line distances and inherited venue coordinates were resolved before the final build.

## Release and outcome

Production TypeScript/static export and Worker packaging passed with `nye-restroom`; no demo-project identifier appeared in the production assets. Source commit `d70bb4b4508757c17dcf9f29eb712c14c6a9bf5b` was published as Sites version 13 and VPS release `20261016T075227Z-d70bb4b45087`. Both existing public hosts serve matching finder assets with the new chooser and the provider privacy disclosure; VPS health is `ok`. See `address-selection-production-check.json`. The live Log a restroom dialog was also inspected without creating production accounts or submissions. Temporary local browsers and emulators were stopped.

The original location button filled only coordinates. The delivered flow now pairs a chosen address with its pin, supports explicit nearby lookup or typed search, and retains editable details on failure. An address result remains a suggestion rather than proof of a restroom, entry permission or accessibility. Keep the venue pin empty until a visitor selects or manually enters a location.
