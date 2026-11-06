# On-device visitor report summary

Current behavior is defined by [public anonymous visit notes](public-visit-notes.md) and [code reporting](native-code-reporting.md). Those newer requests supersede the historical private-note, all-reports AI gating and grouped Passcodes placement recorded below. Passcodes now sits under Amenities; only the short AI summary depends on Apple Intelligence. Build **1.0 (12)** is Testing in both requested internal groups, **4995** and **Team**. See [the distribution record](native-testflight.md) for normal/largest-text checks and exact release evidence.

The latest request restores a compact dated Condition row below Passcodes on every device. That row uses structured visitor observations, while the separate optional AI summary keeps the availability and privacy rules below. Rate and Comment now groups ratings in one section and public notes/visit details in another.

Status: implementation and verification in progress, October 23, 2026.

The user replaced the former Conditions overview with a short Visitor reports summary generated through Apple's on-device Foundation Models framework. They explicitly requested that the entire visitor reports interface be hidden when Apple Intelligence is unavailable or disabled. This applies to the native app; the website and stored reports are unchanged.

## Accepted plan

- Use the system on-device model only. Check availability and English support before generation and again before publishing. Recheck after returning from Settings or the background. Unsupported devices, older systems, disabled Apple Intelligence and unavailable model assets hide the summary, visitor destination and contribution action. No settings prompt or cloud fallback.
- Keep the existing bounded latest-ten public report feed and exact place IDs. Use only strictly validated public structured observations. Do not supply account identities, coordinates, venue names, free text, private notes, passcode values or Analytics to the model. Nothing is saved or logged by the summary feature.
- Use guided generation to select one or two eligible highlight topics. The app renders controlled wording from the exact report counts. A chosen topic includes conflicting answers together, omits unknown answers and never establishes a current condition, route, accessibility, opening status or access guarantee. Invalid selections fail rather than guessing. The model chooses the summary highlights; unconstrained generated claims are not displayed.
- Deterministic captions identify the observed time range, report count and on-device AI summary. The full original reports retain their separate observation and submission dates. Empty, loading and failed feeds have distinct programmatic states. Generation failure leaves the full reports reachable while the model remains available.
- Use a fresh session per snapshot. Cancellation and generation/snapshot guards discard stale replies after report edits/removals, account changes, another place, backgrounding or closing. Public report facts used independently in Entry & route remain intact.
- The user subsequently moved the rating editor and visit-note actions off the main card. Group the Rate and Comment link with Passcodes and Details & reports below the static information rows. The Visitor reports summary heading is static; full reports remain available through Details. Its dedicated native destination contains the empty-star editor, conditional Submit, saved-rating management, private visit notes and the eligible-device public Share a visit action. The main heading retains the public average. Private notes remain private and never enter the model. Remove duplicate private-note and rating management from Details.

The independent reviewer approved the plan before implementation. A source-only Chloe persona simulation approved the factual boundaries, deterministic dates/counts, on-device label and original-report access. This is a design review, not a customer interview.

## Files and checks

The coordinator owns `Models/VisitorReportSummary.swift`, `Services/OnDeviceVisitorSummary.swift`, the detail view integration and project guidance. The native implementation agent owns the independent pure summary tests and focused UI verification. A separate reviewer checks the integrated source and screenshots. No Firebase rule, data schema, dependency, entitlement or production data change is needed.

The installed Xcode 26.2 SDK was checked directly: use `GenerationOptions(sampling: .greedy)` and `respond(to:schema:options:)` with a dynamic generation schema, rather than newer online API spelling. Constrain the enum to this snapshot's eligible topics and cap its array at the smaller of two and the eligible topic count. The app's existing older-system support remains; availability guards hide this feature there. The Mac Studio simulator may lack compatible Apple Intelligence assets, so simulator compile/visibility checks alone do not prove successful iPhone inference.

Actual host testing caught a static-schema defect: a wider eight-topic enum repeatedly selected condition and soap even for single-topic input. The controller correctly rejected these unsupported selections and displayed no invented text. The final implementation constrains decoding to the input's actual eligible topics rather than relying on instructions alone. This correction is being checked against the same actual-engine cases before the native build.

References: [Apple availability](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/availability-swift.property), [guided generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation), [supported locale](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/supportslocale(_:)), [Apple staff on simulator model versions](https://developer.apple.com/forums/thread/787445).

Final source, tests, screenshots and release evidence will be added after verification. Internal distribution remains Team only. No Git commit or push is included.

## Latest verification

All 92 pure model tests passed, including 24 new snapshot and async controller checks. They cover strict enum/date validation, exact-place scoping, deduplication and the latest-ten bound, conflicting counts, prompt privacy, unavailable/empty/error states, cancellation, stale generations and availability loss before publication. These injected-engine tests do not claim real model execution.

Separately, the actual frozen dynamic Apple engine and pure controller compiled and ran on the Mac Studio host. All seven real synthetic-input generations returned unique, eligible highlights and nonempty grounded text, including soap-only, conflicting conditions, no-stairs-only, and repeated two-topic input. Latencies were 295–899 ms; empty input made zero model calls. Temporary helpers were removed and cleanup independently verified. This verifies the Mac host framework path, not iPhone inference or production reports. The pending native UI tests are being updated for the user's latest Rate and Comment placement.

The final placement follows the user's further clarification: all expandable rows are together below the facts. The main card contains no rating editor or note creation. Unused parent accessibility identifiers were removed after actual accessibility output showed a parent identifier overriding a child control; the star control keeps its own adjustable accessibility identity.

## Public-note follow-up supersedes the original availability scope

The user subsequently removed private notes and explicitly chose public notes on every device. Only the AI summary is now hidden when Apple Intelligence is unavailable. Full public notes and structured reports, contribution and ownership management remain available. Rate and Comment owns anonymous public notes. The coordinator merges their structured answers with legacy reports using distinct source-prefixed IDs; free-text note bodies stay out of the model. The authenticated legacy private-note audit found zero documents, so no migration is needed. See the [current public-note contract and rollout](public-visit-notes.md). The previous private-note UI run is baseline evidence, not acceptance for this follow-up.
