# Native Sign in with Apple

October 23, 2026. Internal testing first; external submission on hold.

## Scope and acceptance

Offer Apple and Google in the native account screen and every sign-in prompt. Both authenticate through the existing Firebase project `nye-restroom`; signed-out discovery and the existing Firestore authorization contract stay unchanged. Preserve place/account guards and pending actions while switching from a direct Google launch to a provider choice. Apple Hide My Email must work without automatic linking to a Google identity. No provider tokens or account identifiers enter Analytics.

## Implementation

Native AuthenticationServices produces an Apple identity token using a fresh secure nonce (hashed with SHA-256 in the request) and independent random state. The retained coordinator accepts one completion, rejects missing/mismatched state and changed account generations, and handles cancellation/late callbacks. Firebase uses `OAuthProvider.appleCredential` with the original nonce and the first-returned name. Account linking is never inferred from email.

The shared native sign-in UI provides the official Apple control and Google branding. Detail actions keep their original place/account intent until actual sign-in and sheet dismissal; a canceled chooser performs no save, rating or contribution. First-time Firebase accounts emit `sign_up` with bounded `method=apple` or `method=google`; returning sessions do not. IDs remain in local memory guards only.

Apple's explicit bundle `coms4995.Restroom-Ready` has Sign in with Apple enabled. Firebase Console showed both Apple and Google Enabled after saving the native Apple provider. Services ID and OAuth code-flow credentials were optional for the native setup and left blank; no private signing key was generated. The typed Xcode project helper adds the Sign in with Apple entitlement for device and simulator while preserving simulator Keychain identity, Google callback and Analytics privacy settings.

## Verification

The core implementation passed 43 pure Swift tests, including nonce hashing/random failure, state mismatch, cancellation/late callbacks, stale sessions and first-account Analytics. The coordinator also type-checks against the actual iOS 18 SDK. The integrated Firebase-linked simulator app built successfully on the Mac Studio with Xcode 26.2. `testAppleAndGoogleChoicesFromAccountAndPlaceActions` passed in 41.812 seconds on iPhone 17 Pro, covering Account, Add, Save and Rate choices and cancellation without performing a contribution. The Account screenshot was visually inspected. An independent reviewer found no material blocker in the integrated implementation or internal-only upload job.

Apple Developer's saved explicit App ID showed Sign In with Apple checked. Firebase Console readback showed both Apple and Google Enabled. Existing Firestore rules accept non-anonymous authenticated accounts without restricting ownership to Google, so the Apple provider needs no rule expansion. A genuine Apple credential exchange and physical-device Analytics receipt remain unverified; UI tests do not establish either.

The prior external build-8 attempt archived but stopped before export on an SDK privacy-name assertion. That attempt uploaded no build and submitted nothing for external review; its exact temporary job files and LaunchOnlyOnce service are absent. The prepared external group has no builds. The successful Apple-capable upload below uses internal-only distribution, as requested.

The first Apple-capable internal archive stopped because Xcode had no active account and selected the old wildcard profile without Apple sign-in. After the user refreshed the Mac Studio's Xcode account, the same guarded job succeeded. Apple accepted internal-only **1.0 (8)** at **4:47:23 PM, October 23, 2026, America/New_York**. Processing finished, and [build 8](https://appstoreconnect.apple.com/teams/88e8ae98-ca7a-4e37-a5c5-0a81af6531e6/apps/6826010051/testflight/ios/43517a29-4fc3-40ca-a9fe-c151d869e911) is **Testing** in the existing **4995** and **Team** internal groups. Both selected options and the resulting build row were verified; [the dashboard screenshot](screenshots/native-testflight-build8-testing.jpg) records this state. No testers were added or invited. Eligible existing testers can update through TestFlight; installation and real Apple/Google authentication remain device checks. External review was not submitted.

Independent archive verification confirmed strict deep signature, exact bundle/team/version/build, Apple sign-in `Default` in both the app and explicit provisioning profile, all 32 valid SDK privacy manifests, Analytics and Measurement binaries, the app's matching dSYM and all 104 source/test/export hashes before and after compilation. The existing prebuilt-SDK symbol warnings did not prevent upload. The completed one-time launch service and all three exact temporary job files were removed and their absence verified. The [native Account screenshot](screenshots/native-apple-google-account-17pro.png) records the verified provider-choice interface.

The public privacy notice now describes native Apple/Google accounts and non-advertising Analytics. Production release `20261023T204253Z-378edaa8fc9f` passed HTTPS health and visible-page readback; local and deployed server bundles matched SHA-256 `7076f9a7f1f220473a48a6702dc721dd5a603278eaad36009b3d66c6c6fca795`.
