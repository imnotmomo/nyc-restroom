# Native whole-star rating save

Date: October 22, 2026
Status: Verified fix in internal build 1.0 (3); Testing in the existing 4995 and Team groups

## Problem and acceptance

The user selected five stars for Capital One Café — SoHo in the iPhone TestFlight app. Firestore rejected the request and the app displayed its generic authorization error. Acceptance: all nine values from 1 through 5 in half-star steps use a payload accepted by the existing rules; replacement/removal, account ownership and paired aggregate checks remain intact. Do not manufacture a production vote to test this.

## Diagnosis and change

The production venue and its zero-count summary exist. The stored count/sum have valid integer types. Deployed rating rules match the local rating contract; their only whole-file difference is the position of an identical source-comments rule block. A web-SDK emulator sequence for the same community ID successfully created five stars, updated to 4.5 and 1, and removed the vote.

An isolated REST wire-type matrix reproduced the actual rejection: `doubleValue: 5` fails with 403, `integerValue: 5` succeeds, and `doubleValue: 4.5` succeeds. Integer five also succeeds with a double aggregate sum, isolating the issue to the vote's `stars` representation. Firestore Rules allowed-list membership distinguishes these types. The native SDK previously wrote every selection as Swift `Double`; the web SDK emits integers for whole numbers.

`CleanlinessRating.firestoreNumber(for:)` now validates the scale and returns an integer NSNumber for whole stars, or a double NSNumber for half stars. `NativeStore.rate` uses that value only for the vote payload; UI values, transaction math/increments, timestamps, account/session guards, nil removal and server confirmation stay the same. `NativeSchema.stars` shares the validator. No backend rules were changed.

Independent inspection of Firebase 13's NSNumber serializer confirmed integer Objective-C types use integer encoding and floating types use double encoding. Separate source review approved the change. A temporary macOS native probe compiled, but Auth stopped at macOS CLI Keychain persistence before Firestore; it is not acceptance evidence. The decisive reproduction used emulator REST requests with explicit numeric types and no production credentials.

## Verification

- All nine Swift tests pass on the Mac Studio: seven existing directory/filter checks and two rating serialization/validation checks. The new cases cover every allowed value, non-Boolean integer/decimal types, invalid steps, bounds and non-finite numbers.
- All 90 existing Firestore rating cases pass against the isolated emulator, including ownership, anonymous denial, forged totals/timestamps, half stars, update/removal, replay and concurrency.
- All 18 additional raw-wire emulator cases pass in `tests/firebase/native-rating-wire.test.mjs`: the original integer/double failure matrix, all nine canonical values through create/edit/remove, the synthetic Capital One community ID, ownership isolation and forged-total rejection. This test accepts only loopback emulator hosts and a separate demo project, and clears its fixtures afterward.
- The raw-wire reproduction created and cleaned only synthetic emulator records/accounts. Production reads confirmed count 0 and sum 0; this work did not submit a vote for the user.

Swift test log: `/Users/zhelichen/Documents/RestroomReadyNative/build-logs/native-rating-model-tests.log`. Emulator evidence is under `/private/tmp/restroom-rating-diagnosis/`. Internal delivery status is recorded in [the TestFlight record](native-testflight.md). A real iPhone submission after installing the update remains a user retry.
