# Public MVP audit — Maya persona review

Date: October 20, 2026 (America/New_York). Input artifact: **Public MVP audit v1**, the working source for public finder access, public navigation and mobile header repairs. This is a research-grounded simulation of the fictional composite Maya persona, not a customer interview, usability test or demand validation.

Scope: source-only review of the landing page, finder/list/detail and rating presentation against Maya's need for quick browsing, usable-condition information and honest dates. The parent audit owns browser, runtime, account authorization and deployment checks. This review does not establish that the gate removal works on a deployed host or that any venue is currently usable.

## Input version

These hashes identify the inspected source snapshot. Later browser or integration repairs require a rerun if they materially change the reviewed experience.

| Input | SHA-256 |
| --- | --- |
| `docs/features/public-mvp-audit.md` | `b44e142504d79c2877c4a98cf52dd9cb9a542c1436f080748d4a368926ef4309` |
| `components/landing.tsx` | `cbed59e21ba25b2a1b3f86196bdf802682b83cb85562f33a9c2ab39cbe98e87e` |
| `components/finder/explorer.tsx` | `d97b90c5edabec834409b8e86e0d776ac8e9feb0f3cbeb696bd44474f5bc7fe2` |
| `components/finder/detail.tsx` | `d01e18789f8337b78213c9fc1258e011783def8fd2c7779d20a14efe6edc7b71` |
| `components/finder/ratings.tsx` | `eb46fc2731338b70bdde8a89e5e0acaeb63aae49820d84e5308d4a374e5a4374` |
| `app/find/finder.css` | `93c9c8c00973d1287a5bf72306efeb348e370a4ada5a1b1479816549a6f7204a` |
| `lib/restroom-filters.ts` | `1a713a8515fd8e45eb718d400f9725450fbec11ebd72c2aa38f5029697560281` |
| [Maya definition](../../../columbia-startup-studio-fall-2026/teams/fivegirls/hw4-synthesis-brand-position/personas/judge-maya.md) | `2b53a4fb64214836a94fa526dabcc37413a7eae7661b1040e6ea9052819dfdac` |

## Verdict

```json
{
  "persona": "judge-maya",
  "artifact": "Public MVP audit v1 — public browsing, navigation and condition clarity",
  "verdict": "approve",
  "score": 8,
  "headline": "I can browse without setup and see where condition information is still missing.",
  "must_fix": [],
  "nice_to_have": [
    "Show the rating update date beside each list average so I can judge its age before opening the detail sheet.",
    "In a future reporting feature, publish short restroom-specific observations about paper, soap, floor and usable stalls, each with its source and actual observation time."
  ],
  "in_character_reaction": "I can open the finder without an account and get to directions. The list says conditions are not reported, and a four-star cleanliness average is explained as visitor opinion rather than a check of the bathroom now. I would still want a recent paper-and-stall report before relying on a place, but at least the map is honest about that gap.",
  "would_flip_me": "",
  "would_pay": "n/a"
}
```

## Actual checks and reasoning

- Read the actual Maya definition, repository guidance, brand position and style guide. Maya's condition needs are grounded in the cited source accounts; her composite identity and synthetic reaction are not evidence of a real person's product use.
- Inspected the working diff and current source for every hashed UI file. Header, hero and footer links lead to `/find/`; the hero says browsing needs no account and saving/contributing needs sign-in. The finder no longer imports or renders `LockFinderButton`. The separate sample demo remains linked and the illustrative landing listing is explicitly labeled as an example.
- Traced list selection, detail dismissal and focus restoration in `explorer.tsx`, plus mobile header wrapping, map/list/detail visibility, back-control labels and focus styling in `finder.css`. These are implemented source paths, not measured touch targets or proof of correct layout at any viewport. Browser overflow, keyboard and navigation checks remain with the integrated audit.
- Checked the list's explicit `Purchase · Floor · Conditions / Not reported` summary and detail conditions rows. The detail explains that soap, toilet paper and stall conditions are unreported. A city-source date or a community location-submission date is not used to fill in a missing condition observation date.
- Checked dated city-data provenance and the community distinction between submission time, observation date and missing observation date. The source note disclaims a live availability check or team inspection.
- Read the cleanliness filter implementation and its help text. It requires a nonzero attributable average of at least four; unrated places are excluded. Help text disclaims current conditions. The detail presents the rating count and aggregate update date as ratings, separately from condition facts, and explicitly describes ratings as visitor opinions.
- Checked private notes: the form starts with unknown condition answers and an empty observation time, requires an actual past visit time, and labels notes as private. Displayed observations and submissions have separate times. These notes do not create public condition reports or establish venue conditions.

No automated test suite, browser session, Firebase write or production request was run for this persona review. Read-only source inspection and SHA-256 capture are the checks performed here. No production ratings, reports or customer evidence were created.

## Blockers, revision and rerun

No blocking feedback for the inspected v1 public-browsing slice. Richer public condition evidence remains an unmet product opportunity; its absence is visibly disclosed and does not justify inventing evidence or blocking public lookup. Approval is limited to the source experience and does not certify release acceptance. No revision or rerun was required for the hashes above.
