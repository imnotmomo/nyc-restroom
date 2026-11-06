import CryptoKit
import Foundation
import Security

enum AppleSignInError: LocalizedError {
    case secureRandomUnavailable, invalidResponse, stateMismatch, staleSession, alreadyCompleted, alreadyStarted

    var errorDescription: String? {
        switch self {
        case .secureRandomUnavailable: "Apple sign-in could not create a secure request. Please retry."
        case .staleSession: "Your account session changed while Apple sign-in was open. Retry from the current account."
        default: "Apple sign-in could not be confirmed. Please retry."
        }
    }
}

/// Request secrets live only for this attempt and are never logged or sent to Analytics.
struct AppleSignInChallenge {
    let rawNonce: String
    let state: String

    var hashedNonce: String {
        SHA256.hash(data: Data(rawNonce.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func create(randomBytes: (Int) throws -> [UInt8] = secureBytes) throws -> Self {
        func randomValue() throws -> String {
            let bytes = try randomBytes(32)
            guard bytes.count == 32 else { throw AppleSignInError.secureRandomUnavailable }
            return Data(bytes).base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        return try Self(rawNonce: randomValue(), state: randomValue())
    }

    private static func secureBytes(count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw AppleSignInError.secureRandomUnavailable
        }
        return bytes
    }
}

/// One success, cancellation or failure may consume an Apple authorization attempt.
struct AppleSignInAttempt {
    let challenge: AppleSignInChallenge
    let sessionGeneration: Int
    private(set) var isCompleted = false

    mutating func accept(returnedState: String?, currentSessionGeneration: Int) throws {
        guard !isCompleted else { throw AppleSignInError.alreadyCompleted }
        isCompleted = true
        guard returnedState == challenge.state else { throw AppleSignInError.stateMismatch }
        guard currentSessionGeneration == sessionGeneration else { throw AppleSignInError.staleSession }
    }

    @discardableResult
    mutating func cancel() -> Bool {
        guard !isCompleted else { return false }
        isCompleted = true
        return true
    }
}
