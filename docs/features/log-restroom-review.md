# Independent review: logging a restroom

Checked October 15, 2026, New York time (`2026-10-16T02:17:44Z`). This review covers the community model/service, Firestore rules, and their integration with the finder, private saved places/notes, ratings, source details, and privacy copy. The reviewer did not implement these changes.

```json
{"score":5,"summary":"No open security findings after corrections and focused emulator verification.","findings":[]}
```

## Findings resolved

- Rules originally accepted control characters that the public decoder rejected, allowing one report to prevent a whole snapshot from loading. Rules now reject those controls and Unicode-only blank names/addresses. The watcher also isolates malformed records and reports a visible partial-feed warning.
- Stored observation dates originally used the stricter New York form-input cutoff. A server-valid UTC date could consequently become unreadable around midnight. Stored-record validation now uses the submission timestamp independently of the form's New York date limit.
- Map labels now describe restroom locations, allowing city records and visitor submissions to remain distinct in their own source details.

## Independent checks

Focused probes used only the isolated local Firestore emulator project `demo-community-independent`. The actual service/model code was loaded in memory with its Firebase dependencies bound to that test instance; application source was unchanged. The test project was cleared afterward. No production records, accounts, votes, or submissions were created.

- Atomic creation produces the public listing, private owner receipt, and zero-count rating summary together. Public listing fields contain no account identity.
- Anonymous visitors and another signed-in account cannot read the private receipt.
- Repeating the same request ID confirms the existing listing without changing its submission timestamp or resetting a subsequent rating.
- Orphan writes, forbidden controls, and Unicode-only whitespace names are rejected.
- A valid supplementary-Unicode name and a server-valid observation date at the UTC/New York day boundary remain readable.
- An intentionally malformed administrative emulator fixture is hidden with an explicit warning; all valid records still reach the anonymous public watcher.

The main agent separately reported 238 passing rule tests and a successful production rules dry run. Full form/browser checks and post-release verification remain separate acceptance evidence.

## Reviewed source hashes

These files retained the same SHA-256 throughout the independent probes:

| File | SHA-256 |
| --- | --- |
| `firebase/firestore.rules` | `b007d0f31dc80cf5378974c22acab2c5a5d057bfec2453245cbfd5df91c0c4e6` |
| `lib/community-restroom-model.ts` | `18e71fa4329a8df5f33f18079c1ebffc6d5a590bdf4f7b4ad9a74b09ca33af93` |
| `lib/community-restrooms.ts` | `ce24df89c87c4c19497f469eeb7bfac8d70fa72be6d736de2d0bf51b8d2e5210` |

The feed shows at most the latest 1,000 public submissions. Coordinates are checked against an approximate regional rectangle, not municipal boundaries. Visitor reports remain unverified, and this version does not provide self-service editing or removal of a logged location.
