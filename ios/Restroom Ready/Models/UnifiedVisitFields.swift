import Foundation

/// Public observations and an optional comment; private codes never enter these fields.
struct UnifiedVisitFields: Equatable {
    let observedAt: Date
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

    init(observedAt: Date, entryRule: String, purchaseRequired: String, codeRequired: String,
         stairs: String, soap: String, toiletPaper: String, floor: String, condition: String,
         elevatorPresent: String = "not-reported", automaticDoorPresent: String = "not-reported",
         comment: String, anonymous: Bool, authorName: String?, now: Date = Date()) throws {
        guard observedAt.timeIntervalSince1970.isFinite, now.timeIntervalSince1970.isFinite,
              observedAt >= Date(timeIntervalSince1970: 946_684_800), observedAt <= now else {
            throw UnifiedVisitValidationError.visitTime
        }
        guard ["not-reported", "public", "customers"].contains(entryRule),
              ["not-reported", "entrance", "below", "above"].contains(floor),
              ["not-reported", "usable", "needs-attention"].contains(condition),
              [purchaseRequired, codeRequired, stairs, soap, toiletPaper, elevatorPresent, automaticDoorPresent].allSatisfy({ ["not-reported", "yes", "no"].contains($0) }) else {
            throw UnifiedVisitValidationError.answer
        }
        let body = comment.trimmingCharacters(in: .whitespacesAndNewlines)
        guard body.utf16.count <= 1_000,
              body.range(of: "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", options: .regularExpression) == nil else {
            throw UnifiedVisitValidationError.comment
        }
        let meaningful = body.range(of: "[^\\s\\p{Z}\\x{0085}]", options: .regularExpression) != nil
        guard meaningful || [entryRule, purchaseRequired, codeRequired, stairs, soap, toiletPaper, floor, condition, elevatorPresent, automaticDoorPresent].contains(where: { $0 != "not-reported" }) else {
            throw UnifiedVisitValidationError.empty
        }
        guard anonymous ? authorName == nil : Self.validAuthorName(authorName) else { throw UnifiedVisitValidationError.author }
        self.observedAt = observedAt; self.entryRule = entryRule; self.purchaseRequired = purchaseRequired
        self.codeRequired = codeRequired; self.stairs = stairs; self.soap = soap; self.toiletPaper = toiletPaper
        self.floor = floor; self.condition = condition; self.comment = body; self.anonymous = anonymous; self.authorName = authorName
        self.elevatorPresent = elevatorPresent; self.automaticDoorPresent = automaticDoorPresent
    }

    static func validAuthorName(_ value: String?) -> Bool {
        guard let value, !value.isEmpty, value.utf16.count <= 120,
              value.range(of: "[\\x00-\\x1F\\x7F]", options: .regularExpression) == nil else { return false }
        return value.range(of: "[^\\s\\p{Z}\\x{0085}]", options: .regularExpression) != nil
    }

    /// A deterministic label for a structured-only observation, not an authored comment.
    var observationSummary: String {
        let values = [("Entry", entryRule), ("Purchase required", purchaseRequired), ("Code required", codeRequired),
            ("Stairs", stairs), ("Soap", soap), ("Toilet paper", toiletPaper), ("Floor", floor),
            ("Condition", condition), ("Elevator present", elevatorPresent), ("Automatic door present", automaticDoorPresent)]
        let labels = ["yes": "Yes", "no": "No", "public": "Public", "customers": "Customers only",
            "entrance": "Entrance level", "below": "Below entrance", "above": "Above entrance",
            "usable": "Usable", "needs-attention": "Needs attention"]
        return "Visit details: " + values.compactMap { label, value in
            value == "not-reported" ? nil : "\(label): \(labels[value] ?? value)"
        }.joined(separator: " · ")
    }
}

enum UnifiedVisitValidationError: LocalizedError, Equatable {
    case visitTime, answer, comment, empty, author
    var errorDescription: String? {
        switch self {
        case .visitTime: "Choose the actual visit time. Future visits cannot be shared."
        case .answer: "Choose a listed answer, or leave unknown details as Not reported."
        case .comment: "Keep your public comment within 1,000 characters and remove unsupported control characters."
        case .empty: "Write a comment or choose at least one detail you observed."
        case .author: "Use Anonymous, or use the public display name on your signed-in account."
        }
    }
}
