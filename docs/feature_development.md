# Feature Development — Restroom Ready

We chose [Feature Forge](https://github.com/kenxle/feature-forge/blob/main/README.md) because its brief, plan, build, verify, ship, and learn stages connect each small feature to a user problem and evidence that it works. We use its process through Markdown records. Next.js is the application framework; Feature Forge command skills are not installed.

## One record per feature

Create `docs/features/<feature-name>.md` for a new feature. Keep the brief, plan, decisions, review, verification, release status, and lessons together. Mark its current stage and owner. The product brief and flow diagram describe proposed work, not a shipped application.

| Stage | Agent work | Evidence before moving on |
| --- | --- | --- |
| Clarify and brief | Read product and research docs; state the user problem, scope, unknowns, and observable acceptance criteria. | A brief that distinguishes sourced facts from proposed behavior. |
| Architecture and plan | Inspect the code and relevant primary documentation; compare options; split work into slices with file ownership, dependencies, and checks. | A plan linked to the acceptance criteria and an accurate list of affected files. |
| Plan review | A separate reviewer checks scope, data handling, route versus entry details, and UX. Relevant personas review the same proposed artifact independently. | Blocking findings resolved; major product decisions settled with the team. |
| Build | The implementation agent builds the planned slices and appropriate tests. Parallel agents own different files and preserve one another’s work. | An integrated change that matches the agreed scope. |
| Verify and review | A reviewer who did not implement the change checks it against the brief. Run supported automated checks and inspect relevant browser/mobile flows. | Recorded results, screenshots where useful, and no unresolved blocking findings. |
| Ship | Prepare a change summary, evidence, limitations, and any rollout steps. Follow the team's current authorization for commits, PRs, merges, and deployment. | The authorized delivery completed and checked in its destination; otherwise leave it ready for team review. |
| Learn | Record useful lessons, unresolved questions, and any guidance changed by the feature. | A closed or clearly pending feature record and current project docs. |

## Review roles

Use a planner, an implementer, and an independent reviewer. One teammate can coordinate the handoffs. Maya checks usable conditions, Chloe checks the evidence behind a recommendation, and Alex checks entry and internal route with belongings. Persona approval supplements technical review; it does not replace real users or certify wheelchair suitability.

Keep a reviewer’s input version and output together. A change that addresses a blocker gets another review of the revised version. Do not describe an unused role or a planned check as a completed run.

## Feature record template

```markdown
# Feature: <name>
Status: <brief / planned / building / verifying / ready / shipped>
Owner: <name>

## Brief
User problem:
Sources:
In scope:
Out of scope:
Unknowns:
Acceptance criteria:

## Plan
Options and decision:
Slices, owned files, dependencies:
Checks for each acceptance criterion:

## Reviews
Input version, reviewer, findings, resolution:
Persona input version and verdicts, if relevant:

## Verification
Commands or inspection steps actually run:
Results and evidence:
Remaining limitations:

## Delivery and lessons
Authorization and delivery status:
Post-delivery check:
Lessons or follow-up questions:
```

For a small, understood fix, keep a short record of the problem, changed files, checks, review, and outcome. Application commands must come from the actual project configuration once Next.js is scaffolded; none are supported yet.
