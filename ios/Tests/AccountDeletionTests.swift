import Foundation
import XCTest
@testable import RestroomDirectory

final class AccountDeletionTests: XCTestCase {
    private func attempt(_ providers: [String] = ["google.com"]) throws -> AccountDeletionAttempt {
        try AccountDeletionAttempt(expectedUID: "confirmed-account", sessionGeneration: 12, providerIDs: providers)
    }

    private func begin(_ attempt: inout AccountDeletionAttempt) throws {
        try attempt.beginRequest(currentUID: "confirmed-account", isAnonymous: false, currentGeneration: 12)
    }

    func testAppleRevocationCannotBeBypassedUsingLinkedGoogleProvider() throws {
        XCTAssertEqual(try AccountDeletionProvider.linked(["google.com", "apple.com"]), .apple)
        XCTAssertEqual(try AccountDeletionProvider.linked(["apple.com", "google.com"]), .apple)
        XCTAssertEqual(try AccountDeletionProvider.linked(["google.com"]), .google)
        XCTAssertThrowsError(try AccountDeletionProvider.linked([]))
        XCTAssertThrowsError(try AccountDeletionProvider.linked(["password", "custom-provider"]))
    }

    func testNoCleanupRequestBeforeReauthentication() throws {
        var request = try attempt()
        XCTAssertThrowsError(try begin(&request))
        XCTAssertEqual(request.requestCount, 0)
        try request.didReauthenticate()
        try begin(&request)
        XCTAssertEqual(request.requestCount, 1)
        XCTAssertThrowsError(try request.didReauthenticate())
    }

    func testAppleCleanupRequiresSuccessfulRevocationAfterReauthentication() throws {
        var request = try attempt(["apple.com", "google.com"])
        XCTAssertThrowsError(try request.didRevokeApple())
        try request.didReauthenticate()
        XCTAssertThrowsError(try begin(&request))
        XCTAssertEqual(request.requestCount, 0)
        try request.didRevokeApple()
        try begin(&request)
        XCTAssertEqual(request.requestCount, 1)
        XCTAssertThrowsError(try request.didRevokeApple())
    }

    func testChangedAccountAnonymousAccountAndSameUIDReplacementAllFailClosed() throws {
        let request = try attempt()
        XCTAssertTrue(request.matches(currentUID: "confirmed-account", isAnonymous: false, currentGeneration: 12))
        for (uid, anonymous, generation) in [
            ("other-account" as String?, false, 12),
            (nil, false, 12),
            ("confirmed-account", true, 12),
            ("confirmed-account", false, 13)
        ] {
            XCTAssertFalse(request.matches(currentUID: uid, isAnonymous: anonymous, currentGeneration: generation))
            XCTAssertThrowsError(try request.check(currentUID: uid, isAnonymous: anonymous, currentGeneration: generation))
        }
    }

    func testSessionMustStillMatchBeforeRetry() throws {
        var request = try attempt()
        try request.didReauthenticate()
        try begin(&request)
        XCTAssertTrue(request.canRetry(transportFailure: true))
        XCTAssertThrowsError(try request.beginRequest(currentUID: "other-account", isAnonymous: false, currentGeneration: 13))
        XCTAssertEqual(request.requestCount, 1)
    }

    func testOnlyOneRetryFor503OrTransportAndNoOtherHTTPStatus() throws {
        var request = try attempt()
        XCTAssertFalse(request.canRetry(transportFailure: true))
        try request.didReauthenticate()
        try begin(&request)
        XCTAssertTrue(request.canRetry(httpStatus: 503))
        XCTAssertTrue(request.canRetry(transportFailure: true))
        for status in [200, 202, 301, 400, 401, 403, 404, 409, 429, 500, 502, 504] {
            XCTAssertFalse(request.canRetry(httpStatus: status))
        }
        try begin(&request)
        XCTAssertFalse(request.canRetry(httpStatus: 503))
        XCTAssertFalse(request.canRetry(transportFailure: true))
        XCTAssertThrowsError(try begin(&request))
        XCTAssertEqual(request.requestCount, 2)
    }

    func testCancellationAndTrustFailuresCannotTriggerAutomaticRetry() {
        for code in [URLError.cancelled, .badURL, .unsupportedURL, .userAuthenticationRequired,
                     .serverCertificateUntrusted, .secureConnectionFailed, .redirectToNonExistentLocation] {
            XCTAssertFalse(AccountDeletionAttempt.isRetryableTransport(code))
        }
        for code in [URLError.timedOut, .networkConnectionLost, .cannotConnectToHost, .notConnectedToInternet] {
            XCTAssertTrue(AccountDeletionAttempt.isRetryableTransport(code))
        }
    }

