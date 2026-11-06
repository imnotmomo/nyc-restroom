import Foundation

enum CodeFeedback: String, Equatable, Sendable { case used, invalid }
enum CodeEvidenceSource: String, Equatable, Sendable {
    case legacy, report
    var wireKind: String { self == .legacy ? "legacy" : "v2" }
}
enum CodeOwnership: Equatable, Sendable { case unknown, own, other }

struct CodeEvidence: Identifiable, Equatable, Sendable {
    var id: String { source.rawValue + ":" + reportID }
    let source: CodeEvidenceSource
    let placeID: String
    let reportID: String
    let code: String
    let updatedAt: Date
    let verifiedAt: Date?
    let version: String
    let visibility: String
    let ownership: CodeOwnership
    let positiveCount: Int?
    let invalidCount: Int?
    let currentFeedback: CodeFeedback?
    let feedbackLoaded: Bool
    var verifiedVersion: String? = nil
    var isOwn: Bool { ownership == .own }
    var canGiveFeedback: Bool { visibility == "public" && ownership == .other && feedbackLoaded }
}

enum CodeEvidencePresentation {
    static func sorted(_ records: [CodeEvidence]) -> [CodeEvidence] {
        records.sorted {
            let left = verificationKey($0), right = verificationKey($1)
            if let left, let right {
                if left != right { return left > right }
            } else if left != nil || right != nil {
                return left != nil
            }
            return reportedBefore($0, $1)
        }
    }
    private static func verificationKey(_ record: CodeEvidence) -> CodeTimestampVersion? {
        guard let date = record.verifiedAt, let dateKey = CodeTimestampVersion(date: date) else { return nil }
        return record.verifiedVersion.flatMap(CodeTimestampVersion.init) ?? dateKey
    }
    private static func reportedBefore(_ left: CodeEvidence, _ right: CodeEvidence) -> Bool {
        let leftVersion = CodeTimestampVersion(left.version) ?? CodeTimestampVersion(date: left.updatedAt)
        let rightVersion = CodeTimestampVersion(right.version) ?? CodeTimestampVersion(date: right.updatedAt)
        if let leftVersion, let rightVersion {
            return leftVersion == rightVersion ? left.id > right.id : leftVersion > rightVersion
        }
        if leftVersion != nil || rightVersion != nil { return leftVersion != nil }
        return left.id > right.id
    }
    static func latestVerificationVersion(legacy: String?, feedback: String?) -> String? {
        [legacy, feedback].compactMap { $0.flatMap(CodeTimestampVersion.init) }.max()?.description
    }
    static func newestPublic(in records: [CodeEvidence]) -> CodeEvidence? {
        sorted(records.filter { $0.visibility == "public" }).first
    }
    /// History is hidden from this presentation only; no stored report is removed.
    static func visiblePublic(in records: [CodeEvidence], feedsReady: Bool = true) -> [CodeEvidence] {
        let publicRecords = sorted(records.filter { $0.visibility == "public" })
        guard let preferred = publicRecords.first, let reported = publicRecords.sorted(by: reportedBefore).first else { return [] }
        guard feedsReady, (reported.positiveCount ?? 0) >= 4 else { return publicRecords }
        return publicRecords.filter { $0.id == reported.id || $0.id == preferred.id }
    }
    static func owned(in records: [CodeEvidence]) -> [CodeEvidence] { sorted(records.filter(\.isOwn)) }
}

struct CodeTimestampVersion: Equatable, Comparable, Sendable {
    let seconds: Int64
    let nanoseconds: Int32
    var description: String { "\(seconds):\(nanoseconds)" }
    var date: Date { Date(timeIntervalSince1970: Double(seconds) + Double(nanoseconds) / 1_000_000_000) }
    init?(_ value: String) {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, let seconds = Int64(parts[0]), let nanos = Int32(parts[1]),
              seconds >= 0, (0..<1_000_000_000).contains(nanos), value == "\(seconds):\(nanos)" else { return nil }
        self.seconds = seconds; nanoseconds = nanos
    }
    init?(date: Date) {
        let value = date.timeIntervalSince1970
        guard value.isFinite, value >= 0, value < 253_402_300_799 else { return nil }
        var seconds = Int64(value.rounded(.down))
        var nanos = Int64(((value - Double(seconds)) * 1_000_000_000).rounded())
        if nanos == 1_000_000_000 { seconds += 1; nanos = 0 }
        self.seconds = seconds; nanoseconds = Int32(nanos)
    }
    static func < (left: Self, right: Self) -> Bool {
        left.seconds == right.seconds ? left.nanoseconds < right.nanoseconds : left.seconds < right.seconds
    }
}

struct CodeFeedbackCounts: Equatable, Sendable {
    let used: Int
    let invalid: Int
    init(used: Int, invalid: Int) throws {
        guard (0...1_000_000).contains(used), (0...1_000_000).contains(invalid) else { throw CodeReportError.invalidCounts }
        self.used = used; self.invalid = invalid
    }
    func applying(previous: CodeFeedback?, next: CodeFeedback) throws -> CodeFeedbackCounts {
        try CodeFeedbackCounts(used: used - (previous == .used ? 1 : 0) + (next == .used ? 1 : 0),
                               invalid: invalid - (previous == .invalid ? 1 : 0) + (next == .invalid ? 1 : 0))
    }
}

struct CodeReportFields: Equatable, Sendable {
    let code: String
    let visibility: String
    init(code: String, visibility: String) throws {
        guard code.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw CodeReportError.invalidCode }
        let trimmed = code.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, trimmed.utf8.count <= 40 else { throw CodeReportError.invalidCode }
        guard ["private", "public"].contains(visibility) else { throw CodeReportError.invalidVisibility }
        self.code = trimmed; self.visibility = visibility
    }
}

enum CodeReportError: LocalizedError {
    case invalidCode, invalidVisibility, invalidCounts
    var errorDescription: String? {
        switch self {
        case .invalidCode: "Use a code with 1–40 standard keyboard characters."
        case .invalidVisibility: "Choose Only me or Everyone for code visibility."
        case .invalidCounts: "Code feedback totals could not be read safely."
        }
    }
}
