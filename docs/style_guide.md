# Restroom Ready — Style Guide

We narrowed the six page directions to **B — Inspection checklist**, **E — Porcelain tile**, and **F — Night map**. The [Round 1 exploration](style_history/round1.md) keeps the earlier options for comparison.

The focus is layout, hierarchy, cards, navigation, and clear actions. B, E, and F remain the three directions for comparison. The rules below give each one a concrete specification; use one direction consistently within a page. The selected logo stays the same across all three. All sample listings below are illustrative and do not describe real places.

## Reference notes

These references support the implementation rules below. They focus on how information is arranged and how someone moves through a page. References checked October 9, 2026.

| Site or app | What we take from it | Use in Restroom Ready |
| --- | --- | --- |
| [GOV.UK Design System — summary lists](https://design-system.service.gov.uk/components/summary-list/) | Labeled fact rows, separating rules, and a clear relationship between a value and its action. | Keep Entry, Route, and Condition separate. Use label–value rows for individual facts and place report details beside the fact they describe. |
| [Apple Maps — place cards](https://www.apple.com/maps/) | A map provides context while a place card brings together the details needed to choose a destination. | F pairs the map with a readable listing card. The card holds restroom-specific facts; the map does not replace them. |
| [NYC311 — Public Restrooms](https://portal.311.nyc.gov/article/?kanumber=KA-03643) | A short explanation, a direct link to finding a restroom, and a separate section for maintenance issues. | Give the page one clear main action. Keep finding a place and reporting a condition as distinct tasks. |

The six initial directions and keep/drop notes are in [Round 1](style_history/round1.md). The supplied shortlist page is the reference for the B/E/F layouts. Its HTML stays in the local source folder; this guide and the [layout check record](style_history/layout_checks.md) are the submission files.

## What we kept

| Direction | Why it stays | Typography | Structure |
| --- | --- | --- | --- |
| B — Inspection checklist | Makes evidence and unknown details visible. | IBM Plex Mono / IBM Plex Sans | A bordered listing sheet with Entry, Route, and Condition checklists. Dashed boxes show unknowns. Columns stack on mobile. |
| E — Porcelain tile | Feels calm and precise, with each fact kept separate. | Newsreader / Karla | A serif headline and listing sheet with dotted leaders connecting labels to values. |
| F — Night map | Shows the proposed product, helping explain what the waitlist is for. | Manrope / JetBrains Mono | Hero copy beside a map preview and floating listing card. The two-column layout stacks on mobile. |

## What we dropped

| Direction | Reason |
| --- | --- |
| A — Transit signage | Read too close to subway signage. |
| C — Soft calm | Felt spa-like and slow for someone in a hurry. |
| D — Civic poster | Felt too loud for a moment when someone is uncomfortable. |

## Shared hero

- Tagline: **Know before you go.**
- Headline: **Find a restroom you can use in NYC.**
- Main action: **Join the waitlist.**

## Shortlisted page content

### B — Inspection checklist

**Hero copy:** Visitor-reported conditions, entry rules, and the route inside, each with when it was reported and who reported it.

**Example listing: Corner café · Chelsea**

| Group | Illustrative details |
| --- | --- |
| Entry | Purchase required; code on receipt; restroom hours not reported. |
| Route | Restroom floor one level down; stairs to restroom yes; elevator not reported. |
| Condition | Soap reported; toilet paper reported; floor not reported. |
| Footer | Last reported: example date and example visitor counts. |

### E — Porcelain tile

**Hero copy:** Visitor-reported conditions, entry rules, and the route to the restroom. Every detail shows when it was reported, and what's still unknown says so.

**Example listing: Bookshop, Upper West Side**

| Detail | Example value |
| --- | --- |
| Entry | Customers only |
| Restroom floor | Second floor |
| Stairs to restroom | One flight |
| Elevator | Not reported |
| Soap · paper | Reported |
| Last reported | Example date |

### F — Night map

**Hero copy:** A map of visitor-reported conditions, entry rules, and the route inside. Check the details before you walk over.

**Example listing: Library branch**

| Detail | Example value |
| --- | --- |
| Entry | Public |
| Restroom floor | Street level |
| Stairs | None reported |
| Condition | Soap, paper reported |
| Last reported | Example date |

## Color

Use the column for the direction being built. The logo tile is always **#2B59C3**, including in F; amber is F's action color, not a replacement logo color.

| Token | B — Inspection checklist | E — Porcelain tile | F — Night map | Job |
| --- | --- | --- | --- | --- |
| `ink` | #1E2A30 | #172A4F | #ECEBF5 | Headings, body text, and main facts. |
| `ink-faint` | #56666E | #5B6B88 | #B7B5CC | Supporting text, source details, and “Not reported.” |
| `background` | #EEF2F3 | #FBFCFD | #181A2C | Page ground. |
| `surface` | #FFFFFF | #FFFFFF | #23253C | Listing cards and forms. |
| `accent` | #2B59C3 | #2B59C3 | #F2A541 | Main action, links, and selected controls. |
| `accent-ink` | #FFFFFF | #FFFFFF | #181A2C | Text on a filled accent button. |
| `tint` | #D9E3E8 | #E4E9F0 | #2C3050 | Decorative grid lines and map texture. |
| `border` | #56666E | #5B6B88 | #7D82A3 | Control edges and meaningful separators. |
| `divider` | #9FB0B8 | #C9D3E2 | #3A3D5C | Decorative dividers that do not carry meaning alone. |
| `error` | #B8352B | #B8352B | #FF9A8A | Form errors, paired with a written explanation. |

- Give each saturated color a job. Keep neutral facts neutral; use the accent for an action or selection.
- Reserve red for errors. B's earlier red kicker and “Example listing” badge become blue and a neutral outlined badge respectively.
- E's original pale unknown value becomes `ink-faint` so it remains readable. An unknown field is never faded into the background.
- Grids are decorative. Keep B's 24 px paper grid and E's 64 px tile grid behind content; fact sheets use a solid surface. F's map texture stays behind the card.
- Page theme is not a reason to select a direction. Keep the same hierarchy, fact grouping, and actions when comparing light and dark surfaces.

## Type

Use at most two site font families in one direction. The supplied outlined logo is a separate asset and needs no installed wordmark font. Use sentence case for headings and buttons; only short group labels may use capitals.

| Role | B | E | F |
| --- | --- | --- | --- |
| Main heading | IBM Plex Mono, 600; `clamp(28px, 4.6vw, 44px)`; line height 1.1 | Newsreader, 400; `clamp(36px, 6vw, 62px)`; line height 1.04 | Manrope, 800; `clamp(32px, 5vw, 50px)`; line height 1.1 |
| Section heading | IBM Plex Sans, 600; 24 px; line height 1.25 | Newsreader, 600; 28 px; line height 1.2 | Manrope, 800; 24 px; line height 1.25 |
| Listing title | IBM Plex Sans, 600; 18 px | Newsreader, 600; 22 px | Manrope, 800; 18 px |
| Body and fact values | IBM Plex Sans, 400; 16 px; line height 1.5 | Karla, 400; 16 px; line height 1.5 | Manrope, 400; 16 px; line height 1.5 |
| Supporting copy | IBM Plex Sans, 400; 17 px | Karla, 400; 17 px | Manrope, 400; 17 px |
| Field labels and report details | IBM Plex Mono, 400 or 600; 14 px; line height 1.5 | Karla, 400 or 600; 14 px; line height 1.5 | JetBrains Mono, 400 or 600; 14 px; line height 1.5 |
| Buttons | IBM Plex Mono, 600; 16 px | Karla, 600; 16 px | Manrope, 800; 16 px |

Keep body copy within **60 characters per line**, with hero copy within 54. Do not force headline line breaks that only work on desktop. Use `rem` for text sizes and allow browser zoom. Sans-serif fallbacks are `system-ui, sans-serif`; mono fallbacks are `ui-monospace, monospace`; E's serif fallback is `Georgia, serif`.

## Space and layout

- **Content width:** 1080 px maximum, centered. Use 16 px side gutters below 480 px, 24 px from 480–719 px, and 32 px from 720 px upward.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, and 64 px. Use 64 px between desktop sections and 40 px on small screens.
- **Header:** mark and wordmark at the left, one main action at the right when it fits. Wrap the action below the logo rather than shrinking the name or tap target. Use the standalone mark where a readable full lockup will not fit.
- **B:** hero copy and action sit beside each other at 720 px and above, then stack. The fact sheet has three equal columns for Entry, Route, and Condition above that breakpoint; on smaller screens the groups stack in that order. Use 16 px card padding and 24 px around the sheet on mobile.
- **E:** keep the headline above the fact sheet. Limit the sheet to 620 px. Use 24 px card padding on desktop and 16 px on mobile. Label–value rows become label-over-value below 480 px; remove dotted leaders there.
- **F:** use a `1.1fr / 1fr` hero split with a 28 px gap from 720 px upward. Stack copy, action, and map preview on smaller screens. The map stage is at least 300 px tall on desktop and 320 px on mobile. The listing card uses normal flow on mobile so growing text cannot run off the map.
- Give grid children `min-width: 0`. Wrap long names and values; do not truncate entry restrictions, route details, or unknown fields.

## Components

### Buttons, navigation, and links

- Buttons are at least **44 px high and 44 px wide**, with 12 px vertical and 20 px horizontal padding. Use a 2 px radius in B, square corners in E, and an 8 px radius in F.
- B and F use a filled `accent` main button with `accent-ink` text. E uses an outlined main button with `ink` text and border; its hover state fills with `accent` and uses `accent-ink` text.
- Secondary actions are outlined or plain underlined links. Do not put two filled main actions beside each other.
- Use one clear main action per section. “Join the waitlist” is the proposed landing-page action. A prototype must not imply it has submitted an email unless a real form handler exists.
- Links use the direction's accent and remain underlined in body copy. Use real anchors for navigation and buttons for actions.
- Focus uses a visible 3 px accent outline with a 3 px offset. F uses amber focus so it stays visible on the dark surface. Hover alone never carries an instruction.

### Listing cards and fact rows

- B uses a 1.5 px ink border and a 2 px radius. E uses a 1 px `border` rule and square corners. F uses a 1 px `border` rule and a 12 px radius. Cards have solid surfaces and no decorative shadows.
- Keep **Entry**, **Route**, and **Condition** as separate groups. Use at least 8 px between facts and 16 px between groups.
- Each fact has a clear label and value. Use a semantic description list for label–value rows. Use a table only when someone is comparing the same fields across listings.
- Show **“Not reported”** as normal-size, contrasting text, with an optional dashed border or question mark. A missing report is not “No.”
- Reported facts need their own source and observation time. Store and show submission time separately. A new soap report must not make an old route report appear new.
- Conflicting reports remain visible with their dates. Do not replace them with a green check or a certainty score.
- Label every illustrative card **“Example listing.”** Examples do not become live venue data when the design is implemented.

### Icons, lists, and forms

- Use Lucide outline icons, 20 px with a 2 px stroke; do not mix icon libraries or use emoji as controls. Keep labels beside icons. A checkmark never means a restroom has been independently verified.
- Noninteractive report symbols may be smaller than 44 px; their surrounding button must meet the tap-target minimum if clickable.
- Use plain bullets for explanations. Comparison tables have left-aligned headings, visible row separators, and wrapping values. On mobile, use labeled cards when columns would require sideways scrolling.
- Forms use persistent labels, 16 px text, at least 44 px control height, and an error message beside the field. Use `error` for the message and border, with `aria-describedby` connecting them. Keep entered information after an error.

## Imagery

Use the listing itself to explain the product. F's map is a labeled illustration in a prototype; it does not establish real locations, routes, or citywide coverage.

Real venue photos must have a source, an observation date where known, and permission to use them. Show the doorway, internal route, stall, or sink detail being described. Do not use a generic bathroom photo as evidence for a listing. A photo cannot establish current cleanliness.

For an explanatory illustration, use simple flat lines and the chosen direction's palette. Avoid photorealistic generated restrooms, stock people pretending to be customers, and decorative imagery that hides the facts. Alt text describes what is actually visible; decorative grids use no descriptive alt text. A logo next to a visible product name can be decorative; a standalone home link needs the accessible name “Restroom Ready home.”

### Illustration prompt

```text
Flat line illustration for Restroom Ready. Use the chosen style-guide palette,
one consistent outline weight, and a plain background. Keep room for readable
fact labels. No photorealism, fabricated venue details, ratings, or testimonials.
Scene: [the specific task or internal-route detail to explain].
Label any example map or listing as an illustration. Do not imply live coverage.
```

## Accessibility floors

- Body text, labels, and metadata must meet **4.5:1** contrast against their actual surface. Meaningful control outlines and icons must meet **3:1**. Decorative grid lines can be lighter.
- Use a visible focus state, 44 px tap targets, a skip link, and logical keyboard order. A map must have an equivalent list of places and facts.
- Use one page `h1`, section `h2`s, and listing `h3`s. Match the source order to the reading order when columns stack.
- At 320 px width and at 200% text size, facts, actions, and the logo must remain readable without horizontal page scrolling or overlap.
- Pair state color with words or a distinct shape. “Not reported,” “Purchase required,” and errors remain understandable without color.
- Respect reduced-motion settings. Avoid automatic map motion or animated decoration.

Calculated contrast for the specified pairs:

| Pair | Ratio |
| --- | --- |
| B ink on page background | 13.04:1 |
| B supporting text on white card | 5.96:1 |
| E ink on page background | 13.81:1 |
| E supporting text on white card | 5.38:1 |
| F ink on page background | 14.53:1 |
| F supporting text on card surface | 7.49:1 |
| White button text on brand blue | 6.33:1 |
| F dark button text on amber | 8.37:1 |
| F control border on card surface | 3.99:1 |

These ratios check the palette, not an implemented app. Layout results and their scope are recorded in [the browser check notes](style_history/layout_checks.md).

## Never

- No green “accessible” badge based on an entrance photo or an incomplete route report.
- No faded unknowns, color-only states, tiny report dates, or essential information hidden on hover.
- No invented live counts, cleanliness guarantees, testimonials, or unlabeled venue examples.
- No mixing B/E/F fonts or component treatments in the same page without recording the change.
- No theme choice taking precedence over readable facts and a clear main action.

## Selected logo

The selected logo for **Restroom Ready** is **03 — R tile**: a blue rounded square with a white uppercase R from the [Round 1 concept](../brand/logo/round1/concept-03.svg). The [Round 1 overview](../brand/logo/round1/overview.svg) keeps the earlier ideas for reference.

The pin-and-door direction makes location explicit but resembles a general map marker. The checked-pin direction could suggest verification that our reports do not provide. The R tile gives the working name a simple identifier without adding a cleanliness or accessibility promise. The export set includes a separate small-size adaptation for favicon use.

The wordmark uses **Avenir Next Demi Bold**, with lettering converted to outlines in the SVG exports. This applies to the logo; site typography follows the selected page direction’s font pair above.

| Asset | File |
| --- | --- |
| Standalone mark | [mark.svg](../brand/logo/mark.svg) |
| Restroom Ready wordmark | [wordmark.svg](../brand/logo/wordmark.svg) |
| Horizontal mark and name | [lockup.svg](../brand/logo/lockup.svg) |
| Stacked mark and name | [stacked.svg](../brand/logo/stacked.svg) |
| Square mark | [square_mark.svg](../brand/logo/square_mark.svg) |
| Light-background variant | [logo_light.svg](../brand/logo/logo_light.svg) |
| Dark-background variant | [logo_dark.svg](../brand/logo/logo_dark.svg) |
| Black variant | [logo_black.svg](../brand/logo/logo_black.svg) |
| White variant | [logo_white.svg](../brand/logo/logo_white.svg) |
| Avatar | [avatar.png](../brand/logo/avatar.png) |
| Preview sheet | [preview.svg](../brand/logo/preview.svg) |

### Logo rules

- Use **#2B59C3** for the tile and **#FFFFFF** for the uppercase R. The wordmark uses **#1A1D24** on light backgrounds and **#FFFFFF** on dark backgrounds; the tile and R colors stay the same.
- Black and white variants use a solid **#000000** or **#FFFFFF** tile with a transparent R cutout and a matching one-color wordmark.
- Keep the standalone mark at least **16 px**. In a horizontal lockup, align its visible height with the wordmark's capital-letter height.
- Leave at least **one quarter of the tile width** as clear space around the artwork.
- Keep the tile, letter proportions, and spacing from the supplied assets. The source tile is **38 × 38 SVG units**, positioned at **5, 5**, with a **10-unit corner radius**. The final mark uses the cropped viewBox **3 3 42 42**. Scale the whole asset together.
- At 16 px, use [mark_16.svg](../brand/logo/mark_16.svg), with a **5-unit R stroke**. Larger exports use the original **4.5-unit stroke**.
- Favicon and app-icon exports cover **16, 32, 48, 180, 192, and 512 px**. File details are in [logo/README.md](../brand/logo/README.md).

## Comparison after implementation

- **B:** whether the dashed unknown fields are clear, and whether monospace labels work better in listings than in the headline.
- **E:** whether the tile treatment helps, and whether the serif headline feels too formal.
- **F:** whether leading with the map makes the product easier to understand, and whether the listing card is easy to scan.

The three directions remain available for later testing, as the guide allows. Use the specifications above for each comparison and change one variable at a time. Keep the selected R tile and the same listing facts across all versions. Record any new decision here so future pages use the same rules.
