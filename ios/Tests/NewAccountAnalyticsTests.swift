import XCTest
@testable import RestroomDirectory

final class NewAccountAnalyticsTests: XCTestCase {
    func testOnlyConfirmedNewGoogleAccountCountsOnce() {
        var gate = NewAccountAnalyticsGate()
        XCTAssertTrue(gate.consume(isNewUser: true, providerID: "google.com", accountID: "a", currentAccountID: "a"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "google.com", accountID: "a", currentAccountID: "a"))
        XCTAssertTrue(gate.consume(isNewUser: true, providerID: "google.com", accountID: "b", currentAccountID: "b"))
    }
    func testReturningUnknownAndStaleAccountsDoNotCount() {
        var gate = NewAccountAnalyticsGate()
        XCTAssertFalse(gate.consume(isNewUser: false, providerID: "google.com", accountID: "a", currentAccountID: "a"))
        XCTAssertFalse(gate.consume(isNewUser: nil, providerID: "google.com", accountID: "a", currentAccountID: "a"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: nil, accountID: "a", currentAccountID: "a"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "password", accountID: "a", currentAccountID: "a"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "google.com", accountID: "", currentAccountID: ""))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "google.com", accountID: "a", currentAccountID: nil))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "google.com", accountID: "a", currentAccountID: "b"))
        XCTAssertTrue(gate.consume(isNewUser: true, providerID: "google.com", accountID: "a", currentAccountID: "a"))
    }

    func testOnlyConfirmedNewAppleAccountsCountAndProvidersNeverDuplicateOneIdentity() {
        var gate = NewAccountAnalyticsGate()
        XCTAssertTrue(gate.consume(isNewUser: true, providerID: "apple.com", accountID: "apple-account", currentAccountID: "apple-account"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "apple.com", accountID: "apple-account", currentAccountID: "apple-account"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "google.com", accountID: "apple-account", currentAccountID: "apple-account"))
        XCTAssertFalse(gate.consume(isNewUser: false, providerID: "apple.com", accountID: "returning", currentAccountID: "returning"))
        XCTAssertFalse(gate.consume(isNewUser: nil, providerID: "apple.com", accountID: "unknown", currentAccountID: "unknown"))
        XCTAssertFalse(gate.consume(isNewUser: true, providerID: "apple.com", accountID: "stale", currentAccountID: "other"))
    }

    func testAnalyticsMethodsHaveOnlyTheTwoAllowedStaticValues() {
        XCTAssertEqual(NewAccountAnalyticsGate.method(providerID: "google.com"), "google")
        XCTAssertEqual(NewAccountAnalyticsGate.method(providerID: "apple.com"), "apple")
        for provider in [nil, "", "password", "anonymous", "Apple.com", "private@example.com"] as [String?] {
            XCTAssertNil(NewAccountAnalyticsGate.method(providerID: provider))
        }
    }

    func testMissingProviderMetadataUsesOnlyAKnownSuccessfulCredential() {
        for provider in ["google.com", "apple.com"] {
            XCTAssertEqual(NewAccountAnalyticsGate.confirmedProviderID(reported: nil,
                credentialProviderID: provider), provider)
            XCTAssertEqual(NewAccountAnalyticsGate.confirmedProviderID(reported: provider,
                credentialProviderID: provider), provider)
        }
        for credential in [nil, "", "password", "anonymous"] as [String?] {
            XCTAssertNil(NewAccountAnalyticsGate.confirmedProviderID(reported: nil,
                credentialProviderID: credential))
        }
    }

    func testProviderFallbackNeverOverridesExplicitMismatchesOrUnknownProviders() {
        for reported in ["apple.com", "password", "", "private@example.com"] {
            XCTAssertNil(NewAccountAnalyticsGate.confirmedProviderID(reported: reported,
                credentialProviderID: "google.com"))
        }
        XCTAssertNil(NewAccountAnalyticsGate.confirmedProviderID(reported: "google.com",
            credentialProviderID: "apple.com"))
        XCTAssertNil(NewAccountAnalyticsGate.confirmedProviderID(reported: "google.com",
            credentialProviderID: "password"))
    }
}
