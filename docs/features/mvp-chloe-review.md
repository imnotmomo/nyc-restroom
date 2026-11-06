# Public MVP audit — Chloe persona review

Review date: October 20, 2026 (America/New_York).

This is a research-grounded simulation using the fictional composite Chloe persona, not a customer interview, usability test, or demand validation. Input version: **public MVP audit v1**. Scope: source-level credibility, evidence dates, uncertainty, public browsing, contribution privacy copy, and the distinction between the sample demo and finder. Browser behavior, production OAuth, deployment, runtime authorization, and security-rule execution are outside this review. The backend audit below was read as a separate auditor's evidence, not rerun or independently reproduced here. No application files, accounts, or production records were changed.

## Input version

| Input file | SHA-256 |
| --- | --- |
| `docs/features/public-mvp-audit.md` | `b44e142504d79c2877c4a98cf52dd9cb9a542c1436f080748d4a368926ef4309` |
| `components/landing.tsx` | `cbed59e21ba25b2a1b3f86196bdf802682b83cb85562f33a9c2ab39cbe98e87e` |
| `components/finder/explorer.tsx` | `d97b90c5edabec834409b8e86e0d776ac8e9feb0f3cbeb696bd44474f5bc7fe2` |
| `components/finder/detail.tsx` | `d01e18789f8337b78213c9fc1258e011783def8fd2c7779d20a14efe6edc7b71` |
| `components/finder/passcodes.tsx` | `9ea5e1e5eeac8d743d4214a2d1bcd008eb09bd10ce66ea7b9853d7f0e572a398` |
| `app/privacy/page.tsx` | `f517aa6b3ee5e3329709eafb78f24447f1de1bddb9d3f84113abd95b0b85750d` |
| `docs/features/mvp-firebase-audit.md` | `950c2a06985a1690fac2cf8b2558ccfb764bafb01c0ba1b5674ede4d89895029` |

Persona definition: `/Users/cc/Desktop/4995/columbia-startup-studio-fall-2026/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-chloe.md`.

Supporting source reads: `components/finder/ratings.tsx`, `lib/restroom-filters.ts`, `lib/restrooms.ts`, `components/finder/log-restroom.tsx`, `components/demo/explorer.tsx`, `components/demo/detail.tsx`, and `app/demo/page.tsx`.

## Verdict

```json
{
  "persona": "judge-chloe",
  "artifact": "Public MVP audit v1 — public finder, dated evidence and account privacy",
  "verdict": "approve",
  "score": 8,
  "headline": "I can inspect the finder before joining and tell a dated source, a visitor report, and a sample apart.",
  "must_fix": [],
  "nice_to_have": [
    "In the rating form, replace 'One public rating per account' with wording that says the vote contributes to the public average while the individual vote and account remain private, matching the privacy page.",
    "Consider 'Last successful use reported' instead of 'Last verified' for codes so the timestamp itself names the visitor-reported event. The current section explanation and separate code-update date already prevent this from being a blocker."
  ],
  "in_character_reaction": "I can open a listing before signing in, which makes this easier to check for myself. The city date does not pretend someone visited that day, and a new visitor submission still tells me when the observation date is unknown. The code section explains what someone actually confirmed, and I can keep my own code private. I would still check the entry details and keep another option in mind because these reports do not tell me a restroom is usable right now.",
  "would_flip_me": "",
  "would_pay": "n/a"
}
```

## Findings and blockers

**No blocking trust or privacy-copy finding in this input.** Public browsing is offered separately from Google Sign-in for saves and contributions. Removing the shared page gate does not imply that account-owned information becomes public. The UI and privacy page describe private notes, Only me codes, explicit Everyone sharing, owner-only code changes, and private individual rating records; the separate Firebase audit reports account isolation and emulator checks. This source review does not itself establish deployed permissions.

The finder banner and detail sheet identify the dated city source and explicitly disclaim current availability and team inspection. Visitor submissions identify their source, submission time, and separate observation date; an unknown observation date remains unknown. City accessibility labels are not promoted into confirmed restroom-route or stall facts. Ratings are presented as visitor opinions with their own update label and a current-conditions disclaimer. Missing supplies and conditions remain visible rather than borrowing a location submission date.

Code update and successful-use verification dates are separate. Sharing or saving a code is explicitly not verification, edits clear prior verification, and a code is not permission to enter. The public demo has a visible sample label, sample ratings and code provenance, session-only state, and a reset explanation. Its source is a separate flow from the city finder, so its simulated conditions are not evidence about a real restroom.

## Revision and rerun

No blocking revision or rerun is required for the recorded v1 inputs. The two wording suggestions are nonblocking. A later change that removes source/date qualifications, changes contribution visibility, or presents sample reports as real information should receive another persona review. Browser and release acceptance evidence belongs in the coordinating audit record.
