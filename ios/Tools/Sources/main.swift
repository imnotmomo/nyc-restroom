import Foundation
import XcodeProj
import PathKit

// Use XcodeProj's typed model instead of patching the serialized project text.
let iosRoot = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "ios", isDirectory: true)
let projectPath = Path(iosRoot.appendingPathComponent("Restroom Ready.xcodeproj").path)
let configURL = iosRoot.appendingPathComponent("GoogleService-Info.plist")
let configData = try Data(contentsOf: configURL)
guard let config = try PropertyListSerialization.propertyList(from: configData, format: nil) as? [String: Any],
      let scheme = config["REVERSED_CLIENT_ID"] as? String,
      let bundleID = config["BUNDLE_ID"] as? String,
      config["PROJECT_ID"] as? String == "nye-restroom" else {
    fatalError("Download the matching iOS Firebase config before configuring the project.")
}
let project = try XcodeProj(path: projectPath)
guard let target = project.pbxproj.nativeTargets.first(where: { $0.productType == .application }) else { fatalError("Missing app target") }
guard let root = try project.pbxproj.rootProject() else { fatalError("Missing root project") }
var targetAttributes = root.attributes(for: target) ?? [:]
var capabilities = targetAttributes["SystemCapabilities"] as? [String: Any] ?? [:]
var appleSignIn = capabilities["com.apple.SignInWithApple"] as? [String: Any] ?? [:]
appleSignIn["enabled"] = 1
capabilities["com.apple.SignInWithApple"] = appleSignIn
targetAttributes["SystemCapabilities"] = capabilities
root.setTargetAttributes(targetAttributes, target: target)
if !(target.packageProductDependencies ?? []).contains(where: { $0.productName == "RestroomBackendDependencies" }) {
    _ = try root.addLocalSwiftPackage(path: Path("NativeDependencies"), productName: "RestroomBackendDependencies", targetName: target.name)
}
if !root.localPackages.contains(where: { $0.relativePath == "NativeDependencies" }) {
    let local = XCLocalSwiftPackageReference(relativePath: "NativeDependencies")
    project.pbxproj.add(object: local)
    root.localPackages.append(local)
}
// GoogleSignIn 10.0.0's AppCheck <12 range conflicts with Firebase 13.
// This exact official Google commit adds AppCheck 12 support; do not track a moving branch.
if let google = try project.pbxproj.rootProject()?.remotePackages.first(where: {
    $0.repositoryURL == "https://github.com/google/GoogleSignIn-iOS"
}) {
    google.versionRequirement = .revision("4ce331c226c24cfee688b31e9c3731cc5c5e2862")
}
for build in target.buildConfigurationList?.buildConfigurations ?? [] {
    guard build.buildSettings["PRODUCT_BUNDLE_IDENTIFIER"] as? String == bundleID else {
        fatalError("Firebase and Xcode bundle identifiers do not match.")
    }
    build.buildSettings["INFOPLIST_FILE"] = "Configuration/Info.plist"
    build.buildSettings["GENERATE_INFOPLIST_FILE"] = "YES"
    build.buildSettings["SWIFT_STRICT_CONCURRENCY"] = "targeted"
    build.buildSettings["CODE_SIGN_ENTITLEMENTS"] = "Configuration/App.entitlements"
    // Simulator ad-hoc signing needs an explicit app identity for Firebase/Google Keychain storage.
    // Keep this conditional so device and TestFlight provisioning remain managed by Xcode.
    build.buildSettings["CODE_SIGN_ENTITLEMENTS[sdk=iphonesimulator*]"] = "Configuration/Simulator.entitlements"
    build.buildSettings["CODE_SIGNING_ALLOWED[sdk=iphonesimulator*]"] = "YES"
    build.buildSettings["CODE_SIGN_IDENTITY[sdk=iphonesimulator*]"] = "-"
    var flags = build.buildSettings["OTHER_LDFLAGS"] as? [String] ?? ["$(inherited)"]
    if !flags.contains("$(inherited)") { flags.insert("$(inherited)", at: 0) }
    if !flags.contains("-ObjC") { flags.append("-ObjC") }
    build.buildSettings["OTHER_LDFLAGS"] = flags
}
let info: [String: Any] = [
    "CFBundleDisplayName": "Restroom Ready",
    "CFBundleURLTypes": [["CFBundleTypeRole": "Editor", "CFBundleURLSchemes": [scheme]]],
    "NSLocationWhenInUseUsageDescription": "Use your approximate location to find nearby NYC restrooms or choose a nearby venue. Your location is not posted to the restroom database.",
    "ITSAppUsesNonExemptEncryption": false,
    "FIREBASE_ANALYTICS_COLLECTION_ENABLED": false,
    "FirebaseAutomaticScreenReportingEnabled": false,
    "GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED": false,
    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE": false,
    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE": false,
    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA": false,
    "GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS": false
]
let configurationDir = iosRoot.appendingPathComponent("Configuration", isDirectory: true)
try FileManager.default.createDirectory(at: configurationDir, withIntermediateDirectories: true)
let infoData = try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
try infoData.write(to: configurationDir.appendingPathComponent("Info.plist"), options: .atomic)
let appleSignInEntitlement = ["Default"]
let appEntitlements: [String: Any] = [
    "com.apple.developer.applesignin": appleSignInEntitlement
]
let appData = try PropertyListSerialization.data(fromPropertyList: appEntitlements, format: .xml, options: 0)
try appData.write(to: configurationDir.appendingPathComponent("App.entitlements"), options: .atomic)
let simulatorIdentity = "$(DEVELOPMENT_TEAM).$(PRODUCT_BUNDLE_IDENTIFIER)"
let simulatorEntitlements: [String: Any] = [
    "application-identifier": simulatorIdentity,
    "keychain-access-groups": [simulatorIdentity],
    "com.apple.developer.applesignin": appleSignInEntitlement
]
let simulatorData = try PropertyListSerialization.data(fromPropertyList: simulatorEntitlements, format: .xml, options: 0)
try simulatorData.write(to: configurationDir.appendingPathComponent("Simulator.entitlements"), options: .atomic)

