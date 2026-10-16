# Feature: Real NYC photography on marketing pages

Status: Ready to publish

Date: October 16, 2026

Owner: Marketing imagery implementation agent; publication and independent verification coordinated by the parent agent.

## Problem and scope

The homepage and the three HW5 landing pages explained the idea with an illustrative map and listing, but lacked real photography. Add a context photograph to `/`, `/conditions/`, `/entry-route/`, and `/dated-reports/` while preserving the approved B inspection-checklist design and the existing signup flow.

Acceptance: every marketing route shows a real local photograph with descriptive alt text, bounded responsive layout, visible creator/source/license/change credit, and a photograph date. Photos remain separate from restroom reports; none imply current conditions, access, or a completed inspection. Small screens retain readable copy and controls without horizontal overflow.

## Plan and review

Keep the hero and example listing. Insert a two-column editorial panel between the existing strip and feature details: scene on the left, concise route-specific explanation on the right. Stack on mobile. Reuse the current typography, spacing, muted labels, blue links, and borders. Use 640/1280 px WebP files with a reserved image frame and lazy loading.

Parent reviewer approved this plan before implementation, with the instruction to keep the context caption plain and concise and not imply inspected venue facts. The final implementation uses “New York City · context photo,” the original photograph date, and separate source credit. This is a small imagery addition; product flows, policy, signup, analytics, Firebase, and finder code are outside scope.

Changed files: `components/landing.tsx`, `app/globals.css`, eight assets in `public/images/nyc/`, this record, and [image-sources.md](../image-sources.md).

## Sources and implementation

Four Commons source pages were checked for creator, date, and CC BY 4.0 permission before downloading. Larry D. Moore's requested name/license/source credit is visible. All source links, transformations, dates, dimensions, and sizes are recorded in [image-sources.md](../image-sources.md).

All eight WebP files were decoded and visually checked in contact sheets. The figures use local responsive assets, descriptive alt text, dimensions, and CSS object-fit, with the displayed crop disclosed in the caption. The historical exterior photographs do not provide present restroom facts. Illustrative café facts remain labeled as examples.

## Verification and delivery

- TypeScript check: `node node_modules/typescript/bin/tsc --noEmit` passed after the change.
- Independent source review passed: all four routes receive one photo panel; existing forms, example labels, and Analytics wiring are preserved. The production build passed with 80 packaged static assets plus the Worker.
- The compiled preview passed eight route/viewport checks (four routes at 390 and 1280 px): each photograph loaded, descriptive alt and visible creator/license credit were present, two existing signup forms remained, and document width matched the viewport without overflow. Mobile and desktop screenshots were visually inspected. Evidence: `marketing-imagery-browser-checks.json`.
- Publication to the two existing public hosts is pending.

No Git commit, push, or publication was performed by the imagery implementation agent.
