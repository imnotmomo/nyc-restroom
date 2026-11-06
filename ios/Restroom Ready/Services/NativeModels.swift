import Foundation
import CoreFoundation
@preconcurrency import FirebaseFirestore

enum NativeIDs {
    static func make() -> String {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")
        return String((0..<20).map { _ in alphabet.randomElement()! })
    }
}

struct RatingSummary: Identifiable {
    var id: String { placeID }
    let placeID: String
    let ratingCount: Int
    let ratingSum: Double
    let updatedAt: Date
    var average: Double { ratingCount > 0 ? ratingSum / Double(ratingCount) : 0 }
}

struct NoteDraft {
    var id = NativeIDs.make()
    var observedAt = Date()
    var condition = "not-reported"
    var soap = "not-reported"
    var toiletPaper = "not-reported"
    var stairs = "not-reported"
    var entryNote = ""
}

struct PrivateNote: Identifiable {
    let id: String
    let placeID: String
    let observedAt: Date
    let submittedAt: Date?
    let condition: String
    let soap: String
    let toiletPaper: String
    let stairs: String
    let entryNote: String
}

struct PublicNoteDraft {
    var id = NativeIDs.make()
    var observedAt = Date()
    var condition = "not-reported"
    var soap = "not-reported"
    var toiletPaper = "not-reported"
    var stairs = "not-reported"
    var body = ""

    func fields(now: Date = Date()) throws -> PublicNoteFields {
        try PublicTextSafety.validateForPublication(body)
        return try PublicNoteFields(observedAt: observedAt, body: body, condition: condition,
            soap: soap, toiletPaper: toiletPaper, stairs: stairs, now: now)
    }
}

struct PublicNote: Identifiable {
    let id: String
    let placeID: String
    let observedAt: Date
    let observationTimestamp: Timestamp
    let submittedAt: Date
    let submissionTimestamp: Timestamp
    let body: String
    let condition: String
    let soap: String
    let toiletPaper: String
    let stairs: String

    var fields: PublicNoteFields? {
        try? PublicNoteFields(observedAt: observedAt, body: body, condition: condition,
            soap: soap, toiletPaper: toiletPaper, stairs: stairs, now: submittedAt)
    }
}

struct CodeDraft {
    var code = ""
    var visibility = "private"
    var expected: OwnPasscode? = nil
}

struct CodeReportDraft {
    var id = NativeIDs.make()
    var code = ""
    var visibility = "private"
}

struct OwnCodeReport: Identifiable {
    let id: String
    var reportID: String { id }
    let placeID: String
    let code: String
    let visibility: String
    let createdAt: Date
    let codeUpdatedAt: Date
    let lastVerifiedAt: Date?
    let creationTimestamp: Timestamp
    let versionTimestamp: Timestamp
    var codeVersion: String { "\(versionTimestamp.seconds):\(versionTimestamp.nanoseconds)" }
}

struct PublicCodeReport: Identifiable {
    let id: String
    let placeID: String
    let code: String
    let codeUpdatedAt: Date
    let versionTimestamp: Timestamp
    var codeVersion: String { "\(versionTimestamp.seconds):\(versionTimestamp.nanoseconds)" }
}

struct CodeFeedbackSummary {
    let versionTimestamp: Timestamp
    let usedCount: Int
    let invalidCount: Int
    let lastUsedAt: Date?
    let lastUsedTimestamp: Timestamp?
    let updatedAt: Date
}

struct CodeFeedbackVote {
    let versionTimestamp: Timestamp
    let vote: CodeFeedback
    let updatedAt: Date
}

struct OwnPasscode: Identifiable {
    var id: String { reportID }
    let placeID: String
    let reportID: String
    let code: String
    let visibility: String
    let createdAt: Date
    let codeUpdatedAt: Date
    let lastVerifiedAt: Date?
    /// Retain exact nanoseconds; Date must never be used as a concurrency token.
    let versionTimestamp: Timestamp
    var codeVersion: String { "\(versionTimestamp.seconds):\(versionTimestamp.nanoseconds)" }
}

