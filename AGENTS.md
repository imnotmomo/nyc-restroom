# AGENTS.md

## Project

This repository supports **Restroom Ready**, a proposed NYC restroom discovery tool.

The product helps people decide which restroom to use before making the trip by showing:

- entry rules
- restroom conditions
- the route inside the building
- when information was last reported
- what information is still unknown

The current product name is still a working name and may change.

## Application framework

Use **Next.js** for the web application. The first release is a static-export frontend with a small hosting Worker for the email waitlist. The local preview uses Node.js SQLite; Sites uses D1. Read README.md before running or changing the deployment.

## Before making changes

Before editing user-facing copy, UX, or product behavior:

1. Read `docs/brand_position.md`.
2. Read `docs/style_guide.md`.
3. Check relevant persona-agent feedback when making major user-facing changes.
4. Do not invent product capabilities, live data, user counts, testimonials, or verified restroom information.
5. If information is missing or uncertain, label it clearly instead of guessing.

## Product principles

Follow these principles across product, copy, and design decisions:

- Make uncertainty visible.
- Let users judge what works for them.
- Prefer specific information over vague ratings.
- Keep interactions fast and practical.
- Separate building-entry access from restroom access.
- Do not claim information is real-time unless a real live data source supports that claim.
- Do not present visitor reports as guarantees.

## Brand language

Preferred language includes:

- “Know before you go.”
- “Find a restroom you can use.”
- “Purchase required”
- “Restroom floor”
- “Stairs to restroom”
- “Last reported”
- “Not reported”

Avoid unsupported or overly broad claims such as the following.
“Real-time” and “Available right now” are only allowed if a live data source supports them:

- “Guaranteed clean”
- “Always open”
- “Available right now”
- “Real-time”
- “The safest bathrooms”
- “Everyone can use it”

For complete positioning and copy rules, see `docs/brand_position.md`.

## Design

Follow `docs/style_guide.md` for:

- colors
- typography
- spacing
- visual tone
- logo usage
- UI patterns

Do not introduce new fonts, colors, or visual styles without a clear reason.

The selected logo is **03 — R tile**. Approved marks, outlined wordmarks, lockups, light/dark and one-color variants, avatars, and favicons are in `brand/logo/`. Follow `brand/logo/README.md` for sizing and clear space; use the supplied exports instead of redrawing the mark. The style guide specifies the three retained page directions, B/E/F. Keep one direction consistent within a page.

## Persona agents

The course repository contains the current definitions:

- [Maya](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-maya.md)
- [Chloe](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-chloe.md)
- [Alex](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-alex.md)

Load each relevant definition in a separate review session and give it the same version of the artifact. Record the input version, verdict, blocking feedback, revision, and rerun. The course repository also contains the installed Codex and Claude-compatible definitions and earlier review records. These definitions have not been installed in this product repository.

Use them to review major user-facing copy, landing-page changes, UX flows, or feature concepts. Their outputs are research-grounded simulations used to test decisions from different user perspectives; they are not customer interviews or demand validation.

## Feature development process

