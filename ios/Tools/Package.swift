// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "NativeProjectTools",
    platforms: [.macOS(.v13)],
    dependencies: [
        .package(url: "https://github.com/tuist/XcodeProj.git", exact: "8.27.7"),
        .package(url: "https://github.com/tadija/AEXML.git", exact: "4.7.0")
    ],
    targets: [.executableTarget(name: "ConfigureNative", dependencies: ["XcodeProj"], path: "Sources")]
)
