# Structured hours and entrances

Date: October 23, 2026
Stage: web and backend released; native build 7 Testing in the existing 4995 and Team groups

## Brief

The user supplied Peninsula's 24/7 restroom hours and step-free doors on the right side of the main entrance. The existing notes contain this report, but the native hours row ignores free text. They requested a separate **Stair Free** filter and structured entrance/route display throughout the app. Only Peninsula has new facts; all other unknown details stay unknown.

Keep existing community documents unchanged so installed build 6 can still decode them. Add an optional public, administrator-written `restroomAccessDetails/{placeID}` document. Current clients read it independently and attach it by exact stable place ID. No empty documents or new factual claims are needed for other venues. General Accessible remains distinct from a stair-free route. Do not infer entry permission, current operation, stall features, a visit date, or city-derived no-stairs facts.

## Shared version-1 contract

Each sidecar has exactly these 15 fields:

| Field | Type and bounds |
| --- | --- |
| schemaVersion | integer 1 |
| placeID | existing public ID, 1–160 characters matching the existing safe public ID pattern |
| restroomHours | nonempty string up to 160 characters, or null |
| entranceLocation | nonempty string up to 500 characters, or null |
| entranceStepFree | yes, no, unknown |
| stairFreeRoute | yes, no, unknown |
| elevatorToRestroom | yes, no, unknown |
| elevatorNote | nonempty string up to 300 characters, or null |
| restroomFloor | nonempty string up to 80 characters, or null |
| stairsAfterEntry | integer 0–200, or null |
| sourceTitle | nonempty string up to 160 characters |
| reportedAt | Firestore timestamp for the report, distinct from the visit date |
| observedOn | Firestore timestamp for an actual observation date, or null |
| updatedAt | Firestore timestamp, not an inspection time |
| limitations | nonempty string up to 1,000 characters |

Text rejects control characters. Dates must be finite; an observation cannot be later than its report, and the report cannot be later than the update. A positive complete-route answer is rejected if the entrance is explicitly not step-free or stairs after entry exceed zero; unknown entrance/stairs do not invalidate an explicit complete-route report. Public reads are bounded at 1,000 records. Ordinary clients cannot create, update or delete these documents. No user identity or private notes belong here.

## Peninsula report

- Stable ID: `community-7398fe084d3d87eed23c`.
- Restroom hours: `Open 24 hours a day, 7 days a week`.
- Entrance: `Use the step-free doors on the right side of the main entrance.`
- Entrance step-free, stair-free route and elevator to restroom: yes.
- Elevator note: `Take the elevator and choose Penthouse.`
- Floor: `23rd floor`. Stairs after entry: 0.
- Source: `Contributor report`. Actual observation date remains null. Entry permission remains unknown.

## Implementation ownership and acceptance

Native work owns Swift model, live feed, display, filters and meaningful Swift checks. Web work owns the matching strict decoder, public feed, shared filter/data attachment and entry/route display. Rules work owns the bounded read/admin-only write boundary and emulator checks. Root coordinates the reviewed database write, app integration, build/QA and presentation notes.

The five native filter options are Clean, Accessible, Stair Free, Public and Elevator access. Selections combine with AND; no selections means unrestricted discovery. Clear filters stays red, Done blue, no descriptions or All option. Web adds Stair Free to its existing single-selection filter row. Stair Free requires explicit complete-route evidence: a positive sidecar report or the existing explicit community step-free answer when no sidecar exists. City Accessible labels, notes, floors, and missing stairs alone do not qualify. Sidecar unknown/negative values own their route/elevator status; elevator falls back to reviewed bundled evidence only when no sidecar exists.

Peninsula must match Accessible + Stair Free + Elevator access. Its card and details show known hours, entrance, floor, stairs and elevator route with their own report source/date. Feed loading/failure must stay distinct from a conclusive empty filtered result. Existing listing facts, account/privacy checks, ratings, codes and original source dates stay intact.

## Verification and delivery

- Web: 195 tests, TypeScript checks and production build passed. The live release is `20261023T155436Z-032f089b084d`; compiled bundle SHA-256 is `4dfb7b319967ca9549592c93c678b0aa30458d4e5626d8ec444cc91a5fb6703d`. Anonymous browser checks passed on desktop and at 390 × 844.
- Backend: 16 focused access-detail rules cases and all 440 Firebase rules cases passed. The rules and Peninsula sidecar are deployed; anonymous REST readback confirmed the public record. Existing community documents remain unchanged. Only Peninsula received new facts; its observation date remains null.
- Native models: all 31 Swift model tests passed. The actual Firebase-linked simulator build compiled successfully.
- Native UI: after correcting the test-only lazy-row scrolling assertion, focused run v6 `testStructuredPeninsulaHoursEntranceAndRoute` passed in **46.197 seconds**. This verifies the structured Peninsula card, filters, footer, Details navigation and dates; it is a focused test, not a claim that the entire UI suite ran.
- Native distribution: Apple accepted **1.0 (7)** at **12:18:41 PM, October 23, 2026, America/New_York**. The console confirmed `Uploaded Restroom Ready` and `EXPORT SUCCEEDED`. Pre/post-build checks verified the strict deep signature, expected team/bundle/build, all 29 SDK privacy manifests, the app's own dSYM and six source hashes. The temporary LaunchOnlyOnce desktop service automatically removed itself; independent readback confirmed the service and three job files were absent. Existing nonblocking prebuilt-SDK dSYM warnings remain.
- Apple processing finished. [Build 7 in App Store Connect](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/a1989d00-19f7-41e7-adca-418326fe4499) is **Testing** in the existing **4995** and **Team** groups. The user approved enabling both groups; both assignments were verified. [Dashboard evidence](screenshots/native-testflight-build7-testing.jpg) records the result. No testers were added and membership stayed unchanged. Eligible existing testers can update through TestFlight; device installation remains unverified.
