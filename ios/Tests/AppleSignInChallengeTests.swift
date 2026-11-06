import XCTest
@testable import RestroomDirectory

final class AppleSignInChallengeTests: XCTestCase {
    func testNonceUsesKnownSHA256VectorWithoutSendingRawValue() {
        let challenge = AppleSignInChallenge(rawNonce: "abc", state: "separate-state")
        XCTAssertEqual(challenge.hashedNonce, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertNotEqual(challenge.hashedNonce, challenge.rawNonce)
        XCTAssertNotEqual(challenge.state, challenge.rawNonce)
    }

    func testFactoryRequestsSeparateSecure32ByteNonceAndState() throws {
        var requests: [Int] = []
        let challenge = try AppleSignInChallenge.create { count in
            requests.append(count)
            return [UInt8](repeating: UInt8(requests.count), count: count)
        }
        XCTAssertEqual(requests, [32, 32])
        XCTAssertEqual(challenge.rawNonce.utf8.count, 43)
        XCTAssertEqual(challenge.state.utf8.count, 43)
        XCTAssertNotEqual(challenge.rawNonce, challenge.state)
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
        XCTAssertTrue(challenge.rawNonce.unicodeScalars.allSatisfy(allowed.contains))
        XCTAssertTrue(challenge.state.unicodeScalars.allSatisfy(allowed.contains))
    }

    func testSystemSecureRandomProducesFreshIndependentChallenges() throws {
        let first = try AppleSignInChallenge.create()
        let second = try AppleSignInChallenge.create()
        XCTAssertNotEqual(first.rawNonce, second.rawNonce)
        XCTAssertNotEqual(first.state, second.state)
        XCTAssertNotEqual(first.rawNonce, first.state)
        XCTAssertEqual(first.hashedNonce.count, 64)
    }

    func testRandomFailureOrWrongByteCountCannotFallBackToPredictableValues() {
        enum Unavailable: Error { case failed }
        XCTAssertThrowsError(try AppleSignInChallenge.create { _ in throw Unavailable.failed })
        XCTAssertThrowsError(try AppleSignInChallenge.create { _ in [] })
        XCTAssertThrowsError(try AppleSignInChallenge.create { count in [UInt8](repeating: 0, count: count - 1) })
    }

    func testSuccessfulCallbackConsumesAttemptExactlyOnce() throws {
        let challenge = AppleSignInChallenge(rawNonce: "nonce", state: "request-state")
        var attempt = AppleSignInAttempt(challenge: challenge, sessionGeneration: 7)
        try attempt.accept(returnedState: "request-state", currentSessionGeneration: 7)
        XCTAssertTrue(attempt.isCompleted)
        XCTAssertThrowsError(try attempt.accept(returnedState: "request-state", currentSessionGeneration: 7))
        XCTAssertFalse(attempt.cancel())
    }

    func testCancellationConsumesAttemptAndRejectsLateSuccess() {
        let challenge = AppleSignInChallenge(rawNonce: "nonce", state: "request-state")
        var attempt = AppleSignInAttempt(challenge: challenge, sessionGeneration: 7)
        XCTAssertTrue(attempt.cancel())
        XCTAssertFalse(attempt.cancel())
        XCTAssertThrowsError(try attempt.accept(returnedState: "request-state", currentSessionGeneration: 7))
    }

    func testMissingOrMismatchedStateFailsClosedAndCannotBeReplayed() {
        let challenge = AppleSignInChallenge(rawNonce: "nonce", state: "request-state")
        for state in [nil, "", "another-state"] as [String?] {
            var attempt = AppleSignInAttempt(challenge: challenge, sessionGeneration: 7)
            XCTAssertThrowsError(try attempt.accept(returnedState: state, currentSessionGeneration: 7))
            XCTAssertTrue(attempt.isCompleted)
            XCTAssertThrowsError(try attempt.accept(returnedState: "request-state", currentSessionGeneration: 7))
        }
    }

    func testChangedSessionRejectsAppleResponseEvenForMatchingState() {
        let challenge = AppleSignInChallenge(rawNonce: "nonce", state: "request-state")
        var attempt = AppleSignInAttempt(challenge: challenge, sessionGeneration: 7)
        XCTAssertThrowsError(try attempt.accept(returnedState: "request-state", currentSessionGeneration: 8))
        XCTAssertTrue(attempt.isCompleted)
        XCTAssertThrowsError(try attempt.accept(returnedState: "request-state", currentSessionGeneration: 7))
    }
}
