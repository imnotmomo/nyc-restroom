import Foundation
import CoreFoundation

/// Administrator-curated public evidence. Source claims never become user votes.
struct CardResearchSource: Identifiable, Equatable {
    let id: String
    let label: String
    let title: String
    let url: String
    let kind: String
    let publishedOn: String?
    let displayedDate: String
    let observedOn: String?
    let retrievedAt: String
    let limitations: String

    var caption: String {
        if let observedOn { return "From \(label) · \(kind == "inspection" ? "Inspected" : "Observed") \(CardResearchProfile.displayDay(observedOn))" }
        if let publishedOn { return "From \(label) · Published \(CardResearchProfile.displayDay(publishedOn))" }
        return "From \(label) · Date not shown"
    }
}

struct CardResearchFact: Identifiable, Equatable {
    let id: String
    let field: String
    let label: String
    let value: String
    let scope: String
    let sourceID: String
    let section: String
    let context: String
    var displayValue: String { context.isEmpty || value.hasPrefix(context) ? value : "\(context): \(value)" }
}

struct CardResearchComment: Identifiable, Equatable {
    let id: String
    let text: String
    let sourceID: String
}

struct CardResearchSummary: Equatable {
    let value: String
    let sourceID: String
}

struct CardResearchProfile: Equatable {
    let placeID: String
    let manifestSHA256: String
    let generatedAt: String
    let sources: [CardResearchSource]
    let facts: [CardResearchFact]
    let comments: [CardResearchComment]
    let coveredCommentIDs: Set<String>

    enum DecodeError: Error { case invalidProfile }
    static let fields: Set<String> = ["restroomHours", "venueHours", "entranceLocation", "entranceStepFree", "stairFreeRoute", "elevatorToRestroom", "elevatorNote", "restroomFloor", "stairsAfterEntry", "entryRule", "purchaseRequired", "codeRequired", "passcode", "condition", "cleanliness", "soap", "toiletPaper", "changingStations", "restroomType", "genderDesignation", "restroomLocation", "buildingAccessibility", "restroomAccessibility", "closure", "staffAssistance", "inspectionDate", "inspectionRating", "identity", "venueLevel", "hours", "elevatorAccess", "passcodeRequired", "publishedStatus", "seasonality", "facilityAccessibility", "accessNotes", "sourceRating", "conditionDetail", "inspectionFixtureCount", "inspectionFeatureRating", "inspectionIssue", "elevatorOutage", "accessRestriction"]
    static let sections: Set<String> = ["hours", "amenities", "conditions", "passcodes", "entryRoute", "ratings"]
    static let kinds: Set<String> = ["official-page", "official-dataset", "review", "social-post", "social-comment", "inspection", "news", "directory", "guide"]
    static let sectionFields: [String: Set<String>] = [
        "hours": ["restroomHours", "venueHours", "hours", "seasonality"],
        "amenities": ["soap", "toiletPaper", "changingStations", "restroomType", "genderDesignation", "buildingAccessibility", "restroomAccessibility", "facilityAccessibility", "inspectionFixtureCount"],
        "conditions": ["condition", "cleanliness", "closure", "publishedStatus", "inspectionDate", "inspectionRating", "conditionDetail", "elevatorOutage", "inspectionFeatureRating", "inspectionIssue"],
        "passcodes": ["codeRequired", "passcodeRequired", "passcode"],
        "entryRoute": ["entranceLocation", "entranceStepFree", "stairFreeRoute", "elevatorToRestroom", "elevatorNote", "restroomFloor", "stairsAfterEntry", "entryRule", "purchaseRequired", "restroomLocation", "staffAssistance", "venueLevel", "accessNotes", "elevatorAccess", "accessRestriction", "identity"],
        "ratings": ["sourceRating"]
    ]

    func source(for fact: CardResearchFact) -> CardResearchSource? { sources.first { $0.id == fact.sourceID } }
    func source(id: String) -> CardResearchSource? { sources.first { $0.id == id } }
    func facts(in section: String) -> [CardResearchFact] { facts.filter { $0.section == section } }
    var codeClaims: [CardResearchFact] { facts.filter { $0.section == "passcodes" && $0.field == "passcode" } }
    var scheduleFacts: [CardResearchFact] { facts.filter { $0.section == "hours" && ["restroomHours", "venueHours", "hours"].contains($0.field) } }

