# Restroom Ready for iOS

Restroom Ready helps people living in or visiting NYC find a suitable restroom and check its hours, amenities, conditions, entry codes and dated reports before walking over.

This `main` branch contains the native **SwiftUI and MapKit** app plus shared Firebase and backend source. The Next.js website and web moderator dashboard are maintained on [`webapp`](https://github.com/imnotmomo/nyc-restroom/tree/webapp). Branch ownership is documented in [docs/branches.md](docs/branches.md).

## Build the iPhone app

Use **Xcode 26.2 or newer**. Open `ios/Restroom Ready.xcodeproj` and select the **Restroom Ready** scheme. The minimum deployment target is iOS 18, the bundle identifier is **`coms4995.Restroom-Ready`**, and the existing Firebase project is **`nye-restroom`**. Keep the package pins, Apple capability and simulator/device entitlements intact.

The matching `ios/GoogleService-Info.plist` stays local and ignored. With an authorized Firebase CLI account, download the existing iOS app's configuration from the repository root:

```sh
npx -y firebase-tools@latest apps:sdkconfig IOS 1:547771536579:ios:0adadc776b8a591a297e76 --project nye-restroom --out ios/GoogleService-Info.plist
```

Run model checks:

```sh
swift test --package-path ios
```

See [ios/README.md](ios/README.md) for dependency, build, data and privacy details. Native MapKit does not require a browser MapKit JS token.

## Source and release status

The current source includes unreleased App Store content-reporting/privacy safeguards and the signup reliability repair. The repair passed **199 model tests** and a Firebase-linked **Xcode 26.2 / iOS Simulator 26.2** build before this branch split. Those checks do not establish physical-device authentication or Google Analytics ingestion.

The recorded released versions remain **1.0 (18)** for the existing internal Team and 4995 groups and **1.0 (19)** for Public Beta. Publishing this branch does not replace those builds or upload the held build 20 archive. Future internal releases default to **Team only**, unless explicitly requested otherwise.

## Shared services

`backend/account-deletion/` and `backend/moderation/` have their own package manifests and lockfiles. Shared Firebase rules/indexes are in `firebase/`; reviewed deployment procedures are under `deploy/account-deletion/` and `deploy/moderation/`. The website and native app continue using the same existing Firebase records and service endpoints.

Use the relevant Firebase agent skills before Firebase changes. Keep CLI sessions, service-account keys, Apple signing material, account exports and local build/deployment state out of Git. Code publication does not deploy services, change rules, migrate data or submit an App Store build.

## Backend checks

Use Node.js 24.12 or newer for the Firebase test tooling. Install the root development dependencies and each service package before running unit checks:

```sh
npm ci
npm --prefix backend/account-deletion ci
npm --prefix backend/moderation ci
npm test
```

Firebase rule and service-emulator suites require local emulators; never point them at the production project.
