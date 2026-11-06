import Foundation
import CryptoKit

enum RestroomSubmissionStatus: String, CaseIterable, Sendable {
    case pending, approved, denied

    var title: String {
        switch self {
        case .pending: "Awaiting approval"
        case .approved: "Approved"
        case .denied: "Not approved"
        }
    }

    var confirmationMessage: String {
        switch self {
        case .pending: "Your request will appear on the map after moderator approval. Check its status in Account → Restroom requests."
        case .approved: "This request has already been approved. You can find the restroom on the map."
        case .denied: "This request was not approved. Check Restroom requests in Account for the reason."
        }
    }
}

enum RestroomSubmissionReason: String, CaseIterable, Sendable {
    case duplicate, insufficientDetails = "insufficient_details", incorrectLocation = "incorrect_location"
    case restrictedAccess = "restricted_access", other

    var title: String {
        switch self {
        case .duplicate: "This restroom is already listed."
        case .insufficientDetails: "More venue details are needed."
        case .incorrectLocation: "The location needs correcting."
        case .restrictedAccess: "The reported access needs checking."
        case .other: "A moderator did not approve this request."
        }
    }
}

enum RestroomSubmissionError: Error { case invalid }

/// Validated private status metadata, with no code or ownership identity.
struct RestroomSubmissionState: Equatable, Sendable {
    let status: RestroomSubmissionStatus
    let revision: Int
    let reviewedAt: Date?
    let reason: RestroomSubmissionReason?

    init(schemaVersion: Int, status: String, revision: Int, submittedAt: Date,
         reviewedAt: Date?, reason: String?) throws {
        guard schemaVersion == 1, let status = RestroomSubmissionStatus(rawValue: status),
              submittedAt >= Date(timeIntervalSince1970: 946_684_800) else { throw RestroomSubmissionError.invalid }
        if status == .pending {
            guard revision == 1, reviewedAt == nil, reason == nil else { throw RestroomSubmissionError.invalid }
            self.reason = nil
        } else {
            guard revision == 2, let reviewedAt, reviewedAt >= submittedAt, let reason else { throw RestroomSubmissionError.invalid }
            if status == .approved {
                guard reason.isEmpty else { throw RestroomSubmissionError.invalid }
                self.reason = nil
            } else {
                guard let value = RestroomSubmissionReason(rawValue: reason) else { throw RestroomSubmissionError.invalid }
                self.reason = value
            }
        }
        self.status = status; self.revision = revision; self.reviewedAt = reviewedAt
    }
}

/// This commitment stays in private request confirmation only. Never include it
/// in Analytics, URLs, errors, public records, or a moderator response.
enum RestroomSubmissionCodeCommitment {
    static func fingerprint(normalizedCode: String, visibility: String) throws -> String {
        guard ["private", "public"].contains(visibility), !normalizedCode.isEmpty,
              normalizedCode.utf8.count <= 40,
              normalizedCode == normalizedCode.trimmingCharacters(in: .whitespacesAndNewlines),
              normalizedCode.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else {
            throw RestroomSubmissionError.invalid
        }
        let input = "rr-request-code-v1\u{0}" + visibility + "\u{0}" + normalizedCode
        return SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func valid(_ value: String) -> Bool {
        value.count == 64 && value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }
}
