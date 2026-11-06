import Foundation

enum AccountDeletionError: LocalizedError, Equatable {
    case sessionChanged, unsupportedProvider, invalidAuthorization, invalidState, notConfirmed

    var errorDescription: String? {
        switch self {
        case .sessionChanged:
            "Your account session changed. Check the original account before retrying deletion."
        case .unsupportedProvider:
            "This account could not be verified with Apple or Google. Sign in with its original provider and retry."
        case .invalidAuthorization:
            "Apple did not return a deletion authorization. Retry with the same Apple account."
        case .invalidState, .notConfirmed:
            "Account deletion could not be confirmed. Check your connection and retry; the account may already have been deleted."
        }
    }
}

enum AccountDeletionProvider: Equatable {
    case apple, google

    static func linked(_ providerIDs: [String]) throws -> Self {
        // Apple authorization must also be revoked when both providers are linked.
        if providerIDs.contains("apple.com") { return .apple }
        if providerIDs.contains("google.com") { return .google }
        throw AccountDeletionError.unsupportedProvider
    }
}

/// One user-confirmed attempt. It cannot send cleanup before reauthentication and
/// Apple revocation, or send more than one retry with the same in-memory token.
struct AccountDeletionAttempt {
    let expectedUID: String
    let sessionGeneration: Int
    let provider: AccountDeletionProvider
    private(set) var requestCount = 0
    private(set) var isConfirmed = false
    private var reauthenticated = false
    private var appleRevoked = false

    init(expectedUID: String, sessionGeneration: Int, providerIDs: [String]) throws {
        guard !expectedUID.isEmpty, expectedUID.utf16.count <= 128, !expectedUID.contains("/") else {
            throw AccountDeletionError.sessionChanged
        }
        self.expectedUID = expectedUID
        self.sessionGeneration = sessionGeneration
        provider = try .linked(providerIDs)
    }

    func matches(currentUID: String?, isAnonymous: Bool, currentGeneration: Int) -> Bool {
        currentUID == expectedUID && !isAnonymous && currentGeneration == sessionGeneration
    }

    func check(currentUID: String?, isAnonymous: Bool, currentGeneration: Int) throws {
        guard matches(currentUID: currentUID, isAnonymous: isAnonymous, currentGeneration: currentGeneration) else {
            throw AccountDeletionError.sessionChanged
        }
    }

    mutating func didReauthenticate() throws {
        guard !reauthenticated, requestCount == 0, !isConfirmed else { throw AccountDeletionError.invalidState }
        reauthenticated = true
    }

    mutating func didRevokeApple() throws {
        guard provider == .apple, reauthenticated, !appleRevoked, requestCount == 0, !isConfirmed else {
            throw AccountDeletionError.invalidState
        }
        appleRevoked = true
    }

    mutating func beginRequest(currentUID: String?, isAnonymous: Bool, currentGeneration: Int) throws {
        try check(currentUID: currentUID, isAnonymous: isAnonymous, currentGeneration: currentGeneration)
        guard reauthenticated, provider != .apple || appleRevoked, requestCount < 2, !isConfirmed else {
            throw AccountDeletionError.invalidState
        }
        requestCount += 1
    }

    func canRetry(httpStatus: Int? = nil, transportFailure: Bool = false) -> Bool {
        requestCount == 1 && !isConfirmed && (httpStatus == 503 || transportFailure)
    }

    func canResumeAfterUserConfirmation(currentUID: String?, isAnonymous: Bool, currentGeneration: Int,
                                        expiresAt: Date, now: Date) -> Bool {
        requestCount > 0 && !isConfirmed && reauthenticated && (provider != .apple || appleRevoked) &&
            expiresAt > now && matches(currentUID: currentUID, isAnonymous: isAnonymous, currentGeneration: currentGeneration)
    }

    mutating func resumeAfterUserConfirmation(currentUID: String?, isAnonymous: Bool, currentGeneration: Int,
                                               expiresAt: Date, now: Date) throws {
        guard canResumeAfterUserConfirmation(currentUID: currentUID, isAnonymous: isAnonymous,
                                               currentGeneration: currentGeneration, expiresAt: expiresAt, now: now) else {
            throw AccountDeletionError.invalidState
        }
        // A new explicit confirmation permits one new bounded request/retry batch.
        // Reuse the same token and provider authorization rather than creating an account.
        requestCount = 0
    }

    mutating func confirm(httpStatus: Int, data: Data) throws {
        guard requestCount > 0, !isConfirmed, httpStatus == 200, data.count <= 4096,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              body.count == 1, body["status"] as? String == "deleted" else {
            throw AccountDeletionError.notConfirmed
        }
        isConfirmed = true
    }

    static func appleAuthorizationCode(_ code: String?) throws -> String {
        guard let code, !code.isEmpty, !code.contains(where: \.isWhitespace) else {
            throw AccountDeletionError.invalidAuthorization
        }
        return code
    }

    static func isRetryableTransport(_ code: URLError.Code) -> Bool {
        switch code {
        case .timedOut, .cannotFindHost, .cannotConnectToHost, .networkConnectionLost,
             .dnsLookupFailed, .notConnectedToInternet, .resourceUnavailable,
             .backgroundSessionWasDisconnected:
            true
        default:
            false
        }
    }
}
