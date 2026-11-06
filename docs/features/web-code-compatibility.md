# Web passcode compatibility — October 24, 2026 UTC

The public finder at [nyc.imfinethanku.me/find](https://nyc.imfinethanku.me/find/) now reads the same immutable code reports and Used/Invalid feedback as native build 1.0 (12). The previous website only read legacy reports and could not display a new iPhone report. Existing public notes already used the current Anonymous-note schema and remain available without Apple Intelligence.

## Behavior

- Combine bounded legacy and V2 feeds without publishing private codes or exposing owner/voter identities. Use exact seconds/nanoseconds for code versions and ordering.
- Put the latest successful-use verification first; verified reports outrank unverified ones. Otherwise use report time. Loading and failed reads remain distinct from an empty feed.
- Keep earlier alternatives in details until the newest report by report time has four distinct nonowner accounts currently reporting successful use. Then retain that report and the preferred verified report if different. This affects display only and deletes no history. Legacy verification dates are not distinct-user counts.
- Offer visible **I used this code** and **Code didn’t work** controls. Anonymous visitors can read reports; explicit signed-in action is required to contribute. Signing in never submits a report or feedback.
- **Report a new code** creates a stable immutable report, private by default, and saves the place. Only its owner can change visibility or remove it. Failed requests keep the draft; account/place changes invalidate stale work.
- Preserve the legacy initial optional code in the new-restroom form and compatibility with older installed clients. No data rewrite, new rules deployment or backend change was needed for this website release.

The data/model implementation is in `lib/code-evidence-model.ts` and `lib/code-reports.ts`. The React integration is in `components/finder/passcodes.tsx`, `passcode-panel.tsx` and `passcode-view-state.ts`. The privacy page describes the newer additive-report behavior and the older edit path separately.

## Verification and deployment

Typecheck, all **226 web tests**, and the production build passed. Code-specific checks include **7** pure ordering/history tests, **15** SSR/state checks and **19** actual Firebase SDK tests against an isolated loopback emulator. Those SDK cases cover private defaults, paired ownership/projection/Saved state, feedback switching/repeat/concurrency, exact versions, account invalidation and stable retry/readback behavior. Independent source/test review passed.

Release **20261024T040028Z-378edaa8fc9f** is active on the existing VPS. Its compiled server SHA-256 is `89d45c0c84ee8b59b25cc71e16672a44d019c7556def162bcc440c9ad8606e27`, matching the tested local bundle. Health returned 200. The public HTTPS finder and privacy HTML match the compiled pages byte for byte. The compiled finder contains the V2 public-report, feedback and private-own-record namespaces. Runtime credentials were preserved by the existing deployment process.

Fresh anonymous browser checks loaded three legacy reports at the existing Whole Foods Market — Williamsburg listing, expanded the two earlier reports, and confirmed sign-in gating and public Anonymous-note text. Desktop, 390-pixel and 320-pixel layouts passed independent visual review; code panels had no horizontal overflow, and feedback targets measured 44 pixels high. At 320 pixels the two actions stack. No browser warnings/errors were captured during this check. Temporary viewport overrides were reset.

Proof: [desktop](screenshots/web-code-compat-live-desktop.png), [390 pixels](screenshots/web-code-compat-live-390.png), [320 pixels](screenshots/web-code-compat-live-320.png). The [release checks](public-notes-code-release-checks.json) also record native distribution and the [read-only database audit](database-compatibility-audit-20261024.md).

Live verification was anonymous and made zero production contribution/deletion writes. V2 mutation behavior was exercised in the emulator; no production V2 report existed in the audited snapshot. The browser checks do not establish a physical provider sign-in exchange, real venue conditions or successful production account deletion. The separate illustrative demo retains its simulated behavior.
