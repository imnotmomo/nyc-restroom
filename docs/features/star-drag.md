# Drag directly across rating stars

Status: Verified; publishing
Date: October 16, 2026

The rating gesture belongs on the five stars themselves. Remove the separate visible range track, thumb and endpoint labels from the shared control used by both the finder and demo. Drag or tap a star's left/right half to choose its half/full score, bounded to 1–5. Keep half fills and the numeric selection visible. Preserve an unrated state, explicit Submit/Update/Remove, disabled/auth states, keyboard arrows in 0.5 steps and Home/End.

The UI author owns only the shared component and its CSS. An independent reviewer checks the plan, source and compiled mouse/touch/keyboard interaction; root owns integration and publication. Check exact star-half mapping, drag capture outside the stars, cancellation, no focus-only selection, disabled controls, no visible separate bar and phone layout. The existing half-star model, SDK, Firestore rules and save flow stay unchanged; their prior verification is recorded in [the half-star release](rating-slider.md).

The independent reviewer approved the plan and frozen two-file diff. The shared control keeps a transparent native range directly over the five 44px star cells for keyboard and assistive technology, with custom half-cell pointer mapping. Pointer capture follows drags outside the stars and clamps the result; up, cancel, lost capture, blur and disable clear the drag. Secondary and concurrent pointers cannot take over.

Production TypeScript/static export/Worker build and whitespace checks passed. Root inspected the compiled layout, dragged directly across the stars to 3.5 and submitted the demo vote successfully.

All seven independent compiled-browser groups passed: all nine half-step hit targets, captured mouse drag and endpoint clamping/release, secondary-button guard, genuine touch drag without page scroll, touch cancellation, null/focus/keyboard semantics, explicit demo submit/remove and the existing passcode ownership examples. An isolated bundle of the actual real rating wrapper confirmed auth gating, disabled pointer/keyboard locks and Submit/Remove callbacks with normal null-state reset, without initializing Firebase. The 320/390px screenshots show the direct-star strip and no separate bar. Maya approved the control with no blocking findings. See [browser evidence](star-drag-browser-checks.json) and `screenshots/star-drag-{320,390}.png`.

These UI checks made no Firebase requests or API mutations. The previously verified backend and atomic half-star save rules were unchanged. Publication and post-release verification follow.
