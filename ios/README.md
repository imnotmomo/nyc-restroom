# Restroom Ready for iOS

Native SwiftUI discovery and contribution app using MapKit, Firebase Authentication and Firestore. The shared backend remains `nye-restroom`; this is a native client, with no embedded web frontend.

## Open and build

From the repository root, open `ios/Restroom Ready.xcodeproj` and select the **Restroom Ready** scheme. Use **Xcode 26.2 or newer**. Minimum deployment target: **iOS 18**. Registered bundle identifier: **`coms4995.Restroom-Ready`**. Preserve the selected developer team and automatic signing configuration.

The project resolves Firebase **13.1.1** with the Firestore trait supplied by the local `ios/NativeDependencies` package. Google Sign-in is pinned to official commit `4ce331c226c24cfee688b31e9c3731cc5c5e2862` for the compatible App Check dependency. Preserve the checked-in package resolutions and local package edge; do not downgrade SDKs to hide a toolchain failure.

Apple and Google use the existing iOS registration in Firebase project `nye-restroom`, app ID `1:547771536579:ios:0adadc776b8a591a297e76`. The project already links the matching local configuration resource. With an authorized Firebase CLI session, run from the repository root:

```sh
npx -y firebase-tools@latest apps:sdkconfig IOS 1:547771536579:ios:0adadc776b8a591a297e76 --project nye-restroom --out ios/GoogleService-Info.plist
```

`GoogleService-Info.plist` remains ignored. Keep its callback scheme aligned with the registered app. Never add Firebase CLI sessions, service-account keys, `.p8`/`.p12` signing material, provisioning profiles, account exports or local release archives to Git.

```sh
swift test --package-path ios
xcodebuild -resolvePackageDependencies -project 'ios/Restroom Ready.xcodeproj' -scheme 'Restroom Ready'
xcodebuild -project 'ios/Restroom Ready.xcodeproj' -scheme 'Restroom Ready' -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/restroom-ready-ios-build build
```

Use the checked-in `Configuration/Simulator.entitlements` for simulator runtime checks and `Configuration/App.entitlements` on devices. Do not disable simulator signing for authentication testing: missing Keychain entitlements previously prevented Firebase login. An unsigned SDK compilation checks source linkage but cannot establish working simulator authentication. Native MapKit uses no web token.

## Product behavior

- Map and list discovery, clustered pins, search suggestions, walking directions and permission-aware current location. Existing permission may center the map on launch; a new permission request requires an explicit Locate action. No background location capability is used.
- Combined Clean, Accessible, Stair Free, Public and Elevator access filters. Reported accessibility drives both the label and filter; incomplete route evidence does not establish Stair Free or elevator access.
- Compact, left-aligned Hours, Amenities, Condition and Passcodes rows. Every restroom card opens halfway and can expand. Known weekly schedules show today's New York hours in the summary and the full week when expanded.
- Apple/Google authentication, account-owned saved places, half-star cleanliness ratings, public visit notes and Comments by you. Anonymous attribution is the default; public notes remain available without Apple Intelligence.
- Public or private passcode reports with separate report/update/verification dates, ownership and version-pinned community feedback. Private codes are never public listing fields.
- New restroom requests enter a private moderation queue. Only the moderator service publishes approved listings and optional public code projections.
- Optional short visitor summaries run with Apple's on-device Foundation Models framework. They do not send note body text, identities, coordinates or code values to a model, and do not change venue facts.
- Account deletion uses authenticated reauthorization and the shared backend. Preserve documented cleanup policy, public contribution anonymization and recovery behavior; publishing source does not activate a new backend policy.

## Data and privacy

Bundled city, source and reviewed-accessibility snapshots are in `Restroom Ready/Resources/`. They are dated information rather than current inspections. Live Firestore records retain stable IDs and separate source, observation and submission dates. Firestore cache stays memory-only; account and selection generations reject stale work.

Current source keeps optional Analytics off until Share app usage is enabled in Account. Withdrawal stops collection and resets local Analytics state. Simulator collection is disabled. Pre-consent actions are not replayed after opt-in. Major events use bounded action labels; they do not include account IDs, names, email, venue IDs, searches, coordinates, note text, codes or visit timestamps. `sign_up` requires Firebase's confirmed new-account result; returning sign-in emits `login`. The successful credential flow may supply a missing provider ID, while contradictory metadata is rejected. The Firebase SDK owns offline delivery; no duplicate client delivery queue is added.

## Verification and release status

The latest signup repair passed **199 model tests** and an isolated Firebase-linked **Xcode 26.2 / iOS Simulator 26.2** build for arm64 and x86_64. No app launch, real account creation or production Analytics event was part of those checks. Physical-device credential exchange and Google ingestion need separate verification.

Current `main` source includes unreleased build-20 safeguards and the subsequent signup repair. The already signed build 20 archive is a frozen earlier snapshot and does not inherit later source edits. Recorded distributed versions remain **1.0 (18)** internally in Team and 4995 and **1.0 (19)** in Public Beta. This branch change neither uploads a new build nor changes tester membership. Future internal builds go to **Team only** unless explicitly requested otherwise.

The web application and dashboard source are on [`webapp`](https://github.com/imnotmomo/nyc-restroom/tree/webapp). See [branch ownership](../docs/branches.md) before porting shared backend or schema changes.