We use [Feature Forge](https://github.com/kenxle/feature-forge) because its brief, plan, build, verify, ship, and learn stages keep a small feature connected to its user problem and acceptance evidence. Next.js is our application framework.

The project workflow is recorded in `docs/feature_development.md`. Follow it through Markdown records; Feature Forge slash-command skills have not been installed.

1. **Clarify and brief:** Read the research and product docs. State the user problem, scope, unknowns, and observable acceptance criteria in a feature record.
2. **Plan:** Inspect the existing code, compare relevant implementation options, and break the work into small slices with named file ownership and checks. Record dependencies before assigning parallel work.
3. **Review the plan:** Have a separate reviewer check the requirements, route and entry distinctions, data handling, and UX. Resolve blocking findings before building. Use customer personas for relevant copy or UX questions.
4. **Build:** Implement the agreed slices. Preserve other contributors' changes. Use clearly labeled examples in prototypes; never fill missing venue facts with guesses.
5. **Verify independently:** Have a reviewer who did not build the change compare the integrated result with the acceptance criteria. Run the repository's supported checks and inspect relevant mobile/browser flows. Fix blocking issues and record evidence.
6. **Ship:** Prepare a concise change summary, validation results, and known limitations. Commit, push, open a PR, merge, or deploy only when the team has authorized that action. A teammate checks the delivered result after release.
7. **Learn:** Record useful lessons and unresolved questions in the feature record, and update project guidance when a decision changes it.

A small, understood fix can use a shorter record with the problem, changed files, verification, and outcome. It still needs appropriate checks and review.

## Running the project

Use Node.js 22.13 or newer.

- Install: `npm ci`
- Develop: `npm run dev` (http://localhost:3000)
- Type check: `npm run typecheck`
- Test signup validation and persistence: `npm test`
- Build pages and hosting Worker: `npm run build`
- Run the built preview: `npm start`

The required runtime binding for hosted signup is `DB` (Sites D1); migrations live in `drizzle/`. Local signup uses ignored `.data/waitlist.sqlite`. The public GA4 measurement ID is configured in `analytics/web-config.json`, with optional `NEXT_PUBLIC_GA_MEASUREMENT_ID` and `NEXT_PUBLIC_SITE_URL` build-time settings in `.env.local`. Missing or invalid Analytics configuration makes no tracking requests. Only the two HTTPS production hosts and known application routes are tracked; local previews stay disabled. Preserve sanitized manual pageviews, stripped referrers, and success-only signup events. Enhanced Measurement and user-provided-data collection must stay off for the stream so automatic history, form, search, and outbound-direction events cannot bypass privacy controls. Never claim GA is configured or verified without the team's actual property; mocked local tests do not establish real traffic or demand.

The marketing pages are `/`, `/conditions/`, `/entry-route/`, and `/dated-reports/`. Their examples remain illustrative. `/find/` is the real map/list of a dated 1,064-location citywide NYC collection, with Google accounts, saved places, and private visit notes. Search and maps use every matching location; the list progressively shows 50 at a time. The source collection does not establish complete coverage or current availability. Preserve listing IDs when refreshing data so saved places and notes stay attached. Public cleanliness ratings are readable without login; signed-in users can manage one rating per place. Google Sign-in is required to log a missing restroom; recent public visitor submissions appear alongside the city snapshot with their own provenance and dates. Public chosen pins are distinct from transient Locate me coordinates. Written cleanliness reviews remain future work. The signup handler owns `/api/waitlist`; a static Next.js export does not implement server routes by itself.

Keep signup data, session credentials, and email addresses out of Git, page URLs, and analytics. A failed save must retain the email and must not navigate to the thank-you page. Public traffic needs the site audience to be set to public; private deployment does not satisfy that requirement.

## Firebase backend

Always find and use the appropriate Firebase agent skills for Firebase work. They are installed in this course workspace under `../.agents/skills/`; install them with `npx skills add firebase/agent-skills --agent=codex` if missing. Use the latest Firebase CLI through `npx -y firebase-tools@latest` and official Firebase MCP tools.

The selected project is **`nye-restroom`**, registered as **Web**, with Google Sign-in and the existing Standard `(default)` Firestore database in `nam5`. Read `docs/firebase-setup.md` before backend changes. Public SDK identifiers are in `firebase/web-config.json`; never commit CLI tokens or service-account credentials. Saved places and notes belong under the two UID-scoped private subcollections defined in `firebase/firestore.rules`. Public cleanliness totals use preinitialized `restroomRatingSummaries/{placeID}` documents; private votes use `ratings/{uid}` beneath each summary. Preserve the paired atomic vote/aggregate rules, and never create invented production ratings. New locations are immutable public `communityRestrooms/{communityID}` records, atomically created with private `restroomSubmissions/{communityID}` ownership receipts and empty rating summaries. Preserve strict schemas, non-anonymous login, bounded latest-1,000 public reads, stable retry IDs, and separate observation/submission dates. Community step-free-route reports never become city accessibility labels. Validate rule changes against the emulator tests and preserve source/observation/submission date distinctions. Passcodes use separate private own records, immutable ownership reservations, and opt-in public projections. Preserve Only me by default, atomic private-code auto-saving, owner-only sharing changes, version-pinned verification receipts, and separate update/check timestamps. Code edits clear prior verification. Never put codes in public location fields, URLs, Analytics, or error messages. See `docs/features/restroom-passcodes.md`.

## Repository structure

```text
/
├── AGENTS.md
├── app/                 # Next.js pages and shared styles
├── components/          # Landing layouts, signup, analytics
├── lib/                 # Page content
├── public/              # Browser assets
├── worker/              # Hosted request handler and shared signup validation
├── scripts/             # Local preview and build packaging
├── tests/               # Validation and durable-signup checks
├── drizzle/             # Hosted database migrations
├── brand/logo/          # Source identity assets
├── docs/                # Brand, style, feature records, workflow
└── diagrams/
```

The product repository includes its style history and complete logo set. Supporting research and persona reviews link to the course repository on GitHub, so they can be read without an adjacent checkout. The flow diagram describes the proposed product; it does not describe implemented routes or services.

## Source of truth

Use these sources in this order:

1. `docs/brand_position.md`
2. `docs/style_guide.md`
3. the linked course persona definitions and recorded reviews
4. supporting interview and Reddit research

If sources conflict, identify the conflict and resolve it against the underlying evidence before making a major change. Ask the team only when a decision or missing fact cannot be resolved from the records.
