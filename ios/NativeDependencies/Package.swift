// swift-tools-version: 6.2
import PackageDescription

// Xcode 26.2 supports SwiftPM traits in manifests but has no package-trait UI.
// This explicit dependency edge enables the required Firestore feature graph-wide.
let package = Package(
    name: "RestroomBackendDependencies",
    platforms: [.iOS(.v18)],
    products: [.library(name: "RestroomBackendDependencies", targets: ["RestroomBackendDependencies"])],
    dependencies: [
        .package(url: "https://github.com/firebase/firebase-ios-sdk", from: "13.1.1", traits: ["Firestore"])
    ],
    targets: [
        .target(name: "RestroomBackendDependencies", dependencies: [
            .product(name: "FirebaseCore", package: "firebase-ios-sdk"),
            .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
            .product(name: "FirebaseAnalyticsCore", package: "firebase-ios-sdk"),
            .product(name: "FirebaseFirestore", package: "firebase-ios-sdk")
        ], path: "Sources")
    ]
)
