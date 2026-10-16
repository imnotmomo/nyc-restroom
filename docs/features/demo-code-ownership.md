# Demo passcode ownership and multiple reports

Status: Ready for release
Date: October 16, 2026

The demo should distinguish another contributor's public code from the visitor's own code. Target begins with public example 3434 and the visitor's private example 3535. Display both in Your view, but only public reports in Public view. Edit/visibility controls belong exclusively to the report's submitter, including after the submitter shares it publicly. Remove the demo code-delete action.

Keep stable report identities, separate ownership from visibility, and keep each report's update and verification timestamps independent. Saving a changed own code clears only its verification; a visibility-only change preserves it. Public code verification never grants edit ownership. The initial private code saves Target automatically, matching the existing private-code behavior. New local codes belong to the demo visitor. Reset restores the two seed reports. All state remains labeled sample data in local memory; no Firebase/account changes.

Root owns docs, integration and release. The demo author owns local model/tests and demo components. The independent reviewer approved the plan with conditions: explicit stable ownership, per-report updates/checks, no foreign-code editor, private auto-save, and no stale editor submission after switching to Public view. Verify these conditions with focused model and compiled-browser checks, including phone layout.

Nine focused model tests passed, including separate own/public seed reports, private filtering, independent report verification, visibility-only preservation, code-change invalidation, identical code text with distinct owners, and owned new samples. Production TypeScript, static export and Worker packaging passed (97 assets). Independent source review approved the structural ownCode/publicReports model and synchronous view guard.

All 11 independent compiled-browser groups passed: the initial two reports, foreign-code read-only controls and no deletion, owner editing after sharing, independent dates, identical values retaining distinct owners, stale-editor cancellation, private auto-save/public preview, owned local additions, reset/reload, and 320/390px keyboard/layout. There were no runtime errors, Firebase requests or API mutations. Root also inspected both code cards and confirmed that Public view renders only 3434 initially. Evidence: `demo-code-ownership-browser-checks.json` and its screenshots.
