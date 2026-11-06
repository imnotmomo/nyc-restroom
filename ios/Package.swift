// swift-tools-version: 5.9
import PackageDescription

// Pure directory and filter checks run independently of Firebase/Xcode signing.
let package = Package(
    name: "RestroomDirectoryChecks",
    platforms: [.macOS(.v14)],
    products: [.library(name: "RestroomDirectory", targets: ["RestroomDirectory"])],
    targets: [
        .target(name: "RestroomDirectory", path: "Restroom Ready/Models"),
        .testTarget(name: "DirectoryTests", dependencies: ["RestroomDirectory"], path: "Tests")
    ]
)
