import XCTest
@testable import RestroomDirectory

final class NativeAnalyticsEventTests: XCTestCase {
    private var events: [NativeAnalyticsEvent] {
        var values: [NativeAnalyticsEvent] = [.filtersClear, .locateRequest, .directionsOpen, .sourceOpen, .privacyOpen, .venueSelect]
        values += NativeAnalyticsScreen.allCases.map(NativeAnalyticsEvent.screen)
        values += NativeAnalyticsSource.allCases.map(NativeAnalyticsEvent.cardOpen)
        values += NativeAnalyticsCardHeight.allCases.map(NativeAnalyticsEvent.cardHeight)
        values += NativeAnalyticsSection.allCases.flatMap { [.sectionExpansion($0, expanded: true), .sectionExpansion($0, expanded: false)] }
        values += NativeAnalyticsCountBucket.allCases.flatMap { [.searchSubmit(results: $0), .mapClusterOpen(size: $0)] }
        values += NativeAnalyticsCountBucket.allCases.map { .searchSubmit(results: $0, context: .address) }
        values += NativeAnalyticsFilter.allCases.flatMap { [.filterToggle($0, enabled: true), .filterToggle($0, enabled: false)] }
        values += NativeAnalyticsBrowseMode.allCases.map(NativeAnalyticsEvent.browseMode)
        values += NativeAnalyticsLocationOutcome.allCases.map(NativeAnalyticsEvent.locateResult)
        values += NativeAnalyticsForm.allCases.flatMap { [.formOpen($0), .formCancel($0)] }
        values += NativeAnalyticsProvider.allCases.flatMap { [.authStart($0), .authCancel($0), .signUp($0), .login($0)] }
        for provider in NativeAnalyticsProvider.allCases {
            values += NativeAnalyticsFailure.allCases.map { .authFailure(provider, $0) }
        }
        for action in NativeAnalyticsMutation.allCases {
            values.append(.mutationSucceeded(action))
            values += NativeAnalyticsFailure.allCases.map { .mutationFailed(action, $0) }
        }
        for mask in 0..<32 {
            values.append(.filtersApply(.init(clean: mask & 1 != 0, accessible: mask & 2 != 0,
                                             stairFree: mask & 4 != 0, publicAccess: mask & 8 != 0,
                                             elevatorAccess: mask & 16 != 0)))
        }
        return values
    }

    func testEveryTypedPayloadFitsGA4LimitsAndContainsNoSensitiveFields() {
        let forbidden: Set<String> = ["email", "uid", "user_id", "account_id", "place_id", "restroom_id", "report_id",
            "code", "passcode", "code_value", "note", "comment", "body", "search_term", "query", "address",
            "latitude", "longitude", "coordinates", "observed_at", "visit_time", "error_message", "url", "id_token"]
        for event in events {
            let payload = event.payload
            XCTAssertNotNil(payload.name.range(of: "^[a-z][a-z0-9_]{0,39}$", options: .regularExpression), payload.name)
            XCTAssertFalse(["firebase_", "google_", "ga_"].contains { payload.name.hasPrefix($0) })
            XCTAssertLessThanOrEqual(payload.parameters.count, 25)
            XCTAssertTrue(Set(payload.parameters.keys).isDisjoint(with: forbidden), payload.name)
            for (key, value) in payload.parameters {
                XCTAssertNotNil(key.range(of: "^[a-z][a-z0-9_]{0,39}$", options: .regularExpression), key)
                XCTAssertLessThanOrEqual(value.count, 100)
                XCTAssertFalse(value.contains("@")); XCTAssertFalse(value.contains("https://"))
                XCTAssertFalse(value.contains("\n"))
            }
        }
        XCTAssertLessThan(Set(events.map { $0.payload.name }).count, 500)
    }

    func testEventSemanticsSeparateIntentFromConfirmedMutationsAndPhysicalUse() {
        XCTAssertEqual(NativeAnalyticsEvent.cardHeight(.large).payload.name, "restroom_expand")
        XCTAssertEqual(NativeAnalyticsEvent.cardHeight(.medium).payload.name, "restroom_collapse")
        XCTAssertEqual(NativeAnalyticsEvent.directionsOpen.payload.name, "directions_open")
        XCTAssertEqual(NativeAnalyticsEvent.formOpen(.codeReport).payload.name, "form_open")
        XCTAssertEqual(NativeAnalyticsEvent.mutationSucceeded(.submitCodeReport).payload.name, "code_report_submit")
        XCTAssertEqual(NativeAnalyticsEvent.mutationFailed(.submitCodeReport, .network).payload.name, "action_error")
        XCTAssertEqual(NativeAnalyticsEvent.mutationFailed(.submitCodeReport, .network).payload.parameters["action_name"], "code_report_submit")
        XCTAssertFalse(events.contains { $0.payload.name == "restroom_used" || $0.payload.name == "arrived" })
        XCTAssertEqual(NativeAnalyticsEvent.screen(.finder).payload.parameters["screen_class"], "NativeRootView")
    }

    func testResultBucketsDoNotExposeExactSearchOrClusterSize() {
        for (count, expected) in [(-1, NativeAnalyticsCountBucket.unknown), (0, .zero), (1, .one), (2, .twoToFive),
                                  (5, .twoToFive), (6, .sixToTwenty), (20, .sixToTwenty), (21, .twentyOneToHundred),
                                  (100, .twentyOneToHundred), (101, .overHundred), (Int.max, .overHundred)] {
            XCTAssertEqual(NativeAnalyticsCountBucket.from(count), expected)
        }
        XCTAssertEqual(NativeAnalyticsEvent.searchSubmit(results: .from(94)).payload.parameters["result_count_bucket"], "21_to_100")
    }

