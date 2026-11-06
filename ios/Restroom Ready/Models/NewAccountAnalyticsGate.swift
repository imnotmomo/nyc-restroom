import Foundation

/// Local duplicate guard only; identities must never be sent to Analytics.
struct NewAccountAnalyticsGate {
    private var countedAccounts: Set<String> = []

    static func method(providerID: String?) -> String? {
        switch providerID {
        case "google.com": "google"
        case "apple.com": "apple"
        default: nil
        }
    }

    /// Optional result metadata may omit the provider. The successful credential
    /// exchange still knows which allowlisted provider was used. An explicit
    /// disagreement must never be silently replaced by that fallback.
    static func confirmedProviderID(reported providerID: String?, credentialProviderID: String?) -> String? {
        guard let credentialProviderID else {
            return method(providerID: providerID) == nil ? nil : providerID
        }
        guard method(providerID: credentialProviderID) != nil,
              providerID == nil || providerID == credentialProviderID else { return nil }
        return credentialProviderID
    }

    mutating func consume(isNewUser: Bool?, providerID: String?, accountID: String,
                          currentAccountID: String?) -> Bool {
        guard isNewUser == true, Self.method(providerID: providerID) != nil, !accountID.isEmpty,
              currentAccountID == accountID, !countedAccounts.contains(accountID) else { return false }
        countedAccounts.insert(accountID)
        return true
    }
}
