# Native moderation request flow — Maya review v1

Date: November 5, 2026. Independent source and copy review by the dashboard agent, who did not implement the native request flow. Uses the course repository's fictional composite [Maya definition](https://github.com/imnotmomo/columbia-startup-studio-fall-2026/blob/team-fivegirls/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-maya.md). This is a research-grounded persona simulation, not customer validation or a native runtime test.

## Verdict

```json
{
  "persona": "judge-maya",
  "artifact": "Moderator request flow v1 \u2014 native pending submission and owner status history",
  "verdict": "approve",
  "score": 8,
  "headline": "I know my submission is waiting for review, where to check it, and when my code would become visible.",
  "must_fix": [],
  "nice_to_have": [
    "Offer a View request action after confirmed submission so I do not have to remember the Account navigation path.",
    "For a request needing corrections, offer a clear next step or reusable draft rather than making me enter the same venue details again."
  ],
  "in_character_reaction": "Submit request tells me this is not on the map yet. I can check Awaiting approval in Account, and the private-code wording says Saved happens only if it is approved. Keep that difference clear: approval is not someone checking that the bathroom is clean or that the code works tonight.",
  "would_flip_me": "",
  "would_pay": "n/a"
}
```

No source-level UX blocker for this reviewed slice. Approval is limited to the copy and traced navigation/data behavior below. The native agent owns Firebase-linked build and actual device/simulator readability and interaction checks; this review does not replace those release gates.

## Checks and reasoning

- **Plain waiting language:** the form action is “Submit request,” the pending status is “Awaiting approval,” and the post-submission alert says the request appears on the map after moderator approval. It explicitly points to Account → Restroom requests. Neither status nor confirmation calls submission a publication or verification.
- **Private code and Saved:** code input is optional and appears only for Code required Yes. Visibility begins at “Only me.” Both private and public copy begin “If approved”; private copy promises Saved only then. The shared contract and approval transaction agree: initial submission creates the private request and reservation only; approval creates the public venue and optional code, with Saved created for a private code. A denied request publishes no venue or code. The form also says submission does not verify successful use.
- **Dates preserve meaning:** the user may provide a visit date or leave it Not reported. Owner rows label original Submitted and subsequent Reviewed dates separately. Review time is not presented as an observation time or proof of condition. A moderator decision does not create cleanliness evidence or a successful code-use timestamp.
- **Find the status:** Restroom requests is visible under Account only to a signed-in, nonanonymous account. Pending and denied rows show plain status text; denied rows show a bounded understandable reason. An approved row opens the matching public restroom through the shared map-card selection path. If that venue is absent, the list stays in place and an unavailable message asks for a refresh.
- **Loading, failure and retry:** owner history has distinct loading, empty, failure/Retry and bounded 50-item states. Pull to refresh reloads the server snapshot. Account changes clear the private request state and dismiss owner history. The exact submitted draft remains pinned after a failed attempt; retry checks the same ID, listing and optional code rather than manufacturing a duplicate request.
- **Readable source structure:** status rows use system headline/subheadline/caption styles, multiline wrapping and minimum 44-point row targets. Forms use system text styles, long footer wrapping and scrolling sections. These source properties are appropriate for Dynamic Type, but do not prove that a footer or action is visibly reachable at a particular screen/text size.
- **No hidden information promise:** owner history intentionally does not expose code drafts or private commitments. Existing public browsing does not require submission or registration. Unknown condition information remains unknown; no star average or moderator approval is used to imply current cleanliness.

## Runtime handoff

Still require the native agent's actual runtime checks for normal and accessibility text: reach the private-code approval/Saved footer, switch to Everyone and read the public-code approval footer, inspect pending/approved/denied rows and reasons, return from request history, open an approved restroom at the shared half-height card, and verify unavailable/error recovery. The DEBUG presentation previews must not submit records or grant an Auth identity; end-to-end authorization/publication is covered separately by the real Firebase emulator integration checks.

No native code changes, production writes, fabricated reports, authentication actions, deployment or TestFlight upload were performed for this review.

## Input version

These SHA-256 values identify the inspected source; rerun this review if the pending/approval language, code visibility/Saved semantics or navigation materially changes.

| Input | SHA-256 |
| --- | --- |
| `docs/features/moderator-dashboard.md` | `362ea8e36fd574b2495865f1ebc2beb3aa14644682c3dc00544e155f571df7b5` |
| `ios/Restroom Ready/Models/RestroomSubmissionRequest.swift` | `97b3471a63df887fdc5084132f9d772f70bf697851db4a21e7daaacfa980c013` |
| `ios/Restroom Ready/Services/NativeModels.swift` | `29c143695a8f66b3d6fa5b4b994897fb2ca6501929132ddf42c1042b2391548b` |
| `ios/Restroom Ready/Services/NativeStore.swift` | `4ccc10f8603c9b04247286585f00353ffec389b4e0c27798f8ec82be06fccded` |
| `ios/Restroom Ready/Views/NewRestroomForm.swift` | `bb345ff4be98a271fbc6e4a73541c339eac026285f4ac2d1f601907a7c98e2e4` |
| `ios/Restroom Ready/Views/OwnRestroomRequestsView.swift` | `60e4ac5f07129be65b9e22c2d27a753521f03f39c7f9d870affec4a972edda72` |
| `ios/Restroom Ready/Views/NativeAccountView.swift` | `9243f77edd3c5b066f7653da79b94e9bbfd6dc43714d9413bbd186018034725e` |
| `ios/Restroom Ready/Views/NativeRootView.swift` | `108af00f2b870f58868fe3b0e1ed0784bfa4031951f02b2db8aa63db500efda2` |
| `ios/Restroom Ready/Views/NativeComponents.swift` | `ec90b07631e8f13e6d53e1a3ec18b6053fc9340171fd0a2e8724e25ec7c183cd` |
| `backend/moderation/src/service.mjs` | `d3b550d64f057c515f2c312df4c35ac747c15106e341871d269b56646c1cd633` |
| Maya persona definition | `2b53a4fb64214836a94fa526dabcc37413a7eae7661b1040e6ea9052819dfdac` |
