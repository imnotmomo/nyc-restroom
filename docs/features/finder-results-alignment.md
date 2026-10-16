# Finder results header alignment

Status: Ready for release

Removing the starting-point block left the sort dropdown and result count in separate rows. Combine them in one compact row: count on the left, sorting on the right, both vertically centered. The optional GPS distance caption sits below only when a location exists. Use scoped header classes so the public demo layout stays unchanged. Sorting, location behavior and access protection stay as implemented.

The independent reviewer approved the plan. Root owns the two-file markup/CSS edit. Verify the compiled layout at desktop and 320/390px, including the GPS caption, without repeating unrelated product flows or adding new tests.

The production TypeScript/static build and Worker packaging passed. Independent compiled-browser measurements show a 0px difference between the count and select vertical centers at 1280px, 320px and 390px, with no overlap or horizontal overflow. The scoped markup/CSS diff passed review without changing sorting or access behavior.

The GPS caption was confirmed below the aligned toolbar with Distance selected; the public demo's existing header remains unaffected. Evidence: `finder-results-alignment-browser-checks.json` and `screenshots/finder-results-aligned-390.png`. No blocking findings remain.
