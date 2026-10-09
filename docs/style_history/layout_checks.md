# Restroom Ready — Layout checks

Checked October 9, 2026, in a desktop Chrome browser using phone-width viewports. The supplied B/E/F shortlist layouts were rendered with the current style rules and selected R tile lockup applied in temporary previews. The source HTML was preserved and no HTML was added to the submission.

## Results

| Check | B — Inspection checklist | E — Porcelain tile | F — Night map |
| --- | --- | --- | --- |
| 320, 390, 768, and 1280 px widths | No horizontal page overflow. | No horizontal page overflow. | No horizontal page overflow. |
| Phone layout | Entry, Route, and Condition stack in order. | Label–value rows stack; dotted leaders disappear. | Copy precedes the map; the listing card grows in normal flow. |
| 200% text size at 320 px | No horizontal page overflow. | No horizontal page overflow. | No horizontal page overflow. |
| Main action | 44 px high. | 45 px high. | 46 px high. |
| Keyboard entry | Skip link receives focus with a visible 3 px outline. | Skip link receives focus with a visible 3 px outline. | Skip link receives focus with a visible 3 px outline. |
| Typography | IBM Plex Sans and IBM Plex Mono loaded. | Karla and Newsreader loaded. | Manrope and JetBrains Mono loaded. |
| Selected logo | Light-use lockup appears in the header. | Light-use lockup appears in the header. | Dark-use lockup appears in the header. |

The visual inspection checked that headings, actions, example labels, fact values, and unknown fields stayed readable in the phone-width screenshots. The contrast calculations are recorded in the style guide.

## Adjustments recorded in the guide

- Use blue for B's main action and kicker; keep red for actual form errors.
- Give E's unknown value the same readable supporting-text contrast as its field labels.
- Keep F's mobile card in normal flow, and stack its field labels and values so longer text has room.
- Keep the main action at least 44 px high and let header items wrap rather than shrinking them.
- Replace B's checkmarks with neutral report symbols in the preview; the examples do not establish verification.

## Saved views

| Direction | Phone, 390 px | Desktop, 1280 px | 200% text, 320 px |
| --- | --- | --- | --- |
| B | [Phone](checks/b-mobile.png) | [Desktop](checks/b-desktop.png) | [Larger text](checks/b-text-200.png) |
| E | [Phone](checks/e-mobile.png) | [Desktop](checks/e-desktop.png) | [Larger text](checks/e-text-200.png) |
| F | [Phone](checks/f-mobile.png) | [Desktop](checks/f-desktop.png) | [Larger text](checks/f-text-200.png) |

Measured widths, action sizes, headings, loaded fonts, and focus details are in [layout_results.json](checks/layout_results.json).

These checks cover static design previews and browser phone-width emulation. They do not test a working waitlist, venue database, live map, assistive technology, or a physical phone. Repeat the relevant checks on the Next.js implementation when it exists.