    func testLaterExplicitConfirmationResumesAlreadyAuthorizedRequestWithNewBoundedBudget() throws {
        var request = try attempt(["apple.com"])
        try request.didReauthenticate()
        try request.didRevokeApple()
        try begin(&request)
        try begin(&request)
        XCTAssertFalse(request.canRetry(transportFailure: true))
        let now = Date(timeIntervalSince1970: 1000)
        try request.resumeAfterUserConfirmation(currentUID: "confirmed-account", isAnonymous: false,
                                                  currentGeneration: 12, expiresAt: now.addingTimeInterval(60), now: now)
        XCTAssertEqual(request.requestCount, 0)
        // Provider reauthentication/revocation cannot run twice during this resume.
        XCTAssertThrowsError(try request.didReauthenticate())
        XCTAssertThrowsError(try request.didRevokeApple())
        try begin(&request)
        XCTAssertTrue(request.canRetry(httpStatus: 503))
        try request.confirm(httpStatus: 200, data: Data("{\"status\":\"deleted\"}".utf8))
        XCTAssertTrue(request.isConfirmed)
        XCTAssertFalse(request.canResumeAfterUserConfirmation(currentUID: "confirmed-account", isAnonymous: false,
                                                                currentGeneration: 12, expiresAt: now.addingTimeInterval(60), now: now))
    }

    func testExpiredUnsentOrReplacementSessionCannotResumeDeletion() throws {
        var request = try attempt()
        let now = Date(timeIntervalSince1970: 1000)
        XCTAssertFalse(request.canResumeAfterUserConfirmation(currentUID: "confirmed-account", isAnonymous: false,
                                                                currentGeneration: 12, expiresAt: now.addingTimeInterval(60), now: now))
        try request.didReauthenticate()
        try begin(&request)
        for (uid, generation, expiry) in [
            ("confirmed-account", 12, now),
            ("confirmed-account", 12, now.addingTimeInterval(-1)),
            ("other-account", 12, now.addingTimeInterval(60)),
            ("confirmed-account", 13, now.addingTimeInterval(60))
        ] {
            XCTAssertFalse(request.canResumeAfterUserConfirmation(currentUID: uid, isAnonymous: false,
                                                                    currentGeneration: generation, expiresAt: expiry, now: now))
            XCTAssertThrowsError(try request.resumeAfterUserConfirmation(currentUID: uid, isAnonymous: false,
                                                                           currentGeneration: generation, expiresAt: expiry, now: now))
            XCTAssertEqual(request.requestCount, 1)
        }
    }

    func testOnlyExact200DeletedObjectConfirmsDeletion() throws {
        for (status, body) in [
            (200, "{}"), (200, "{\"status\":\"pending\"}"),
            (200, "{\"status\":true}"), (200, "{\"status\":\"deleted\",\"uid\":\"ignored\"}"),
            (200, "[\"deleted\"]"), (200, "not json"),
            (202, "{\"status\":\"deleted\"}"), (401, "{\"status\":\"deleted\"}"),
            (404, "{\"status\":\"deleted\"}"), (503, "{\"status\":\"deleted\"}")
        ] {
            var request = try attempt()
            try request.didReauthenticate()
            try begin(&request)
            XCTAssertThrowsError(try request.confirm(httpStatus: status, data: Data(body.utf8)))
            XCTAssertFalse(request.isConfirmed)
        }
        var request = try attempt()
        try request.didReauthenticate()
        try begin(&request)
        try request.confirm(httpStatus: 200, data: Data("{\"status\":\"deleted\"}".utf8))
        XCTAssertTrue(request.isConfirmed)
        XCTAssertFalse(request.canRetry(transportFailure: true))
        XCTAssertThrowsError(try begin(&request))
        XCTAssertThrowsError(try request.confirm(httpStatus: 200, data: Data("{\"status\":\"deleted\"}".utf8)))
    }

    func testAResponseWithoutAnAuthorizedRequestOrOversizedBodyCannotConfirm() throws {
        var request = try attempt()
        XCTAssertThrowsError(try request.confirm(httpStatus: 200, data: Data("{\"status\":\"deleted\"}".utf8)))
        try request.didReauthenticate()
        try begin(&request)
        let oversized = String(repeating: " ", count: 4097) + "{\"status\":\"deleted\"}"
        XCTAssertThrowsError(try request.confirm(httpStatus: 200, data: Data(oversized.utf8)))
        XCTAssertFalse(request.isConfirmed)
    }

    func testAppleDeletionRequiresFreshUsableAuthorizationCode() throws {
        for code in [nil, "", " ", "fresh\ncode"] as [String?] {
            XCTAssertThrowsError(try AccountDeletionAttempt.appleAuthorizationCode(code))
        }
        XCTAssertEqual(try AccountDeletionAttempt.appleAuthorizationCode("fresh-one-use-code"), "fresh-one-use-code")
    }
}
