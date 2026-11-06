# MVP — Restroom Ready

**Five Girls · October 23, 2026 · iOS 1.0 (7), internal TestFlight**

[Public web MVP](https://nyc.imfinethanku.me/find/) · [Development repository](https://github.com/imnotmomo/nyc-restroom)

## Core flow: user, action, value

Our audience is NYC residents and visitors choosing a restroom in an unfamiliar neighborhood. Interviews shifted our focus from finding the nearest pin to checking whether someone can enter and reach the restroom before walking there.

**Map → filters → place details → walking directions in Apple Maps.** Search works without location permission. Clean, Accessible, Stair Free, Public and Elevator access filters combine with AND. Stair Free requires an explicit complete-route report; an Accessible label alone does not qualify.

The illustrative demo follows Joslyn, a woman using a wheelchair on Fifth Avenue: Accessible + Stair Free → Peninsula → reported 24/7 restroom hours, step-free doors right of the main entrance, and the Penthouse elevator to the 23rd floor with 0 stairs after entry → Directions. Entry permission and observation date remain unknown; these reports do not guarantee current availability.

Browsing is anonymous; Google Sign-in enables saves and contributions. For the hypothetical return visit, show a five-star cleanliness rating under Details & reports, submitting only a real personal observation. The bookmark saves the place for Account → Saved. Notes, visit reports and passcodes stay separate. Build 1.0 (7) is Testing in the existing 4995 and Team groups; tester membership is unchanged. The public web finder is the backup.

## Cut from this release

Public App Store distribution, payments, live occupancy or guaranteed opening hours, automatic cleanliness verification, indoor navigation, certified wheelchair accessibility, public photo uploads and a moderation dashboard.

## Stack and development

Native: SwiftUI, MapKit and Core Location, iOS 18+, system fonts and Liquid Glass with fallbacks. Web: Next.js, React and TypeScript on our VPS with Caddy HTTPS. Both share Firebase Google Authentication and Firestore. Cloudflare sends signup confirmations; GA4 measures web visits/signups only. Coding agent: Codex. Process: brief → plan → independent review → build → verify → ship.

## Planned responsibilities

| Teammate | Next-sprint responsibility |
| --- | --- |
| Zheli Chen | Native/web integration, Firebase, hosting, Analytics and traffic lead. |
| Ciarrah Wang | Demand-plan documentation, traffic support and copy review. |
| Ziying Zhou | Listing/source checks and entry/route wording. |
| Siqi Jiang | Mobile testing, screen mirroring and backup recording. |
| Zhenni Yue | Demo narration, flow rehearsal and editorial review. |

The October 23–29 traffic pairing follows the [semester demand plan](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw6-demand-plan-and-analytics/demand_strategy.md); later rotations are recorded there. Owners confirm handoffs at the start of each sprint.