struct PasscodeReport: Identifiable {
    var id: String { reportID }
    let placeID: String
    let reportID: String
    let code: String
    let codeUpdatedAt: Date
    let lastVerifiedAt: Date?
    let versionTimestamp: Timestamp
    var verificationTimestamp: Timestamp? = nil
    var codeVersion: String { "\(versionTimestamp.seconds):\(versionTimestamp.nanoseconds)" }
}

struct NewPlaceDraft {
    var id = "community-" + NativeIDs.make()
    var name = ""
    var address = ""
    var latitude: Double? = nil
    var longitude: Double? = nil
    var locationType = "other"
    var entryRule = "unknown"
    var stepFreeAccess = "unknown"
    var passcodeRequired = "unknown"
    var notes = ""
    var observedOn: Date? = nil
    var code: CodeDraft? = nil
}

/// Owner-only request history. Raw code drafts and their commitments never
/// become observable list state, public projections or telemetry.
struct OwnRestroomRequest: Identifiable {
    let id: String
    let name: String
    let address: String
    let submittedAt: Date
    let state: RestroomSubmissionState
}

struct VisitDraft {
    var id = NativeIDs.make()
    var observedAt = Date()
    var entryRule = "not-reported"
    var purchaseRequired = "not-reported"
    var codeRequired = "not-reported"
    var stairs = "not-reported"
    var soap = "not-reported"
    var toiletPaper = "not-reported"
    var floor = "not-reported"
    var condition = "not-reported"
    var elevatorPresent = "not-reported"
    var automaticDoorPresent = "not-reported"
    var comment = ""
    var anonymous = true
    var authorName: String? = nil
    var optionalCode: CodeReportDraft? = nil
}

enum VisitReportSource: String { case legacy, unified }

struct VisitReport: Identifiable {
    let reportID: String
    var id: String { source == .legacy ? reportID : "unified:" + reportID }
    var ownershipID: String { id }
    let source: VisitReportSource
    let placeID: String
    let observedAt: Date
    let submittedAt: Date
    let submissionTimestamp: Timestamp
    let observationTimestamp: Timestamp?
    let entryRule: String
    let purchaseRequired: String
    let codeRequired: String
    let stairs: String
    let soap: String
    let toiletPaper: String
    let floor: String
    let condition: String
    let elevatorPresent: String
    let automaticDoorPresent: String
    let comment: String
    let anonymous: Bool
    let authorName: String?

    init(id: String, placeID: String, observedAt: Date, submittedAt: Date, submissionTimestamp: Timestamp,
         entryRule: String, purchaseRequired: String, codeRequired: String, stairs: String, soap: String,
         toiletPaper: String, floor: String, condition: String, source: VisitReportSource = .legacy,
         comment: String = "", anonymous: Bool = true, authorName: String? = nil, observationTimestamp: Timestamp? = nil,
         elevatorPresent: String = "not-reported", automaticDoorPresent: String = "not-reported") {
        self.reportID = id; self.source = source; self.placeID = placeID; self.observedAt = observedAt
        self.submittedAt = submittedAt; self.submissionTimestamp = submissionTimestamp; self.observationTimestamp = observationTimestamp
        self.entryRule = entryRule; self.purchaseRequired = purchaseRequired; self.codeRequired = codeRequired
        self.stairs = stairs; self.soap = soap; self.toiletPaper = toiletPaper; self.floor = floor; self.condition = condition
        self.comment = comment; self.anonymous = anonymous; self.authorName = authorName
        self.elevatorPresent = elevatorPresent; self.automaticDoorPresent = automaticDoorPresent
    }
}

enum OwnPublicContributionSource: String { case note, unified }

/// Account-only lookup results. Ownership comes from private paired receipts,
/// never a public UID or an inferred author display name.
struct OwnPublicContribution: Identifiable {
    let id: String
    let placeID: String
    let placeName: String
    let observedAt: Date
    let submittedAt: Date
    let body: String
    let source: OwnPublicContributionSource
    let publicNote: PublicNote?
    let visitReport: VisitReport?
}

