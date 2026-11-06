# Branch ownership

The repository uses two platform branches. Both keep the existing Git history; this split does not rename the Firebase project, register replacement apps or alter production records.

| Branch | Primary source | Shared services |
| --- | --- | --- |
| [`main`](https://github.com/imnotmomo/nyc-restroom/tree/main) | Native SwiftUI/MapKit iPhone app under `ios/`, bundled snapshots, model/UI tests and native guidance | Firebase schemas/rules/indexes, account deletion and moderator backend source |
| [`webapp`](https://github.com/imnotmomo/nyc-restroom/tree/webapp) | Next.js website, public finder, marketing/sample pages, web moderator dashboard, browser assets and web tests | A compatible snapshot of shared Firebase/backend source |

## Working on a platform

Use `main` for native application work and `webapp` for web work. Read that branch's README and AGENTS instructions before changing it. Keep the existing app identifiers, SDK pins, source dates, account ownership and protected contribution contracts.

Shared backend or schema work is maintained on `main` and ported deliberately to `webapp` with its compatibility checks. Review the selected files instead of merging an entire platform tree over the other branch. Keep older released clients readable and preserve original record IDs. Production deployment is a separate explicit action.

Private Firebase CLI state, service-account keys, signing keys/profiles, local app configuration, user workspace files, account exports, raw operational logs and build/release artifacts stay outside commits. Retained local archives and unselected source evidence are not removed by this split.

## Source publication and releases

A Git commit or push publishes source only. It does not deploy the website or backend, change Firebase rules/data, upload an iPhone build or change testers. Follow the relevant release procedure and verify the actual delivered artifact separately.

The latest native source includes unreleased App Store safeguards and the signup repair; recorded distributed versions remain internal **1.0 (18)** and Public Beta **1.0 (19)**. Future internal releases default to **Team only** unless the user specifies another group. Keep current source status separate from dated release receipts.