    func testAllFilterCombinationsUseOnlyFiveFlagsAndCount() {
        let filters = NativeAnalyticsFilters(clean: true, accessible: true, stairFree: true, publicAccess: true, elevatorAccess: true)
        XCTAssertEqual(filters.parameters["filter_count"], "5")
        XCTAssertEqual(NativeAnalyticsFilters().parameters["filter_count"], "0")
        XCTAssertEqual(Set(filters.parameters.keys), ["clean", "accessible", "stair_free", "public_access", "elevator_access", "filter_count"])
    }

    func testStableReceiptDedupKeepsFailuresAndDifferentAtomicSuccessesDistinct() throws {
        var gate = NativeAnalyticsDeduplicationGate()
        let privateKey = "private-account:private-document:private-timestamp"
        let failure = NativeAnalyticsEvent.mutationFailed(.submitVisitNote, .network)
        let note = NativeAnalyticsEvent.mutationSucceeded(.submitVisitNote)
        let code = NativeAnalyticsEvent.mutationSucceeded(.submitCodeReport)
        XCTAssertTrue(gate.consume(failure, key: privateKey))
        XCTAssertFalse(gate.consume(failure, key: privateKey))
        XCTAssertTrue(gate.consume(note, key: privateKey))
        XCTAssertFalse(gate.consume(note, key: privateKey))
        XCTAssertTrue(gate.consume(code, key: privateKey))
        XCTAssertTrue(gate.consume(.mutationFailed(.submitCodeReport, .network), key: privateKey))
        XCTAssertTrue(gate.consume(.mutationFailed(.submitVisitNote, .permissionDenied), key: privateKey))
        let text = String(decoding: try JSONEncoder().encode(note.payload), as: UTF8.self)
        XCTAssertFalse(text.contains(privateKey)); XCTAssertFalse(text.contains("private-account"))
    }

    func testDedupStorageIsBoundedAndExplicitNewIntentsAreNotSuppressed() {
        var gate = NativeAnalyticsDeduplicationGate(capacity: 2)
        let event = NativeAnalyticsEvent.mutationSucceeded(.submitRating)
        XCTAssertTrue(gate.consume(event, key: "1"))
        XCTAssertFalse(gate.consume(event, key: "1"))
        XCTAssertTrue(gate.consume(event, key: "2"))
        XCTAssertTrue(gate.consume(event, key: "3"))
        XCTAssertTrue(gate.consume(event, key: "1"))
        XCTAssertTrue(gate.consume(event, key: nil)); XCTAssertTrue(gate.consume(event, key: nil))
    }

    func testSignupAndReturningLoginRemainDifferentAcrossProvidersAndStaleSessions() {
        var gate = NativeAnalyticsAccountGate()
        XCTAssertEqual(gate.event(isNewUser: true, providerID: "google.com", accountID: "g", currentAccountID: "g"), .signUp(.google))
        XCTAssertNil(gate.event(isNewUser: true, providerID: "google.com", accountID: "g", currentAccountID: "g"))
        XCTAssertEqual(gate.event(isNewUser: true, providerID: "apple.com", accountID: "a", currentAccountID: "a"), .signUp(.apple))
        XCTAssertEqual(gate.event(isNewUser: false, providerID: "apple.com", accountID: "a", currentAccountID: "a"), .login(.apple))
        XCTAssertEqual(gate.event(isNewUser: false, providerID: "google.com", accountID: "g", currentAccountID: "g"), .login(.google))
        XCTAssertNil(gate.event(isNewUser: true, providerID: "google.com", accountID: "stale", currentAccountID: "other"))
        XCTAssertNil(gate.event(isNewUser: true, providerID: "password", accountID: "x", currentAccountID: "x"))
        XCTAssertEqual(gate.event(isNewUser: nil, providerID: "google.com", accountID: "g", currentAccountID: "g"), .login(.google))
        XCTAssertNil(gate.event(isNewUser: false, providerID: "apple.com", accountID: "", currentAccountID: ""))
    }

    func testSuccessfulCredentialRecoversMissingProviderWithoutInferringNewAccounts() {
        var gate = NativeAnalyticsAccountGate()
        for (providerID, provider) in [("google.com", NativeAnalyticsProvider.google), ("apple.com", .apple)] {
            let account = "private-\(providerID)"
            XCTAssertEqual(gate.event(isNewUser: true, providerID: nil, accountID: account,
                currentAccountID: account, credentialProviderID: providerID), .signUp(provider))
            XCTAssertNil(gate.event(isNewUser: true, providerID: nil, accountID: account,
                currentAccountID: account, credentialProviderID: providerID))
            XCTAssertEqual(gate.event(isNewUser: false, providerID: nil, accountID: account,
                currentAccountID: account, credentialProviderID: providerID), .login(provider))
            XCTAssertEqual(gate.event(isNewUser: nil, providerID: nil, accountID: "unknown",
                currentAccountID: "unknown", credentialProviderID: providerID), .login(provider))
            XCTAssertNil(gate.event(isNewUser: true, providerID: nil, accountID: "stale",
                currentAccountID: "other", credentialProviderID: providerID))
        }
    }

    func testMismatchedMetadataDoesNotConsumeTheSignupReceipt() {
        var gate = NativeAnalyticsAccountGate()
        for providerID in ["apple.com", "password", ""] {
            XCTAssertNil(gate.event(isNewUser: true, providerID: providerID, accountID: "a",
                currentAccountID: "a", credentialProviderID: "google.com"))
        }
        XCTAssertEqual(gate.event(isNewUser: true, providerID: nil, accountID: "a",
            currentAccountID: "a", credentialProviderID: "google.com"), .signUp(.google))
    }
}