    /// Summarize only explicit dated source categories; never manufacture a star score.
    func conditionSummary(visitorDay: String?) -> CardResearchSummary? {
        let rows = facts(in: "conditions")
        if let closure = rows.first(where: { $0.field == "closure" && !["no", "false", "0", "unknown", "not-reported"].contains($0.value.lowercased()) }) {
            return CardResearchSummary(value: "Closure reported: " + closure.displayValue, sourceID: closure.sourceID)
        }
        let dated = rows.filter { source(for: $0)?.observedOn != nil }
        let latest = dated.compactMap { source(for: $0)?.observedOn }.max()
        if let visitorDay, latest.map({ $0 < visitorDay }) ?? true { return nil }
        let gradeRows = rows.filter { $0.field == "inspectionRating" && source(for: $0)?.observedOn == latest }
        if let first = gradeRows.first {
            let labels = ["A": "Acceptable", "U": "Unacceptable", "N": "Not rated"]
            let values = gradeRows.map { fact in
                let value = labels[fact.value] ?? fact.value
                return fact.context.isEmpty ? value : fact.context + ": " + value
            }
            let issueCount = rows.filter { $0.field == "inspectionIssue" && $0.sourceID == first.sourceID }.count
            return CardResearchSummary(value: values.joined(separator: " · ") + (issueCount > 0 ? " · \(issueCount) issue\(issueCount == 1 ? "" : "s") reported" : ""), sourceID: first.sourceID)
        }
        if let known = rows.first(where: { ["condition", "conditionDetail"].contains($0.field) }) {
            return CardResearchSummary(value: known.displayValue, sourceID: known.sourceID)
        }
        if let status = rows.first(where: { $0.field == "publishedStatus" }) {
            return CardResearchSummary(value: "Listed " + status.value, sourceID: status.sourceID)
        }
        return nil
    }

