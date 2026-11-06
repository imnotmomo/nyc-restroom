# Research incorporated into restroom cards

## Request and intended behavior

The October 24 research was initially published as separate source notes. The user requested that the findings populate the restroom card itself. This update gives the web and native card a shared, administrator-written, per-place public research profile.

| Card area | Incorporated evidence |
|---|---|
| Hours | Listed schedules, explicit restroom schedules, separately labeled venue schedules and seasonality |
| Amenities | Supported restroom features and dated, room-specific inspection fixture counts |
| Conditions | Actual dated room inspections, recorded problems, closure/access notices and supplied visitor observations |
| Passcodes | Published code claims and requirements alongside existing community code reports |
| Entry & route | Exact entrances, floors, steps, elevators, entry restrictions and building-only descriptions with their scope |
| Rate and Comment | Anonymous published narratives with original dates and separately labeled external venue scores |

Known researched facts replace matching unknown placeholders. Existing known reports and conflicting source claims remain available. The compact iPhone card retains short summaries; expanded facts stay within the relevant card destination. A separate source-notes destination is not required to find the information.

## Shared data and boundaries

`restroomResearchProfiles/{placeID}` contains a strict versioned public projection from the exact reviewed research manifest. The profile records safe source links, original publication dates, actual inspection dates, separate retrieval/compilation metadata, typed fields, room context and anonymous narrative text. Existing source-comment document IDs support duplicate suppression while preserving older published material.

Both clients read only the selected place's exact profile, reject malformed or mismatched profiles, ignore cache-only/unconfirmed snapshots and discard stale selection callbacks. Existing listing and direct report values remain available during loading or failure. Clients cannot list, create, update or delete profiles. Private source research, accounts, saved places, ownership records, rating votes and code votes remain under their existing rules.

Venue hours do not become restroom hours. General building elevators do not become verified routes to a restroom. Inspector grades and external venue scores do not become cleanliness votes. Published codes retain leading zeroes and an unverified source label without acquiring user ownership or successful-use confirmations. Fixture counts do not establish working fixtures or stocked supplies. Calendar inspection dates do not acquire invented times.

## Implementation and verification

The reviewed public packet contains **1,146 profiles**, **31,959 facts**, **nine anonymous narratives** and **1,927 source references**. All 1,064 city listings and 82 community places have profiles. The other 21 map places retain their existing records; identity-only and unsuccessful searches do not create invented facts.

- Source manifest SHA256: `adee7ab48de4bbf78d8286c150f9a1d7b7f392490c4c7de2c224a021719c4b74`.
- Public packet SHA256: `5ed8782e4b8a4aa80dffc60bbef654437bf22028276ec9fc54670694bbe2f118`.
- Reviewed create-only plan SHA256: `af21493e0d67a1f42949f93bae0f98ac9e012d8d0834e9ce24691e99be18b603`.
- All 1,146 writes completed with exact server readback. A second importer preview proposed zero writes.
- The signed-out application SDK decoded and compared all 1,146 live profiles at `2026-10-24T12:27:30.472Z`. Collection enumeration and private research access were denied. Verification created no accounts and made no writes.
- Firestore rules: **681/681 tests passed**, including the 14 exact-profile read/list/write boundary cases. The active ruleset is `03026ad6-035c-44d1-b8ea-cf32fee46f79`; live rule content matches SHA256 `9497407e7b20726de2d929ef0cedcdc74d4d948239e43c4c9e908161fcf9a64e`.
- The profile model and importer checks passed **13/13**. The final website passed **289/289 application tests**, TypeScript checking and the production build; an independent reviewer reran the actual card rendering/listener tests.

The website is live in release `20261024T124705Z-378edaa8fc9f`. The deployed server bundle matches local SHA256 `7226cbbb4eb6af9dcc33169bebe63d2adea676284e75b8e488557ef27855e203`; health is `ok` and the service is active. The Caddy configuration stayed byte-identical.

Read-only live browser checks confirmed actual Parks room conditions/issues and zero fixture counts within their sections, Whitney entrance/elevator facts within Route inside, a Canarsie closure warning beside the older directory status, separately labeled Capital One venue hours and venue score, and an Anonymous Reddit narrative retaining May 13, 2026. The direct Peninsula 24/7 report remains visible. Both 320- and 390-pixel cards have no horizontal document/panel overflow, and no console errors were observed. These are QA visits, not acquisition or customer validation.

Independent Maya, Chloe and Alex persona reviews each approved the same reviewed packet and card behavior with a score of 8 and no blocking findings. They are research-grounded simulations, not new interviews. Chloe's optional building-scope copy improvement was applied with an explicit “Building:” prefix. Independent engineering review approved the schema, exact-place lifecycle, source/date boundaries, protected contribution behavior and final Hours fallback.

## Missing hours and consistent native presentation

Research coverage does not establish every field for every restroom. The [hours audit](research-hours-audit-20261024.json) distinguishes listed/restroom schedules, venue-only schedules, seasonality and missing evidence. The projection dropped no accepted schedule from the reviewed manifest; raw search captures also contain unreviewed or conflicting candidates that are not published automatically. Blank or explicit unknown schedule values now display **Hours unknown**. Venue schedules remain labeled as venue hours and cannot establish restroom availability. Direct 24/7 reports and existing known listing schedules remain intact through loading and read failure.

All iPhone restroom opening paths share one medium-only sheet. Longer fields and the corresponding destinations scroll inside it; inspection issues, complete feature details and fixture inventories remain available in compact in-section groups. Account, Filters and contribution forms retain their presentation. The native runtime evidence is recorded separately in [the native feature record](native-research-card.md). This source revision has not been uploaded to TestFlight.

Both existing Analytics streams were freshly verified as receiving traffic, and `sign_up` is an enabled key event with an active iOS stream. See [current Analytics status](account-signup-analytics.md#current-status--october-24-2026). No fake conversion or signup was created.
