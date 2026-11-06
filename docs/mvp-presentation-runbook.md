# October 23 MVP presentation

The goal is to show how research changed Restroom Ready and demonstrate one person choosing a restroom before committing to a walk. The [current rubric](https://github.com/kenxle/columbia-startup-studio-fall-2026/blob/main/classes/20261023_c7w7_fri_mvp-presentations/midterm-rubric.pdf) allows **7.5 minutes to present and 7.5 minutes for questions**. The presentation is worth 10% of the final grade. Every team member must be present and present.

## Audience and research story

Audience: **NYC residents and visitors deciding which restroom to use in an unfamiliar neighborhood.** The demo follows Joslyn, an illustrative woman using a wheelchair on Fifth Avenue. This scenario explains a route decision; it is not an interview, a completed customer test or evidence of certified wheelchair accessibility.

Suggested problem statement: **A nearby restroom pin does not tell someone whether they can enter, reach the restroom, or use it. Finding out at the door can mean another walk, a purchase or changed plans.**

Suggested research-to-decision explanation:

> We began with finding the nearest restroom on campus. Our interviews showed that a location alone does not settle the decision. One participant tolerated dirty bathrooms but was stopped by locked doors. Another left a downstairs bathroom because she was carrying a suitcase. We focused our first workflow on checking the details before committing to the walk.

Use the eight retained interviews, C01/C02/C04/C05/A01/A02/A04/A05. C03 and A03 are excluded from current customer evidence even though their files remain in the research folder. Maya, Chloe and Alex are fictional composite personas; their reviews are not interviews or customer tests.

| Evidence | Source | Product reasoning |
| --- | --- | --- |
| Original campus idea was a nearest-restroom map. | [HW2.2, Finding Restrooms on Campus](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw2.2-design-work/design_work.md) | Explain the starting assumption before describing the change. |
| C01: “The dirty ones don't stop me. The locked ones do.” | [C01, Q6](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw3-interviews/raw_notes/C01.md) | Entry restrictions are separate from cleanliness. This contradicted a cleanliness-first assumption. |
| A02 left a downstairs restroom with luggage, tried another venue and estimated 10–15 minutes lost. | [A02, Q4–Q6](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw3-interviews/raw_notes/A02.md) | The route inside matters even when a person can enter the business. This is her estimate, not a measured delay. |
| C02 rejected poor conditions and arrived about ten minutes late after searching again. | [C02](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw3-interviews/raw_notes/C02.md) | Specific usable conditions can change the choice; stars alone do not establish conditions today. |

## Slides and speaking allocation

The rubric requires title, team, problem, solution and a live workflow. Suggested five-person allocation below is a rehearsal plan, not a statement of past contributions. Assign the actual names together.

| Time | Owner | Content |
| --- | --- | --- |
| 0:00–0:35 | Speaker 1 | Title: Restroom Ready. One-liner: “Check the restroom details before you walk.” Team slide with all names and headshots; roles optional. |
| 0:35–1:35 | Speaker 2 | Initial assumption, C01 contradiction and A02's concrete incident. Use two quotes/observations with anonymous interview IDs. |
| 1:35–2:15 | Speaker 3 | Name NYC residents and visitors, the unfamiliar-neighborhood situation, root problem and change in direction. Introduce the illustrative Fifth Avenue scenario. |
| 2:15–2:45 | Speaker 4 | Solution: separate entry, route, condition and evidence/date. State what the current prototype can demonstrate. |
| 2:45–6:30 | Speaker 5 narrates and operates; Speaker 4 introduces the handoff | Complete the real-app workflow below. Tie every action to the person's decision. |
| 6:30–7:15 | Speaker 1 or 3 | Real test and resulting change if completed; otherwise state the next test honestly. Name the current data limit and the next product decision. |
| 7:15–7:30 | All | Buffer; finish before the timer. |

Prepare the deck in the required order. Keep detailed interview notes, data provenance, current scope and actual demand results in backup slides for Q&A. Technical stack and feature lists do not need main-slide time unless they explain a user decision.

## Live workflow in the native iPhone app

Use the installed, rehearsed TestFlight build on the presenting iPhone. Test screen mirroring with the actual laptop/projector before class. The web workflow below remains a backup.

1. Start on the map near Fifth Avenue. Say: “Imagine Joslyn using a wheelchair here. Before choosing a restroom, she needs to know the route from the street.” Pan the map to the prepared Fifth Avenue area.
2. Open Filters, select **Accessible** and **Stair Free**, then Done. Explain: “Accessible is a reported status. Stair Free needs an explicit report of the whole route.” Keep Clean, Public and Elevator access unselected for this story.
3. Open **The Peninsula**. Say: “The contributor reports 24/7 restroom hours. The step-free doors are on the right side of the main entrance. Take the elevator, choose Penthouse, and reach the 23rd floor with zero stairs after entry.” Show the report source/date. Entry permission and the actual observation date remain unknown; the report does not guarantee current operation or stall suitability.
4. Tap **Directions** to open Apple Maps. Say: “Now Joslyn has enough route information to decide whether to head there.” Do not imply Directions supplies indoor navigation.
5. Return to the app and explicitly move the story forward: “For the next part, imagine Joslyn has returned after using the restroom and found it clean.” Open **Details & reports** to show where a **five-star cleanliness rating** is selected. If Google Sign-in is needed, use Account or the prompted Google action and return to this place. A presenter may submit only a rating based on their own real visit; otherwise explain the hypothetical rating without publishing it.
6. Return to the place card, tap the **bookmark**, then open **Account → Saved** to show how someone keeps the place for later. Sign in with Google first if needed. Saving does not claim a visit or verify any venue fact.

The whole-star rating correction is tracked in [the native rating record](features/native-rating-save.md). A successful archive or upload does not prove installation or a real signed-in iPhone submission. Confirm the final installed version and retry the user's intended real rating before choosing it for the live demo.

Keep a charged phone, laptop, their chargers and the tested display adapter/cable ready. Save a short recording of the actual final workflow and the slide export locally as a network/display backup. The presentation should still plan a live workflow.

## Web fallback workflow

Present [the real NYC finder](https://nyc.imfinethanku.me/find/) and the same Fifth Avenue story. Open [The Peninsula](https://nyc.imfinethanku.me/find/?place=community-7398fe084d3d87eed23c), read its structured hours/entrance/route report and source date, and open walking directions. The web row currently selects one filter at a time; show Stair Free and Accessible separately. Web directions open Google Maps. A fixed place link does not need GPS.

For the hypothetical return visit, use the web cleanliness-rating control only for an actual personal observation; otherwise describe it without submitting. Google Sign-in enables Save and account-owned contributions. Do not publish a fictional five-star vote, visit report or code check.

Keep the slides and web fallback open before presenting. A place link/search is the fallback if browser geolocation is denied. Sign in before the live segment if saves or reporting are planned; live OAuth is not necessary to prove the public lookup.

Keep marketing tours, all filters, ownership settings and Analytics for Q&A unless one directly supports the user's task. Prepare a recording/screenshots of the actual final app as a network backup, while planning a live workflow as required by the rubric.

## Remaining presentation needs

These tasks require the team, a real participant, or physical equipment. Application checks do not mark them complete.

The rubric explicitly requires the presentation structure, all members presenting, the time limit and a working live workflow. Additional participant task tests, venue inspections and demand results below are evidence/preparation opportunities, not separate mandatory submissions stated in that rubric. The professor's later message specifically recommends group rehearsal and trying the room's projector.

- [ ] Agree on the single pilot audience and problem statement; every speaker can repeat them consistently.
- [ ] Make the title, team/headshot, research/problem, solution and demo slides. Add a backup source/limitations slide.
- [ ] Assign every speaking segment and Q&A topics; all five people speak and understand the main workflow.
- [ ] Select two interview examples from the eight retained records and explain one assumption that changed. Keep quotes exact and participant IDs anonymous.
- [ ] Run at least one real task with someone in the chosen audience. Record what they actually did, a point of confusion and what changed afterward. Do not call a persona simulation, future invitation or team rehearsal a customer test.
- [ ] Inspect two or three real places in the chosen neighborhood if making current venue claims. Record actual observation date and sources; do not fill app fields with guesses or equate imported codes with successful use.
- [ ] Test Google login → save a real existing place → reload → Saved, on the exact presenting app/device if this appears in the talk. Stay signed in for the live portion.
- [ ] Test phone location allowed and denied, map/list, touch, keyboard and external directions if presenting on a phone. Keep the fixed-location link/search ready regardless of GPS.
- [ ] Rehearse the entire group presentation below 7.5 minutes, including handoffs and switching between slides and the real finder. Repeat after fixing observed problems.
- [ ] Visit the room with the presenting laptop, adapter and charger. Test projector connection, display mode, text size, browser zoom, Wi-Fi and directions opening in a new tab.
- [ ] Capture a short backup recording and screenshots of the exact final workflow. Save local copies and a deck export; use Do Not Disturb and close unrelated tabs/private account details.
- [ ] Bring actual traffic/signups only if discussing demand. Distinct stored emails count unique leads; team/setup traffic is not adoption. The recorded 50 sessions/five emails are goals. Finish the Facebook permalink/destination and campaign result record if presenting outreach.
- [ ] Check CourseWorks for any separate deck/MVP submission instructions and upload requirements; the linked rubric specifies presentation structure, not a slide filename.
- [ ] After midterms, complete the individual team-contribution assessment when released. The professor's message gives until Tuesday, October 27; verify the exact submission time in the released assignment.

## Q&A preparation

| Likely question | Answer boundary and evidence |
| --- | --- |
| Why use this instead of Google Maps? | Show the particular entry/route/evidence decision in the workflow. Do not claim other maps never contain restroom information. |
| What changed after interviews? | Use C01's cleanliness contradiction and A02's route incident; connect them to the separate entry/route display and narrowed use occasion. |
| Why this audience? | Name the situational first pilot and the supporting accounts; eight retained records are not a market-size estimate. |
| Are these reports current and verified? | Separate dated city data, public community/source reports, actual visit observations and sample facts. Submission/import time is not inspection time. |
| How will you keep data useful? | Show the structured dated visit reports already implemented, then explain the next test: whether real visitors contribute useful updates. Private notes and public stars stay separate. |
| How do you know people will contribute or return? | Use an actual completed test or usage record if available. Interview interest and willingness are not demonstrated retention or contribution. |
| What is implemented? | The native iPhone app and web finder include map/search, directions, accounts, saves/private notes, structured public visit reports, ratings, submitted places and independent codes. Only demonstrate signed-in actions already rehearsed on the exact installed build. No certified accessibility, live occupancy or guaranteed current opening. |
| What will you build next? | Choose based on observed user difficulty. Test the existing public reporting flow with genuine visitors before deciding whether freshness reminders, correction handling or another change is needed. |

## Verification record

See [MVP demo readiness](features/mvp-demo-readiness.md) for app checks, screenshots and release status. Use the released real-finder URL and exact checked places. Physical rehearsal, a real Google sign-in and target-user testing remain pending until the team records them.
