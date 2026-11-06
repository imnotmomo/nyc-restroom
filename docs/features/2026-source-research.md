# Feature: Dated 2026 restroom source reports

Status: shipped
Owner: research coordinator
Date: October 21, 2026

## Brief

The team requested broad internet research limited to sources published or explicitly updated in 2026, including restroom codes and the internal route. Existing city listings and undated photo reports must retain their own provenance. A web publication date is not a visit or inspection date.

Acceptance criteria:

- Every accepted source has a public URL and explicit date evidence from January 1 through October 21, 2026. Dated guide editions qualify; crawl dates, copyright years and SEO titles do not.
- Facts remain attributable to a specific venue and source. Floors, stairs, elevators, building accessibility, entry permission and restroom features stay distinct. Conflicting accounts stay visible.
- Existing IDs and user data remain unchanged. Match exact branches and restrooms before attaching any detail. No new pins in this release. Unresolved locations and future facilities stay in a review queue.
- Codes enter only the existing separate public-code collection, with no invented verification or visitor account. Preserve leading zeroes and punctuation. Never import staff/security-only door codes.
- Resolved reports are visible beside real listing details, with source dates and unknown observation dates. No research-derived cleanliness ratings or accessibility certifications.
- Preserve concurrent MVP readiness work, private notes, ownership rules, login requirements and existing hosting configuration.

## Plan

Use a versioned, public curated source registry, alongside the existing bundled city snapshot. Archive source records, date evidence and place matches in an administrator-only Firestore research collection using create-only writes. This avoids broadening any existing client write schema or security rule. The public registry is deliberately public source material; raw review notes and unresolved matches stay private. A future refresh requires a new reviewed release.

Compare alternatives: putting arbitrary web fields into immutable community submissions would break their strict schema; a new publicly writable report collection is unnecessary for this research task. Keep these as editorial source reports, not visitor submissions or inspections.

Slices and ownership:

1. Research agents own separate staging source inventories outside the Git repository.
2. Coordinator resolves existing venue identities, builds the source registry/catalog and a manifest-bound create-only archive import. Unmatched venues remain research leads; no new locations are created in this release.
3. UI implementer owns new `lib/source-reports.ts`, a new finder source-report component/CSS module and focused model tests. Coordinator owns the small integration in `components/finder/detail.tsx`. Preserve other contributors' changes in that file. Do not edit their explorer/demo/filter work.
4. Independent reviewer checks date eligibility, venue mapping, code semantics, manifest and UI before database writes/publication.

Checks: source date/URL/model tests; no unknown-to-no inference; duplicate/replay protection; immutable existing records; public code verification remains null; typecheck, project tests, production build, mobile listing inspection and anonymous readback. No synthetic public ratings or user observations.

## Reviews

Independent plan review by the guides research agent: two blockers resolved before build. No eligible numeric codes were found, so this release defers code imports entirely. Existing code reports and verification dates stay unchanged. Restrict this release to exact existing restroom/branch matches; unmatched, new, event-only and announced facilities remain catalog/archive leads. Combined source listings retain named subfacilities so one floor's hours do not become another's. Do not match a new kiosk to an existing nearby park facility.

## Verification and delivery

Independent model/UI and data reviewer approved the integrated 35 reports, 60 details and 24 exact existing targets. Blockers fixed before release: actual city IDs contain `~`; Marriott access replies span September 8–10, so the combined conflict now has an unknown individual comment date and an explicit discussion range. Floors and elevator comments retain their actual separate dates. The final wording converts internal subfacility scoping instructions into plain visitor-facing copy.

The complete research contains 61 dated source records (60 distinct URLs), 151 source-specific venue mentions and 292 extracted facts. The public subset references 14 sources. Repeated mentions are not unique restrooms or independent confirmations. No eligible numeric passcode was found; existing photo codes are not re-dated.

The Firebase workflow verified the existing Standard `(default)` database. The reviewed manifest SHA-256 is `d9907738b43df829fde8c860b344cd8860ad65adcef32f624104c7943b6d26b8`. One atomic commit created 97 administrator-only archive documents: one batch record, 61 sources with their venue-match decisions, and 35 matched reports. All payloads were read back and compared. A dry replay planned zero writes. Anonymous SDK checks confirmed public listings remain readable and the research archive is denied. No location, rating, code, ownership, private user record or security rule was changed by this import.

The publication checkout starts from the existing published site source and includes only this research change; concurrent unfinished public visit-report work in the product checkout is excluded. Type checking, 147 Node regression tests and the production build passed in that isolated release. An initial test attempt could not open temporary local servers under the sandbox; the same suite passed with local-server permission. A dependency symlink was unsuitable for Turbopack's build boundary; locked dependencies were installed locally and the build passed without changing application configuration.

Browser checks used anonymous public reads, with no production contributions or emails. Pier 40 courtyard/second-floor schedules remain separate. Bloomingdale's SoHo elevator and alternative-stair descriptions wrap at 320px; Marriott's separate dates and conflicting entry reports remain visible. Source links and native source-limit disclosures work by keyboard. Desktop, 390px and 320px checks found no horizontal document overflow or runtime errors. These checks do not establish a physical visit, working elevator or current admission permission.

Published Sites version 23 from managed source commit `351aea77d443c13930f213321f6f8b31a7235c13`; deployment succeeded. The same checked build was deployed to the VPS as `20261021T212942Z-351aea77d443`. Live anonymous browser readback at the team domain confirmed the two separately scoped Pier 40 reports, no internal editorial instructions, no horizontal desktop overflow and no runtime errors. Existing public audience and runtime secrets were preserved. No GitHub commit/push was performed.

The complete source archive is saved; 118 unmatched source-specific mentions still need branch/restroom identity or admission confirmation before any map addition. This is a deliberate matching boundary, not a claim that those locations lack restrooms. Existing user-authored observations and all code-verification dates remain unchanged.