// Read-only UI tests use a synchronized folder and a separate shared test scheme.
// No per-source PBX references are necessary.
let testName = "RestroomReadyUITests"
let testTarget: PBXNativeTarget
if let existing = project.pbxproj.nativeTargets.first(where: { $0.name == testName }) {
    testTarget = existing
} else {
    let debug = XCBuildConfiguration(name: "Debug", buildSettings: [
        "PRODUCT_BUNDLE_IDENTIFIER": "coms4995.Restroom-Ready.UITests",
        "PRODUCT_NAME": "$(TARGET_NAME)", "GENERATE_INFOPLIST_FILE": "YES",
        "SWIFT_VERSION": "5.0", "IPHONEOS_DEPLOYMENT_TARGET": "18.0",
        "SDKROOT": "iphoneos", "TARGETED_DEVICE_FAMILY": "1,2",
        "TEST_TARGET_NAME": target.name, "CODE_SIGN_STYLE": "Automatic"
    ])
    let release = XCBuildConfiguration(name: "Release", buildSettings: debug.buildSettings)
    let configurations = XCConfigurationList(buildConfigurations: [debug, release], defaultConfigurationName: "Debug")
    let sources = PBXSourcesBuildPhase(), frameworks = PBXFrameworksBuildPhase(), resources = PBXResourcesBuildPhase()
    let product = PBXFileReference(sourceTree: .buildProductsDir, explicitFileType: "wrapper.cfbundle", path: testName + ".xctest", includeInIndex: false)
    let folder = PBXFileSystemSynchronizedRootGroup(sourceTree: .group, path: "UITests")
    testTarget = PBXNativeTarget(name: testName, buildConfigurationList: configurations,
                               buildPhases: [sources, frameworks, resources], productName: testName,
                               product: product, productType: .uiTestBundle)
    for object: PBXObject in [debug, release, configurations, sources, frameworks, resources, product, folder, testTarget] {
        project.pbxproj.add(object: object)
    }
    root.targets.append(testTarget)
    root.mainGroup.children.append(folder)
    root.productsGroup?.children.append(product)
    testTarget.fileSystemSynchronizedGroups = [folder]
    _ = try testTarget.addDependency(target: target)
}
try project.write(path: projectPath)
let appRef = XCScheme.BuildableReference(referencedContainer: "container:Restroom Ready.xcodeproj", blueprint: target, buildableName: "Restroom Ready.app", blueprintName: target.name)
let testRef = XCScheme.BuildableReference(referencedContainer: "container:Restroom Ready.xcodeproj", blueprint: testTarget, buildableName: testName + ".xctest", blueprintName: testName)
let uiScheme = XCScheme(name: "Restroom Ready UI", lastUpgradeVersion: "2620", version: "1.3",
    buildAction: XCScheme.BuildAction(buildActionEntries: [XCScheme.BuildAction.Entry(buildableReference: appRef, buildFor: [.testing, .running]), XCScheme.BuildAction.Entry(buildableReference: testRef, buildFor: [.testing])], buildImplicitDependencies: true),
    testAction: XCScheme.TestAction(buildConfiguration: "Debug", macroExpansion: appRef,
                                   testables: [XCScheme.TestableReference(skipped: false, parallelization: .none, buildableReference: testRef)]))
let schemesDir = projectPath + Path("xcshareddata/xcschemes")
try schemesDir.mkpath()
try uiScheme.write(path: schemesDir + Path("Restroom Ready UI.xcscheme"), override: true)
print("Configured Apple Sign-in capability, native URL callback, location purpose, Firebase linker flag, matching bundle ID and Simulator Keychain identity.")
