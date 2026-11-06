import Foundation

/// Only the structured public observation fields may enter the on-device summary.
/// No account identity, free text, private notes, passcode values or coordinates.
struct VisitorSummaryObservation: Hashable, Sendable {
    let id: String
    let placeID: String
    let observedAt: Date
    let submittedAt: Date
    let condition: String
    let soap: String
    let toiletPaper: String
    let entryRule: String
    let purchaseRequired: String
    let codeRequired: String
    let stairs: String
    let floor: String

    fileprivate func isValid(now: Date) -> Bool {
        let answers = ["not-reported", "yes", "no"]
        return !id.isEmpty && observedAt.timeIntervalSince1970.isFinite && submittedAt.timeIntervalSince1970.isFinite
            && now.timeIntervalSince1970.isFinite && observedAt >= Date(timeIntervalSince1970: 946_684_800)
            && observedAt <= submittedAt && observedAt <= now
            && ["not-reported", "usable", "needs-attention"].contains(condition)
            && [soap, toiletPaper, purchaseRequired, codeRequired, stairs].allSatisfy(answers.contains)
            && ["not-reported", "public", "customers"].contains(entryRule)
            && ["not-reported", "entrance", "below", "above"].contains(floor)
    }
}

enum VisitorSummaryTopic: String, CaseIterable, Hashable, Sendable {
    case condition, soap, toiletPaper, entryRule, purchaseRequired, codeRequired, stairs, floor
}

/// A bounded, stable snapshot also acts as the request identity. A late response
/// cannot be displayed after a report changes, is removed or another place opens.
struct VisitorSummaryInput: Hashable, Sendable {
    let placeID: String
    let observations: [VisitorSummaryObservation]

    init(placeID: String, observations: [VisitorSummaryObservation], now: Date = Date()) {
        self.placeID = placeID
        var seen = Set<String>()
        self.observations = Array(observations
            .filter { $0.placeID == placeID && $0.isValid(now: now) }
            .sorted {
                if $0.observedAt != $1.observedAt { return $0.observedAt > $1.observedAt }
                if $0.submittedAt != $1.submittedAt { return $0.submittedAt > $1.submittedAt }
                return $0.id < $1.id
            }
            .filter { seen.insert($0.id).inserted }
            .prefix(10))
    }

    var earliestObservation: Date? { observations.map(\.observedAt).min() }
    var latestObservation: Date? { observations.map(\.observedAt).max() }
    var eligibleTopics: [VisitorSummaryTopic] { VisitorSummaryTopic.allCases.filter { sentence(for: $0) != nil } }

    /// Model output selects highlights; only these app-built, grounded sentences
    /// are displayed. Conflicting answers remain together in the chosen topic.
    func summary(selecting topics: [VisitorSummaryTopic]) -> String? {
        guard (1...2).contains(topics.count), Set(topics).count == topics.count,
              topics.allSatisfy({ eligibleTopics.contains($0) }) else { return nil }
        return topics.compactMap { sentence(for: $0) }.joined(separator: " ")
    }

    var prompt: String {
        let facts = eligibleTopics.compactMap { topic in
            sentence(for: topic).map { "\(topic.rawValue): \($0)" }
        }.joined(separator: "\n")
        // Values below contain only controlled enum-derived wording and counts.
        return """
        Choose the one or two most useful eligible topics for a short restroom visitor-report summary.
        Choose only topics listed below, with no duplicates. Prefer condition and missing supplies;
        include a reported disagreement when useful. These are past observations, not current facts.
        There are \(observations.count) dated reports in this bounded snapshot of up to 10 recent visits.
        Eligible topics and their complete reported facts:
        \(facts)
        """
    }

    func sentence(for topic: VisitorSummaryTopic) -> String? {
        switch topic {
        case .condition:
            return clauses(\.condition, values: [("usable", "described usable conditions"), ("needs-attention", "described conditions needing attention")])
        case .soap:
            return clauses(\.soap, values: [("yes", "reported soap present"), ("no", "reported soap missing")])
        case .toiletPaper:
            return clauses(\.toiletPaper, values: [("yes", "reported toilet paper present"), ("no", "reported toilet paper missing")])
        case .entryRule:
            return clauses(\.entryRule, values: [("public", "reported public entry"), ("customers", "reported customer-only entry")])
        case .purchaseRequired:
            return clauses(\.purchaseRequired, values: [("yes", "reported a purchase requirement"), ("no", "reported no purchase requirement")])
        case .codeRequired:
            return clauses(\.codeRequired, values: [("yes", "reported a code requirement"), ("no", "reported no code requirement")])
        case .stairs:
            return clauses(\.stairs, values: [("yes", "reported stairs after entry"), ("no", "reported no stairs after entry")])
        case .floor:
            return clauses(\.floor, values: [("entrance", "reported the restroom on the entrance level"), ("below", "reported the restroom below the entrance"), ("above", "reported the restroom above the entrance")])
        }
    }

    private func clauses(_ keyPath: KeyPath<VisitorSummaryObservation, String>, values: [(String, String)]) -> String? {
        let parts = values.compactMap { value, phrase -> String? in
            let count = observations.filter { $0[keyPath: keyPath] == value }.count
            return count > 0 ? "\(count) report\(count == 1 ? "" : "s") \(phrase)" : nil
        }
        return parts.isEmpty ? nil : parts.joined(separator: "; ") + "."
    }
}
