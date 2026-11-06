import Foundation

/// Public note content is independent of account identity and AI availability.
struct PublicNoteFields: Equatable {
    let observedAt: Date
    let body: String
    let condition: String
    let soap: String
    let toiletPaper: String
    let stairs: String

    init(observedAt: Date, body: String, condition: String, soap: String,
         toiletPaper: String, stairs: String, now: Date = Date()) throws {
        guard observedAt.timeIntervalSince1970.isFinite, now.timeIntervalSince1970.isFinite,
              observedAt >= Date(timeIntervalSince1970: 946_684_800), observedAt <= now else {
            throw PublicNoteValidationError.visitTime
        }
        guard ["not-reported", "usable", "needs-attention"].contains(condition),
              [soap, toiletPaper, stairs].allSatisfy({ ["not-reported", "yes", "no"].contains($0) }) else {
            throw PublicNoteValidationError.answer
        }
        let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.utf16.count <= 1_000,
              trimmed.range(of: "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", options: .regularExpression) == nil else {
            throw PublicNoteValidationError.body
        }
        guard !trimmed.isEmpty || [condition, soap, toiletPaper, stairs].contains(where: { $0 != "not-reported" }) else {
            throw PublicNoteValidationError.empty
        }
        self.observedAt = observedAt; self.body = trimmed; self.condition = condition
        self.soap = soap; self.toiletPaper = toiletPaper; self.stairs = stairs
    }

    func matches(_ other: PublicNoteFields) -> Bool {
        abs(observedAt.timeIntervalSince(other.observedAt)) < 0.001 && body == other.body
            && condition == other.condition && soap == other.soap
            && toiletPaper == other.toiletPaper && stairs == other.stairs
    }
}

enum PublicNoteValidationError: LocalizedError, Equatable {
    case visitTime, answer, body, empty
    var errorDescription: String? {
        switch self {
        case .visitTime: "Choose the actual visit time. Future visits cannot be shared."
        case .answer: "Choose one of the listed answers. Leave unknown details as Not reported."
        case .body: "Keep your public note within 1,000 characters and remove unsupported control characters."
        case .empty: "Write a note or choose at least one detail you observed."
        }
    }
}