struct SourceComment: Identifiable {
    let id: String
    let placeID: String
    let sourceID: String
    let sourceKind: String
    let text: String
    let displayName: String
    let publishedOn: String?
    let displayedDate: String
    let dateStatus: String
    let sourceURL: URL?
    let sourceTitle: String
    let capturedAt: Date
    let limitations: String
    let submittedAt: Date
}

struct NativeDataError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum NativeSchema {
    static let firstDate = Date(timeIntervalSince1970: 946_684_800)
    static let answer = ["not-reported", "yes", "no"]
    static let condition = ["not-reported", "usable", "needs-attention"]
    static func id(_ value: String) -> Bool { value.range(of: "^[A-Za-z0-9]{20}$", options: .regularExpression) != nil }
    static func place(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,127}$", options: .regularExpression) != nil
            && (!value.hasPrefix("community-") || value.range(of: "^community-[A-Za-z0-9]{20}$", options: .regularExpression) != nil)
    }
    static func exact(_ data: [String: Any], _ keys: [String]) throws {
        guard Set(data.keys) == Set(keys) else { throw NativeDataError("A stored record has an invalid format and is hidden.") }
    }
    static func text(_ value: Any?, max: Int, required: Bool = true) throws -> String {
        guard let value = value as? String, value.utf16.count <= max,
              (!required || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty),
              value.range(of: "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", options: .regularExpression) == nil else {
            throw NativeDataError("Check the text and length before saving.")
        }
        return value
    }
    static func timestamp(_ value: Any?) throws -> Timestamp {
        guard let value = value as? Timestamp, value.dateValue() >= firstDate else {
            throw NativeDataError("A stored date could not be read safely.")
        }
        return value
    }
    static func null(_ value: Any?) -> Bool { value is NSNull }
    static func optionalTimestamp(_ value: Any?, after: Timestamp) throws -> Date? {
        if null(value) { return nil }
        let time = try timestamp(value)
        guard time.compare(after) != .orderedAscending else { throw NativeDataError("A code check predates this version and is hidden.") }
        return time.dateValue()
    }
    static func number(_ value: Any?) throws -> Double {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.isFinite else {
            throw NativeDataError("A stored number has an invalid format.")
        }
        return number.doubleValue
    }
    static func stars(_ value: Double) -> Bool { CleanlinessRating.firestoreNumber(for: value) != nil }
    static func summary(_ id: String, _ data: [String: Any]) throws -> RatingSummary {
        try exact(data, ["ratingCount", "ratingSum", "updatedAt"])
        let count = try number(data["ratingCount"]), sum = try number(data["ratingSum"])
        guard count.rounded() == count, count >= 0, count <= 1_000_000, sum * 2 == (sum * 2).rounded(), sum >= count, sum <= count * 5 else {
            throw NativeDataError("Public rating totals could not be read safely.")
        }
        return RatingSummary(placeID: id, ratingCount: Int(count), ratingSum: sum, updatedAt: try timestamp(data["updatedAt"]).dateValue())
    }
    static func code(_ value: String) throws -> String {
        let result = value.trimmingCharacters(in: .whitespaces)
        guard !result.isEmpty, result.utf8.count <= 40, result.unicodeScalars.allSatisfy({ $0.value >= 32 && $0.value <= 126 }) else {
            throw NativeDataError("Use a code with 1–40 standard keyboard characters.")
        }
        return result
    }
    static func ownCode(_ place: String, _ data: [String: Any]) throws -> OwnPasscode {
        try exact(data, ["placeID", "reportID", "code", "visibility", "createdAt", "codeUpdatedAt", "lastVerifiedAt"])
        guard data["placeID"] as? String == place, let id = data["reportID"] as? String, self.id(id),
              let raw = data["code"] as? String, try code(raw) == raw,
              let visibility = data["visibility"] as? String, ["private", "public"].contains(visibility) else {
            throw NativeDataError("Your saved code could not be read safely.")
        }
        let created = try timestamp(data["createdAt"]), updated = try timestamp(data["codeUpdatedAt"])
        guard updated.compare(created) != .orderedAscending else { throw NativeDataError("Your code dates could not be read safely.") }
        return OwnPasscode(placeID: place, reportID: id, code: raw, visibility: visibility, createdAt: created.dateValue(), codeUpdatedAt: updated.dateValue(), lastVerifiedAt: try optionalTimestamp(data["lastVerifiedAt"], after: updated), versionTimestamp: updated)
    }
    static func publicCode(_ place: String, _ id: String, _ data: [String: Any]) throws -> PasscodeReport {
        try exact(data, ["placeID", "code", "codeUpdatedAt", "lastVerifiedAt"])
        guard self.id(id), data["placeID"] as? String == place, let raw = data["code"] as? String, try code(raw) == raw else {
            throw NativeDataError("A public code report has invalid details.")
        }
        let updated = try timestamp(data["codeUpdatedAt"])
        return PasscodeReport(placeID: place, reportID: id, code: raw, codeUpdatedAt: updated.dateValue(), lastVerifiedAt: try optionalTimestamp(data["lastVerifiedAt"], after: updated), versionTimestamp: updated,
            verificationTimestamp: data["lastVerifiedAt"] as? Timestamp)
    }
    static func currentCodeTime(_ value: Any?) throws -> Timestamp {
        let time = try timestamp(value)
        guard time.dateValue().timeIntervalSince1970.isFinite, time.dateValue() <= Date() else {
            throw NativeDataError("A code date could not be read safely.")
        }
        return time
    }
    static func ownCodeReport(_ place: String, _ id: String, _ data: [String: Any]) throws -> OwnCodeReport {
        try exact(data, ["placeID", "code", "visibility", "createdAt", "codeUpdatedAt", "lastVerifiedAt"])
        guard self.id(id), self.place(place), data["placeID"] as? String == place,
              let raw = data["code"] as? String, let visibility = data["visibility"] as? String,
              try CodeReportFields(code: raw, visibility: visibility).code == raw else {
            throw NativeDataError("Your code report has invalid details.")
        }
        let created = try currentCodeTime(data["createdAt"]), updated = try currentCodeTime(data["codeUpdatedAt"])
        guard created.isEqual(updated) else { throw NativeDataError("This code report's immutable date has changed.") }
        let verified = try optionalTimestamp(data["lastVerifiedAt"], after: updated)
        guard verified == nil || verified! <= Date() else { throw NativeDataError("A code check date is invalid.") }
        return OwnCodeReport(id: id, placeID: place, code: raw, visibility: visibility, createdAt: created.dateValue(),
            codeUpdatedAt: updated.dateValue(), lastVerifiedAt: verified, creationTimestamp: created, versionTimestamp: updated)
    }
    static func publicCodeReport(_ place: String, _ id: String, _ data: [String: Any]) throws -> PublicCodeReport {
        try exact(data, ["placeID", "code", "codeUpdatedAt"])
        guard self.id(id), self.place(place), data["placeID"] as? String == place,
              let raw = data["code"] as? String, try CodeReportFields(code: raw, visibility: "public").code == raw else {
            throw NativeDataError("A public code report has invalid details.")
        }
        let updated = try currentCodeTime(data["codeUpdatedAt"])
        return PublicCodeReport(id: id, placeID: place, code: raw, codeUpdatedAt: updated.dateValue(), versionTimestamp: updated)
    }
    static func codeFeedbackSummary(_ place: String, _ source: CodeEvidenceSource, _ id: String, _ data: [String: Any]) throws -> CodeFeedbackSummary {
        try exact(data, ["placeID", "kind", "reportID", "codeUpdatedAt", "usedCount", "invalidCount", "lastUsedAt", "updatedAt"])
        guard data["placeID"] as? String == place, data["kind"] as? String == source.wireKind,
              data["reportID"] as? String == id else { throw NativeDataError("Code feedback belongs to a different report.") }
        func count(_ field: String) throws -> Int {
            guard let raw = data[field] as? NSNumber, CFGetTypeID(raw) != CFBooleanGetTypeID(),
                  !["f", "d"].contains(String(cString: raw.objCType)), (0...1_000_000).contains(raw.int64Value) else {
                throw NativeDataError("Code feedback totals have invalid details.")
            }
            return raw.intValue
        }
        let version = try currentCodeTime(data["codeUpdatedAt"]), updated = try currentCodeTime(data["updatedAt"])
        let used = try count("usedCount"), invalid = try count("invalidCount")
        let last = try optionalTimestamp(data["lastUsedAt"], after: version)
        // Deleting the latest voter can erase its personal check time while
        // retaining other visitors' counts; that leaves a valid unknown date.
        guard updated.compare(version) != .orderedAscending, last == nil || last! <= updated.dateValue() else {
            throw NativeDataError("Code feedback dates have invalid details.")
        }
        return CodeFeedbackSummary(versionTimestamp: version, usedCount: used, invalidCount: invalid, lastUsedAt: last,
            lastUsedTimestamp: data["lastUsedAt"] as? Timestamp, updatedAt: updated.dateValue())
    }
    static func codeFeedbackVote(_ place: String, _ source: CodeEvidenceSource, _ id: String, _ data: [String: Any]) throws -> CodeFeedbackVote {
        try exact(data, ["placeID", "kind", "reportID", "codeUpdatedAt", "vote", "updatedAt"])
        guard data["placeID"] as? String == place, data["kind"] as? String == source.wireKind,
              data["reportID"] as? String == id, let raw = data["vote"] as? String, let vote = CodeFeedback(rawValue: raw) else {
            throw NativeDataError("Your code feedback has invalid details.")
        }
        let version = try currentCodeTime(data["codeUpdatedAt"]), updated = try currentCodeTime(data["updatedAt"])
        guard updated.compare(version) != .orderedAscending else { throw NativeDataError("Your code feedback date is invalid.") }
        return CodeFeedbackVote(versionTimestamp: version, vote: vote, updatedAt: updated.dateValue())
    }
    static func sameRevision(_ left: OwnPasscode?, _ right: OwnPasscode?) -> Bool {
        guard let left, let right else { return left == nil && right == nil }
        return left.placeID == right.placeID && left.reportID == right.reportID && left.visibility == right.visibility && left.codeVersion == right.codeVersion
    }
    static func note(_ id: String, _ data: [String: Any]) throws -> PrivateNote {
        try exact(data, ["placeID", "observedAt", "submittedAt", "condition", "soap", "toiletPaper", "stairs", "entryNote"])
        guard self.id(id), let place = data["placeID"] as? String, self.place(place),
              let condition = data["condition"] as? String, self.condition.contains(condition),
              let soap = data["soap"] as? String, answer.contains(soap), let paper = data["toiletPaper"] as? String, answer.contains(paper),
              let stairs = data["stairs"] as? String, answer.contains(stairs) else { throw NativeDataError("A private note has invalid details.") }
        return PrivateNote(id: id, placeID: place, observedAt: try timestamp(data["observedAt"]).dateValue(), submittedAt: null(data["submittedAt"]) ? nil : try timestamp(data["submittedAt"]).dateValue(), condition: condition, soap: soap, toiletPaper: paper, stairs: stairs, entryNote: try text(data["entryNote"], max: 1000, required: false))
    }
    static func publicNote(_ id: String, _ place: String, _ data: [String: Any]) throws -> PublicNote {
        try exact(data, ["schemaVersion", "placeID", "observedAt", "submittedAt", "body", "condition", "soap", "toiletPaper", "stairs"])
        guard self.id(id), self.place(place), data["placeID"] as? String == place,
              let version = data["schemaVersion"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
              !["f", "d"].contains(String(cString: version.objCType)), version.int64Value == 1,
              let body = data["body"] as? String, let condition = data["condition"] as? String,
              let soap = data["soap"] as? String, let paper = data["toiletPaper"] as? String,
              let stairs = data["stairs"] as? String else { throw NativeDataError("A public note has invalid details.") }
        let observed = try timestamp(data["observedAt"]), submitted = try timestamp(data["submittedAt"])
        guard submitted.dateValue().timeIntervalSince1970.isFinite, submitted.dateValue() <= Date() else {
            throw NativeDataError("A public note has an invalid submission time.")
        }
        let fields = try PublicNoteFields(observedAt: observed.dateValue(), body: body, condition: condition,
            soap: soap, toiletPaper: paper, stairs: stairs, now: submitted.dateValue())
        guard fields.body == body else { throw NativeDataError("A public note has invalid text formatting.") }
        return PublicNote(id: id, placeID: place, observedAt: fields.observedAt, observationTimestamp: observed, submittedAt: submitted.dateValue(),
            submissionTimestamp: submitted, body: fields.body, condition: fields.condition,
            soap: fields.soap, toiletPaper: fields.toiletPaper, stairs: fields.stairs)
    }
    static func unifiedVisitFields(_ draft: VisitDraft, now: Date = Date()) throws -> UnifiedVisitFields {
        guard id(draft.id) else { throw NativeDataError("Choose a valid visit report.") }
        try PublicTextSafety.validateForPublication(draft.comment)
        if !draft.anonymous, let name = draft.authorName { try PublicTextSafety.validateForPublication(name) }
        return try UnifiedVisitFields(observedAt: draft.observedAt, entryRule: draft.entryRule,
            purchaseRequired: draft.purchaseRequired, codeRequired: draft.codeRequired, stairs: draft.stairs,
            soap: draft.soap, toiletPaper: draft.toiletPaper, floor: draft.floor, condition: draft.condition,
            elevatorPresent: draft.elevatorPresent, automaticDoorPresent: draft.automaticDoorPresent,
            comment: draft.comment, anonymous: draft.anonymous, authorName: draft.authorName, now: now)
    }
    static func unifiedVisit(_ id: String, _ place: String, _ data: [String: Any]) throws -> VisitReport {
        let optionalKeys = ["elevatorPresent", "automaticDoorPresent"].filter { data.keys.contains($0) }
        try exact(data, ["schemaVersion", "placeID", "observedAt", "submittedAt", "entryRule", "purchaseRequired",
            "codeRequired", "stairs", "soap", "toiletPaper", "floor", "condition", "comment", "anonymous", "authorName"] + optionalKeys)
        func optionalAnswer(_ key: String) throws -> String {
            guard data.keys.contains(key) else { return "not-reported" }
            guard let value = data[key] as? String, ["not-reported", "yes", "no"].contains(value) else {
                throw NativeDataError("A visit report has invalid amenity observations.")
            }
            return value
        }
        let elevator = try optionalAnswer("elevatorPresent"), automaticDoor = try optionalAnswer("automaticDoorPresent")
        guard self.id(id), self.place(place), data["placeID"] as? String == place,
              let version = data["schemaVersion"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
              !["f", "d"].contains(String(cString: version.objCType)), version.int64Value == 1,
              let flag = data["anonymous"] as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID(),
              let comment = data["comment"] as? String, let entry = data["entryRule"] as? String,
              let purchase = data["purchaseRequired"] as? String, let code = data["codeRequired"] as? String,
              let stairs = data["stairs"] as? String, let soap = data["soap"] as? String,
              let paper = data["toiletPaper"] as? String, let floor = data["floor"] as? String,
              let condition = data["condition"] as? String else { throw NativeDataError("A visit report has invalid details.") }
        let observed = try timestamp(data["observedAt"]), submitted = try timestamp(data["submittedAt"])
        guard submitted.dateValue() <= Date() else { throw NativeDataError("A visit report has a future submission time.") }
        let author: String?
        if null(data["authorName"]) { author = nil }
        else { guard let name = data["authorName"] as? String else { throw NativeDataError("A visit report has an invalid public author.") }; author = name }
        let fields = try UnifiedVisitFields(observedAt: observed.dateValue(), entryRule: entry, purchaseRequired: purchase,
            codeRequired: code, stairs: stairs, soap: soap, toiletPaper: paper, floor: floor, condition: condition,
            elevatorPresent: elevator, automaticDoorPresent: automaticDoor,
            comment: comment, anonymous: flag.boolValue, authorName: author, now: submitted.dateValue())
        guard fields.comment == comment else { throw NativeDataError("A visit report has invalid comment formatting.") }
        return VisitReport(id: id, placeID: place, observedAt: observed.dateValue(), submittedAt: submitted.dateValue(),
            submissionTimestamp: submitted, entryRule: entry, purchaseRequired: purchase, codeRequired: code,
            stairs: stairs, soap: soap, toiletPaper: paper, floor: floor, condition: condition, source: .unified,
            comment: fields.comment, anonymous: fields.anonymous, authorName: fields.authorName, observationTimestamp: observed,
            elevatorPresent: fields.elevatorPresent, automaticDoorPresent: fields.automaticDoorPresent)
    }
    static func visitFields(_ draft: VisitDraft, now: Date = Date()) throws -> [String: Any] {
        guard id(draft.id), draft.observedAt >= firstDate, draft.observedAt <= now,
              ["not-reported", "public", "customers"].contains(draft.entryRule), ["not-reported", "entrance", "below", "above"].contains(draft.floor), condition.contains(draft.condition),
              [draft.purchaseRequired, draft.codeRequired, draft.stairs, draft.soap, draft.toiletPaper].allSatisfy({ answer.contains($0) }),
              [draft.entryRule, draft.floor, draft.condition, draft.purchaseRequired, draft.codeRequired, draft.stairs, draft.soap, draft.toiletPaper].contains(where: { $0 != "not-reported" }) else {
            throw NativeDataError("Choose the actual visit time and at least one detail you observed. Future visits cannot be shared.")
        }
        return ["observedAt": Timestamp(date: draft.observedAt), "entryRule": draft.entryRule, "purchaseRequired": draft.purchaseRequired, "codeRequired": draft.codeRequired,
                "stairs": draft.stairs, "soap": draft.soap, "toiletPaper": draft.toiletPaper, "floor": draft.floor, "condition": draft.condition]
    }
    static func visit(_ id: String, _ place: String, _ data: [String: Any]) throws -> VisitReport {
        try exact(data, ["placeID", "observedAt", "submittedAt", "entryRule", "purchaseRequired", "codeRequired", "stairs", "soap", "toiletPaper", "floor", "condition"])
        guard data["placeID"] as? String == place else { throw NativeDataError("A visit report belongs to another place.") }
        let observed = try timestamp(data["observedAt"]).dateValue(), submitted = try timestamp(data["submittedAt"]).dateValue()
        var draft = VisitDraft(); draft.id = id; draft.observedAt = observed
        guard let entry = data["entryRule"] as? String, let purchase = data["purchaseRequired"] as? String,
              let code = data["codeRequired"] as? String, let stairs = data["stairs"] as? String,
              let soap = data["soap"] as? String, let paper = data["toiletPaper"] as? String,
              let floor = data["floor"] as? String, let condition = data["condition"] as? String else { throw NativeDataError("A visit report has invalid details.") }
        draft.entryRule = entry; draft.purchaseRequired = purchase; draft.codeRequired = code; draft.stairs = stairs; draft.soap = soap; draft.toiletPaper = paper; draft.floor = floor; draft.condition = condition
        _ = try visitFields(draft, now: submitted)
        return VisitReport(id: id, placeID: place, observedAt: observed, submittedAt: submitted, submissionTimestamp: try timestamp(data["submittedAt"]), entryRule: entry, purchaseRequired: purchase, codeRequired: code, stairs: stairs, soap: soap, toiletPaper: paper, floor: floor, condition: condition)
    }
}
