import Foundation
import CryptoKit

enum ContentReportKind: String, CaseIterable, Sendable {
    case publicNote = "public-note", unifiedVisit = "unified-visit"
    case sourceComment = "source-comment", researchComment = "research-comment"
    case legacyCode = "legacy-code", codeReport = "v2-code"

    var isImported: Bool { self == .sourceComment || self == .researchComment }
}

enum ContentReportReason: String, CaseIterable, Identifiable, Sendable {
    case personalInformation = "personal_information", harassment, sexualContent = "sexual_content"
    case spam, misleading, other
    var id: String { rawValue }
    var title: String {
        switch self {
        case .personalInformation: "Personal information"
        case .harassment: "Harassment or abuse"
        case .sexualContent: "Sexual content"
        case .spam: "Spam"
        case .misleading: "Incorrect or misleading information"
        case .other: "Other"
        }
    }
}

enum ContentReportError: LocalizedError, Equatable {
    case invalidTarget, notConfirmed, authenticationRequired, suspended, unavailable, outdated, conflict, rateLimited
    var errorDescription: String? {
        switch self {
        case .invalidTarget: "This content could not be selected safely. Refresh the restroom and try again."
        case .authenticationRequired: "Refresh your account, then retry this same report."
        case .suspended: "This account cannot submit reports right now. Contact support for help."
        case .outdated: "This content changed or is no longer available. Refresh the restroom before reporting it."
        case .conflict: "An earlier version of this report was already received. Cancel and start a new report if needed."
        case .rateLimited: "Too many reports were submitted recently. Keep this report and try again later."
        case .unavailable: "Reporting is temporarily unavailable. Keep this report and try again later."
        case .notConfirmed: "Your report could not be confirmed. Retry this same report before starting another."
        }
    }
}

/// Private moderation targets contain a source reference and version pin only.
/// No comment body, author identity, source URL or reason is sent to Analytics.
struct ContentReportTarget: Equatable, Identifiable, Sendable {
    let kind: ContentReportKind
    let placeID: String
    let recordID: String
    let postedAt: String?
    let contentHash: String?
    var id: String { "\(kind.rawValue):\(placeID):\(recordID):\(postedAt ?? contentHash ?? "")" }

    init(kind: ContentReportKind, placeID: String, recordID: String, postedAt: String? = nil,
         contentHash: String? = nil) throws {
        guard placeID.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$", options: .regularExpression) != nil,
              !placeID.hasPrefix("community-") || placeID.range(of: "^community-[A-Za-z0-9]{20}$", options: .regularExpression) != nil else {
            throw ContentReportError.invalidTarget
        }
        if kind.isImported {
            guard recordID.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$", options: .regularExpression) != nil,
                  postedAt == nil, let contentHash,
                  contentHash.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
                throw ContentReportError.invalidTarget
            }
        } else {
            guard recordID.range(of: "^[A-Za-z0-9]{20}$", options: .regularExpression) != nil,
                  contentHash == nil, let postedAt, let version = CodeTimestampVersion(postedAt),
                  version.seconds >= 946_684_800, version.seconds < 253_402_300_800 else {
                throw ContentReportError.invalidTarget
            }
        }
        self.kind = kind; self.placeID = placeID; self.recordID = recordID
        self.postedAt = postedAt; self.contentHash = contentHash
    }

    static func imported(kind: ContentReportKind, placeID: String, recordID: String, text: String) throws -> Self {
        guard kind.isImported else { throw ContentReportError.invalidTarget }
        let hash = SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
        return try Self(kind: kind, placeID: placeID, recordID: recordID, contentHash: hash)
    }
}

/// One explicit submission, kept unchanged across ambiguous responses and retries.
struct ContentReportAttempt: Equatable, Sendable {
    let target: ContentReportTarget
    let reason: ContentReportReason
    let actionID: String

    init(target: ContentReportTarget, reason: ContentReportReason, actionID: String = UUID().uuidString.lowercased()) throws {
        guard actionID.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: [.regularExpression, .caseInsensitive]) != nil else {
            throw ContentReportError.invalidTarget
        }
        self.target = target; self.reason = reason; self.actionID = actionID
    }

    func encodedBody() throws -> Data {
        var value = ["kind": target.kind.rawValue, "placeID": target.placeID, "recordID": target.recordID,
                     "reason": reason.rawValue, "actionId": actionID]
        if let posted = target.postedAt { value["postedAt"] = posted }
        if let hash = target.contentHash { value["contentHash"] = hash }
        // Every value above is bounded and constructed locally.
        return try JSONSerialization.data(withJSONObject: value, options: .sortedKeys)
    }

    func confirm(httpStatus: Int, data: Data) throws {
        guard data.count <= 4096, let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ContentReportError.notConfirmed
        }
        if httpStatus == 200 {
            guard Set(value.keys) == ["status", "reportID"], value["status"] as? String == "received",
                  value["reportID"] as? String == actionID else { throw ContentReportError.notConfirmed }
            return
        }
        guard Set(value.keys) == ["error"], let error = value["error"] as? String else { throw ContentReportError.notConfirmed }
        switch (httpStatus, error) {
        case (401, "authentication_required"), (403, "reporter_required"): throw ContentReportError.authenticationRequired
        case (403, "contribution_suspended"): throw ContentReportError.suspended
        case (404, "not_found"), (409, "stale_revision"): throw ContentReportError.outdated
        case (409, "action_conflict"): throw ContentReportError.conflict
        case (429, "rate_limited"): throw ContentReportError.rateLimited
        case (503, "moderation_unavailable"): throw ContentReportError.unavailable
        default: throw ContentReportError.notConfirmed
        }
    }
}

enum PublicContributionStatus: String, Sendable {
    case allowed, suspended

    static func decode(_ data: Data) throws -> Self {
        guard data.count <= 1024, let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(value.keys) == ["status"], let raw = value["status"] as? String,
              let status = Self(rawValue: raw) else { throw ContentReportError.notConfirmed }
        return status
    }
}
