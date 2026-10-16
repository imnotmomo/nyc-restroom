# Log a restroom — Maya persona review

Review date: October 15, 2026 (America/New_York). This is a research-grounded simulation using a fictional composite persona, not customer testimony or demand validation. Scope: source-level review of the login-only missing-location flow and public listing clarity. Browser behavior, data persistence, and backend authorization are verified separately. No implementation files or production data were changed.

## Input version

| Input file | SHA-256 |
| --- | --- |
| `components/finder/log-restroom.tsx` | `6ec05273c90330c71fb3d76e97b502a4e165d1df25103f907ffc7028738eefc3` |
| `components/finder/detail.tsx` | `0c11b01b07a7976c8b9fd77ca719b17891a36df9653867d4c28bd07aefe6b145` |
| `components/finder/explorer.tsx` | `d111f50c6abf753fb1e223cceb3cece99c071d4a71a96efcb0ddb82440afd5aa` |
| Persona: `/Users/cc/Desktop/4995/columbia-startup-studio-fall-2026/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-maya.md` | `2b53a4fb64214836a94fa526dabcc37413a7eae7661b1040e6ea9052819dfdac` |

## Verdict

```json
{
  "persona": "judge-maya",
  "artifact": "Login-only Log a restroom and public listing details",
  "verdict": "approve",
  "score": 8,
  "headline": "A new place can be added without pretending that its restroom conditions have been checked.",
  "must_fix": [],
  "nice_to_have": [],
  "in_character_reaction": "I can look around without signing in, and I know adding a place needs an account. A new pin does not tell me there is paper or a usable stall, and the listing says those conditions are not reported. I can see that a visitor submitted it, when they observed the details if known, and when they posted them. That gives me another place to consider without making an unearned cleanliness promise.",
  "would_flip_me": "",
  "would_pay": "n/a"
}
```

## Finding

The signed-out dialog explains that Google Sign-in is required to add a location while everyone can browse. The form identifies which details become public, discourages personal/contact information, defaults entry and route answers to “Not reported,” and permits an unknown observation date. It asks for a venue and its location rather than implying that an address or pin establishes restroom usability.

The public list distinguishes visitor submissions from city listings. The detail sheet shows visitor provenance, submission time, and the separate observation date, including when that date is unknown. Conditions, supplies, and stall usability remain explicitly unreported; the conditions observation date is not manufactured from the location submission. Public cleanliness ratings are presented separately, and the explorer uses actual loaded summaries rather than awarding a rating to a new location. The success message also states that the new details have not been independently checked.

Maya would want condition evidence before relying on a place for her own trip, but supplying public condition reviews is outside this missing-location feature. Their absence is not a blocker when clearly labeled. No blocking feedback, revision, or rerun is needed for these input hashes.