    static func displayDay(_ day: String) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return day }
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2])) else { return day }
        let formatter = DateFormatter(); formatter.calendar = calendar; formatter.timeZone = calendar.timeZone
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    static func calendarDay(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/New_York"); formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func instantKey(_ value: String) -> String {
        let parts = value.dropLast().split(separator: ".", omittingEmptySubsequences: false)
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        return String(parts[0]) + "." + fraction.padding(toLength: 9, withPad: "0", startingAt: 0)
    }

    static func decode(id: String, data: [String: Any], now: Date = Date()) throws -> Self {
        func valid(_ value: Bool) throws { guard value else { throw DecodeError.invalidProfile } }
        func exact(_ row: [String: Any], _ keys: [String]) throws { try valid(Set(row.keys) == Set(keys)) }
        func text(_ value: Any?, max: Int, empty: Bool = false) throws -> String {
            guard let value = value as? String, value.utf16.count <= max,
                  empty || !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  value.range(of: "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F-\\x9F]|\\p{script=Han}", options: .regularExpression) == nil else { throw DecodeError.invalidProfile }
            return value
        }
        func hex(_ value: Any?, count: Int) throws -> String {
            let result = try text(value, max: count)
            try valid(result.range(of: "^[a-f0-9]{\(count)}$", options: .regularExpression) != nil); return result
        }
        func instant(_ value: Any?) throws -> String {
            let result = try text(value, max: 40)
            try valid(result.range(of: "^\\d{4}-\\d{2}-\\d{2}T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,9})?Z$", options: .regularExpression) != nil)
            let formatter = ISO8601DateFormatter(); formatter.formatOptions = result.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
            guard let date = formatter.date(from: result), date.timeIntervalSince1970.isFinite,
                  date >= Date(timeIntervalSince1970: 946_684_800), date <= now.addingTimeInterval(60) else { throw DecodeError.invalidProfile }
            let dayFormatter = DateFormatter(); dayFormatter.locale = Locale(identifier: "en_US_POSIX"); dayFormatter.timeZone = TimeZone(secondsFromGMT: 0); dayFormatter.dateFormat = "yyyy-MM-dd"
            try valid(dayFormatter.string(from: date) == String(result.prefix(10)))
            return result
        }
        func day(_ value: Any?, before: String) throws -> String? {
            if value is NSNull { return nil }
            let result = try text(value, max: 10)
            try valid(result.range(of: "^\\d{4}-\\d{2}-\\d{2}$", options: .regularExpression) != nil && result >= "2000-01-01" && result <= String(before.prefix(10)))
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "yyyy-MM-dd"; formatter.isLenient = false
            guard let date = formatter.date(from: result), formatter.string(from: date) == result else { throw DecodeError.invalidProfile }
            return result
        }
        try exact(data, ["schemaVersion", "placeID", "manifestSHA256", "generatedAt", "sources", "facts", "comments", "coveredCommentIDs"])
        guard let encoded = try? JSONSerialization.data(withJSONObject: data, options: [.withoutEscapingSlashes]), encoded.count <= 131_072 else { throw DecodeError.invalidProfile }
        guard let schema = data["schemaVersion"] as? NSNumber, CFGetTypeID(schema) != CFBooleanGetTypeID(),
              schema.intValue == 1, schema.doubleValue == 1, !["d", "f"].contains(String(cString: schema.objCType)),
              id.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$", options: .regularExpression) != nil,
              data["placeID"] as? String == id,
              let sourceRows = data["sources"] as? [[String: Any]], sourceRows.count <= 16,
              let factRows = data["facts"] as? [[String: Any]], factRows.count <= 128,
              let commentRows = data["comments"] as? [[String: Any]], commentRows.count <= 32,
              let coveredRows = data["coveredCommentIDs"] as? [String], coveredRows.count <= 32 else { throw DecodeError.invalidProfile }
        try valid(!sourceRows.isEmpty && (!factRows.isEmpty || !commentRows.isEmpty))
        let generated = try instant(data["generatedAt"])
        let sources = try sourceRows.map { row -> CardResearchSource in
            try exact(row, ["id", "label", "title", "url", "kind", "publishedOn", "displayedDate", "observedOn", "retrievedAt", "limitations"])
            let retrieved = try instant(row["retrievedAt"]), url = try text(row["url"], max: 4096), kind = try text(row["kind"], max: 30)
            try valid(safeHTTPS(url) && kinds.contains(kind) && instantKey(retrieved) <= instantKey(generated))
            try valid(!["inspection", "official-dataset"].contains(kind) || row["publishedOn"] is NSNull)
            try valid(kind != "inspection" || !(row["observedOn"] is NSNull))
            return try CardResearchSource(id: hex(row["id"], count: 20), label: text(row["label"], max: 80), title: text(row["title"], max: 300), url: url, kind: kind,
                publishedOn: day(row["publishedOn"], before: retrieved), displayedDate: text(row["displayedDate"], max: 500, empty: true),
                observedOn: day(row["observedOn"], before: retrieved), retrievedAt: retrieved, limitations: text(row["limitations"], max: 4000))
        }
        let sourceIDs = Set(sources.map(\.id)); try valid(sourceIDs.count == sources.count)
        let facts = try factRows.map { row -> CardResearchFact in
            try exact(row, ["id", "field", "label", "value", "scope", "sourceID", "section", "context"])
            let field = try text(row["field"], max: 80), scope = try text(row["scope"], max: 20), section = try text(row["section"], max: 20), source = try hex(row["sourceID"], count: 20)
            try valid(fields.contains(field) && ["restroom", "route", "building", "venue"].contains(scope) && sectionFields[section]?.contains(field) == true && sourceIDs.contains(source))
            try valid(field != "venueHours" || scope == "venue")
            try valid(field != "buildingAccessibility" || scope == "building")
            try valid(field != "sourceRating" || ["venue", "restroom"].contains(scope))
            return try CardResearchFact(id: hex(row["id"], count: 20), field: field, label: text(row["label"], max: 100), value: text(row["value"], max: 3000), scope: scope, sourceID: source, section: section, context: text(row["context"], max: 100, empty: true))
        }
        let comments = try commentRows.map { row -> CardResearchComment in
            try exact(row, ["id", "text", "sourceID"])
            let source = try hex(row["sourceID"], count: 20); try valid(sourceIDs.contains(source))
            try valid(sources.contains { $0.id == source && ["review", "social-post", "social-comment"].contains($0.kind) })
            return try CardResearchComment(id: hex(row["id"], count: 20), text: text(row["text"], max: 1500), sourceID: source)
        }
        let covered = try coveredRows.map { try hex($0, count: 20) }
        try valid(covered.allSatisfy { sourceIDs.contains($0) })
        try valid(Set(facts.map(\.id)).count == facts.count && Set(comments.map(\.id)).count == comments.count && Set(covered).count == covered.count)
        return try Self(placeID: id, manifestSHA256: hex(data["manifestSHA256"], count: 64), generatedAt: generated, sources: sources, facts: facts, comments: comments, coveredCommentIDs: Set(covered))
    }

    static func safeHTTPS(_ value: String) -> Bool {
        guard !value.contains("\\"), value.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              let url = URLComponents(string: value), url.scheme == "https", url.user == nil, url.password == nil,
              url.port == nil || url.port == 443, let rawHost = url.host else { return false }
        let host = rawHost.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard host.contains("."), host.range(of: "^[0-9.]+$", options: .regularExpression) == nil,
              !host.contains(":"), !["localhost", "local", "internal", "test", "invalid"].contains(where: { host == $0 || host.hasSuffix("." + $0) }) else { return false }
        return !(url.queryItems ?? []).contains { $0.name.range(of: "token|password|secret|authorization|api.?key|credential|session|signature|key-pair-id|policy", options: [.regularExpression, .caseInsensitive]) != nil }
    }
}
