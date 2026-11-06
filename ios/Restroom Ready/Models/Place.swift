import Foundation
import CoreFoundation
import CoreLocation

/// Optional administrator-published facts. Existing community documents stay unchanged.
struct RestroomAccessDetails: Equatable {
    let placeID: String
    let restroomHours: String?
    let entranceLocation: String?
    let entranceStepFree: String
    let stairFreeRoute: String
    let elevatorToRestroom: String
    let elevatorNote: String?
    let restroomFloor: String?
    let stairsAfterEntry: Int?
    let sourceTitle: String
    let reportedAt: Date
    let observedOn: Date?
    let updatedAt: Date
    let limitations: String

    enum DecodeError: Error { case invalidRecord }

    /// Firestore timestamps are converted to Date by the store, never to visit dates.
    static func decode(id: String, data: [String: Any]) throws -> Self {
        let keys: Set<String> = ["schemaVersion", "placeID", "restroomHours", "entranceLocation",
            "entranceStepFree", "stairFreeRoute", "elevatorToRestroom", "elevatorNote",
            "restroomFloor", "stairsAfterEntry", "sourceTitle", "reportedAt", "observedOn", "updatedAt", "limitations"]
        func integer(_ value: Any?, range: ClosedRange<Int>) throws -> Int {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  !["f", "d"].contains(String(cString: number.objCType)),
                  number.doubleValue.isFinite, number.doubleValue.rounded() == number.doubleValue,
                  number.doubleValue >= Double(range.lowerBound), number.doubleValue <= Double(range.upperBound) else {
                throw DecodeError.invalidRecord
            }
            return number.intValue
        }
        func text(_ key: String, maximum: Int, optional: Bool = false) throws -> String? {
            if optional && data[key] is NSNull { return nil }
            guard let value = data[key] as? String, value.utf16.count <= maximum,
                  !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  value.rangeOfCharacter(from: .controlCharacters) == nil else { throw DecodeError.invalidRecord }
            return value
        }
        func answer(_ key: String) throws -> String {
            guard let value = data[key] as? String, ["yes", "no", "unknown"].contains(value) else { throw DecodeError.invalidRecord }
            return value
        }
        func date(_ key: String) throws -> Date {
            guard let value = data[key] as? Date, value.timeIntervalSince1970.isFinite else { throw DecodeError.invalidRecord }
            return value
        }
        guard Set(data.keys) == keys, id.utf16.count <= 160,
              id.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$", options: .regularExpression) != nil,
              data["placeID"] as? String == id else { throw DecodeError.invalidRecord }
        _ = try integer(data["schemaVersion"], range: 1...1)
        let reported = try date("reportedAt"), updated = try date("updatedAt")
        let observed = data["observedOn"] is NSNull ? nil : try date("observedOn")
        let entrance = try answer("entranceStepFree"), stairFree = try answer("stairFreeRoute")
        let stairs = data["stairsAfterEntry"] is NSNull ? nil : try integer(data["stairsAfterEntry"], range: 0...200)
        guard reported <= updated, observed.map({ $0 <= reported }) ?? true else { throw DecodeError.invalidRecord }
        guard !(stairFree == "yes" && (entrance == "no" || (stairs.map { $0 > 0 } ?? false))) else { throw DecodeError.invalidRecord }
        return try Self(placeID: id, restroomHours: text("restroomHours", maximum: 160, optional: true),
            entranceLocation: text("entranceLocation", maximum: 500, optional: true), entranceStepFree: entrance,
            stairFreeRoute: stairFree, elevatorToRestroom: answer("elevatorToRestroom"),
            elevatorNote: text("elevatorNote", maximum: 300, optional: true),
            restroomFloor: text("restroomFloor", maximum: 80, optional: true),
            stairsAfterEntry: stairs,
            sourceTitle: text("sourceTitle", maximum: 160)!, reportedAt: reported, observedOn: observed,
            updatedAt: updated, limitations: text("limitations", maximum: 1000)!)
    }
}

struct Place: Identifiable, Equatable {
    let id: String
    var name: String
    var latitude: Double
    var longitude: Double
    var locationType: String
    var operatorName: String? = nil
    var publishedStatus: String? = nil
    var seasonality: String? = nil
    var hours: String? = nil
    var facilityAccessibility: String? = nil
    var restroomType: String? = nil
    var changingStations: String? = nil
    var accessNotes: String? = nil
    var website: String? = nil
    var sourceRecordId: String? = nil
    var sourceUrl: String? = nil
    var address: String? = nil
    var entryRule: String? = nil
    var stepFreeAccess: String? = nil
    var passcodeRequired: String? = nil
    var communityNotes: String? = nil
    var observedOn: Date? = nil
    var submittedAt: Date? = nil
    var accessDetails: RestroomAccessDetails? = nil
    var reviewedAccessibility: ReviewedAccessibilityEvidence? = nil

    var isCommunity: Bool { id.hasPrefix("community-") }
    // Community reports own their status, including explicit unknown/negative values.
    // Original directory fields remain source facts rather than fallback certifications.
    var isReportedAccessible: Bool {
        // Conflicting explicit negative/partial evidence is never compressed
        // into a positive badge. Ambiguous evidence alone adds no new claim.
        if reviewedAccessibility?.answer == .no { return false }
        if isCommunity {
            if stepFreeAccess == "yes" { return true }
            if stepFreeAccess == "no" { return false }
            if let stepFreeAccess, stepFreeAccess != "unknown" { return false }
            // Independent reviewed evidence can fill an unknown answer, but a
            // positive city field never overrides a community report's unknown.
            return reviewedAccessibility?.answer == .yes
        }
        if facilityAccessibility == "Fully Accessible" { return true }
        if ["Not Accessible", "Partially Accessible", "Limited Accessibility"].contains(facilityAccessibility ?? "") { return false }
        return reviewedAccessibility?.answer == .yes
    }
    var accessibilityLabel: String { isReportedAccessible ? "Reported accessible" : "Not confirmed" }
    var stairFreeRouteAnswer: String { accessDetails?.stairFreeRoute ?? (isCommunity ? stepFreeAccess ?? "unknown" : "unknown") }
    var isReportedStairFree: Bool { stairFreeRouteAnswer == "yes" }
    var reportedRestroomHours: String? { accessDetails?.restroomHours ?? hours }

    func resolvedHours(researchProfile: CardResearchProfile? = nil) -> ReportedHoursPresentation? {
        func known(_ raw: String?) -> String? {
            guard let raw else { return nil }
            let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !value.isEmpty, !["unknown", "not reported", "not-reported", "hours unknown", "n/a"].contains(value.lowercased()) else { return nil }
            return raw
        }
        if let value = known(reportedRestroomHours) { return .init(raw: value, scope: .restroom, sourceFactID: nil) }
        guard let researchProfile, researchProfile.placeID == id else { return nil }
        let facts = researchProfile.scheduleFacts.filter { known($0.value) != nil }
        let selected = facts.first { $0.field == "restroomHours" && $0.scope == "restroom" }
            ?? facts.first { $0.field == "hours" && $0.scope == "restroom" }
            ?? facts.first { $0.field == "venueHours" && $0.scope == "venue" }
            ?? facts.first { $0.field == "hours" && $0.scope == "venue" }
        guard let selected else { return nil }
        return .init(raw: selected.value, scope: selected.scope == "venue" ? .venue : .restroom, sourceFactID: selected.id)
    }

    func overviewHours(accessDetailsLoading: Bool, accessDetailsFailed: Bool,
                       researchProfile: CardResearchProfile? = nil, now: Date = Date()) -> String {
        if let reported = resolvedHours(researchProfile: researchProfile) { return reported.overview(at: now) }
        if accessDetailsFailed { return "Hours unavailable" }
        if accessDetailsLoading { return "Loading hours…" }
        return "Hours unknown"
    }

    /// Group only complete, explicit weekday lists with identical schedule text.
    /// This changes presentation, never interprets times or determines current opening.
    static func compactWeeklyHours(_ raw: String) -> String? {
        let days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        let shortDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        let prefixes = days.flatMap { day in [(day, day + ": "), (day, day + "\t")] }
        let lines = raw.components(separatedBy: "\n")
        guard lines.count == 7 else { return nil }
        var schedules: [String: String] = [:]
        for line in lines {
            guard let (day, prefix) = prefixes.first(where: { line.hasPrefix($0.1) }), schedules[day] == nil else { return nil }
            let schedule = String(line.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
            guard !schedule.isEmpty, !schedule.contains("\r") else { return nil }
            schedules[day] = schedule
        }
        guard schedules.count == days.count else { return nil }
        var groups: [String] = []
        var first = 0
        while first < days.count {
            var last = first
            while last + 1 < days.count && schedules[days[last + 1]] == schedules[days[first]] { last += 1 }
            let label = first == last ? shortDays[first] : shortDays[first] + "–" + shortDays[last]
            groups.append(label + ": " + schedules[days[first]]!)
            first = last + 1
        }
        return groups.count < days.count ? groups.joined(separator: "\n") : nil
    }

    func overviewAmenities(reviewedElevatorPlaceIDs: Set<String> = [],
                           accessDetailsLoading: Bool, accessDetailsFailed: Bool) -> String {
        // An available record has already passed strict decoding. Missing supplemental
        // records must finish loading before older route/elevator fallbacks can qualify.
        let routeReady = accessDetails != nil || (!accessDetailsLoading && !accessDetailsFailed)
        var values: [String] = []
        if routeReady && hasReportedElevator(reviewedPlaceIDs: reviewedElevatorPlaceIDs) { values.append("Elevator") }
        if isReportedAccessible { values.append("Accessible") }
        if routeReady && isReportedStairFree { values.append("Stair free") }
        if !values.isEmpty { return values.joined(separator: " · ") }
        if accessDetailsFailed { return "Amenities unavailable" }
        if accessDetailsLoading { return "Loading amenities…" }
        return "No amenities reported"
    }

    /// Concise supported labels. Accessibility always comes from the same Place
    /// resolver used by discovery, never a selected-profile-only claim.
    func amenityLabels(reviewedElevatorPlaceIDs: Set<String> = [],
                      accessDetailsLoading: Bool, accessDetailsFailed: Bool,
                      researchProfile: CardResearchProfile? = nil) -> [String] {
        let routeReady = accessDetails != nil || (!accessDetailsLoading && !accessDetailsFailed)
        var values: [String] = []
        if routeReady && hasReportedElevator(reviewedPlaceIDs: reviewedElevatorPlaceIDs) { values.append("Elevator") }
        if isReportedAccessible { values.append("Accessible") }
        if routeReady && isReportedStairFree { values.append("Stair free") }
        let facts = researchProfile?.placeID == id ? researchProfile?.facts(in: "amenities") ?? [] : []
        for (field, label) in [("changingStations", "Changing stations"), ("soap", "Soap"), ("toiletPaper", "Toilet paper")] {
            if hasReportedAmenity(field, facts: facts, profile: researchProfile) { values.append(label) }
        }
        let types = facts.filter { $0.field == "restroomType" && $0.scope == "restroom" }.map(\.value)
            + (restroomType.map { [$0] } ?? [])
        for value in types {
            let labels: [String]
            switch value {
            case "Single-Stall All Gender Restroom(s)", "Single -Stall All Gender Restroom(s)", "Multi-Stall All Gender Restrooms":
                labels = ["All-gender restroom"]
            case "Both Single-Stall All Gender and Multi-Stall W/M":
                labels = ["All-gender restroom"]
            case "Automatic public toilet with running warm-water basin and mirror":
                labels = ["Automatic toilet", "Handwashing basin", "Mirror"]
            case "All-gender family restrooms on floors 1–4; companion-care room with adult changing table on floor 1":
                labels = ["Family restroom", "Adult changing table"]
            default: labels = []
            }
            for label in labels where !values.contains(label) { values.append(label) }
        }
        return values
    }

    private func hasReportedAmenity(_ field: String, facts: [CardResearchFact], profile: CardResearchProfile?) -> Bool {
        enum Answer { case yes, no, unknown }
        func answer(_ text: String, inspected: Bool) -> Answer {
            switch text.lowercased() {
            case "yes": return .yes
            case "no": return .no
            default:
                if field == "changingStations" {
                    // These exact directory/operator claims establish presence
                    // somewhere, not a changing station in every restroom.
                    let positives: Set<String> = [
                        "yes, in women's restroom only", "\"yes, in women's restroom only\"",
                        "yes, in men's restroom only", "\"yes, in men's restroom only\"",
                        "yes, in single-stall all gender restroom only", "\"yes, in single-stall all gender restroom only\"",
                        "floor 2", "changing stations on each floor, including private all-gender restrooms"
                    ]
                    if positives.contains(text.lowercased()) { return .yes }
                }
                // Counts are physical inventory observations, not truthy strings.
                // Only an inspected changing-station count can qualify: a soap
                // or paper dispenser count does not establish its supplies.
                if field == "changingStations", inspected,
                   text.range(of: "^(0|[1-9][0-9]{0,3})$", options: .regularExpression) != nil,
                   let count = Int(text) { return count > 0 ? .yes : .no }
                return .unknown
            }
        }
        func context(_ fact: CardResearchFact) -> String {
            fact.context.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                .replacingOccurrences(of: "’", with: "'")
        }
        let observations = facts.filter { $0.field == field && $0.scope == "restroom" }
        var global = observations.filter { context($0).isEmpty }.map {
            answer($0.value, inspected: profile?.source(for: $0)?.kind == "inspection")
        }
        if field == "changingStations", let changingStations {
            global.append(answer(changingStations, inspected: false))
        }
        // An unscoped negative, unknown or contradiction cannot be replaced by
        // a more convenient room count. Preserve its uncertainty in the label.
        if !global.isEmpty { return global.allSatisfy { $0 == .yes } }
        let byRoom = Dictionary(grouping: observations.filter { !context($0).isEmpty }, by: context)
        // Presence in one reported room is enough for the general amenity label;
        // zero/unknown in a different room does not say it is absent everywhere.
        // Conflicting observations for the same room cannot establish presence.
        return byRoom.values.contains { room in
            room.allSatisfy { answer($0.value, inspected: profile?.source(for: $0)?.kind == "inspection") == .yes }
        }
    }

    func hasReportedElevator(reviewedPlaceIDs: Set<String>) -> Bool {
        if let accessDetails { return accessDetails.elevatorToRestroom == "yes" }
        return reviewedPlaceIDs.contains(id)
    }
    var coordinate: CLLocationCoordinate2D { .init(latitude: latitude, longitude: longitude) }
    var subtitle: String { address ?? locationType }
    var sourceLabel: String { isCommunity ? "Community location report" : "NYC Open Data directory" }

    static func community(id: String, data: [String: Any]) -> Place? {
        guard id.range(of: "^community-[A-Za-z0-9]{20}$", options: .regularExpression) != nil,
              let name = data["name"] as? String, !name.isEmpty, name.count <= 120,
              let address = data["address"] as? String, !address.isEmpty, address.count <= 240,
              let latitude = data["latitude"] as? Double,
              let longitude = data["longitude"] as? Double,
              containsNYC(latitude: latitude, longitude: longitude),
              let type = data["locationType"] as? String,
              ["park", "library", "cafe", "restaurant", "store", "other"].contains(type),
              let entry = data["entryRule"] as? String, ["public", "customers", "unknown"].contains(entry),
              let access = data["stepFreeAccess"] as? String, ["yes", "no", "unknown"].contains(access),
              let notes = data["notes"] as? String, notes.count <= 1000,
              let submitted = data["submittedAt"] as? Date else { return nil }
        let required = data["passcodeRequired"] as? String ?? "unknown"
        guard ["yes", "no", "unknown"].contains(required) else { return nil }
        return Place(id: id, name: name, latitude: latitude, longitude: longitude,
                     locationType: type.capitalized, address: address, entryRule: entry,
                     stepFreeAccess: access, passcodeRequired: required, communityNotes: notes,
                     observedOn: data["observedOn"] as? Date, submittedAt: submitted)
    }

    static func containsNYC(latitude: Double, longitude: Double) -> Bool {
        latitude.isFinite && longitude.isFinite && (40.49...40.93).contains(latitude)
            && (-74.26 ... -73.68).contains(longitude)
    }
}

struct CitySnapshot: Decodable {
    struct Source: Decodable {
        let title: String
        let url: String
        let retrievedAt: String
        let dataUpdatedAt: String
        let limitations: [String]
    }
    private struct Record: Decodable {
        let id: String
        let name: String
        let latitude: Double
        let longitude: Double
        let locationType: String
        let `operator`: String?
        let publishedStatus: String?
        let seasonality: String?
        let hours: String?
        let facilityAccessibility: String?
        let restroomType: String?
        let changingStations: String?
        let accessNotes: String?
        let website: String?
        let sourceRecordId: String?
        let sourceUrl: String?
        let address: String?
        var place: Place {
            Place(id: id, name: name, latitude: latitude, longitude: longitude,
                  locationType: locationType, operatorName: `operator`, publishedStatus: publishedStatus,
                  seasonality: seasonality, hours: hours, facilityAccessibility: facilityAccessibility,
                  restroomType: restroomType, changingStations: changingStations, accessNotes: accessNotes,
                  website: website, sourceRecordId: sourceRecordId, sourceUrl: sourceUrl, address: address)
        }
    }
    let source: Source
    let places: [Place]
    private enum CodingKeys: String, CodingKey { case source, restrooms }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        source = try c.decode(Source.self, forKey: .source)
        let rows = try c.decode([Record].self, forKey: .restrooms)
        guard Set(rows.map(\.id)).count == rows.count,
              rows.allSatisfy({ Place.containsNYC(latitude: $0.latitude, longitude: $0.longitude) }) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        places = rows.map(\.place)
    }
    static func load(bundle: Bundle = .main) throws -> CitySnapshot {
        guard let url = bundle.url(forResource: "restrooms", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
}

enum PlaceFilter: String, CaseIterable, Identifiable {
    case `public`, noCode, clean, accessible, stairFree, elevator, saved
    static let discoveryFilters: [Self] = [.clean, .accessible, .stairFree, .public, .elevator]
    var id: String { rawValue }
    var title: String {
        switch self {
        case .public: return "Public"
        case .noCode: return "No code"
        case .clean: return "Clean"
        case .accessible: return "Accessible"
        case .stairFree: return "Stair Free"
        case .elevator: return "Elevator access"
        case .saved: return "Saved"
        }
    }
    var explanation: String {
        switch self {
        case .public: return "NYC directory listings and reported public entry. Fees, restrictions and current availability can vary."
        case .noCode: return "An original visitor submission explicitly reported no code. Missing codes and unknown requirements are excluded."
        case .clean: return "A public cleanliness average of at least 4 out of 5. Ratings do not confirm current conditions."
        case .accessible: return "Places reported accessible. Check source dates and route details; stall features and current availability are not confirmed."
        case .stairFree: return "An explicit report describes a stair-free route to the restroom. Check entrance details and source dates."
        case .elevator: return "A source reports an elevator to the restroom level. Check route details and dates; operation and current entry are not confirmed."
        case .saved: return "Places saved to your signed-in account."
        }
    }
    func matches(_ place: Place, average: Double?, savedIDs: Set<String>, elevatorPlaceIDs: Set<String> = []) -> Bool {
        switch self {
        case .public: return (!place.isCommunity && place.sourceRecordId != nil) || place.entryRule == "public"
        case .noCode: return place.isCommunity && place.passcodeRequired == "no"
        case .clean: return average.map { $0.isFinite && $0 >= 4 && $0 <= 5 } ?? false
        case .accessible: return place.isReportedAccessible
        case .stairFree: return place.isReportedStairFree
        case .elevator: return place.hasReportedElevator(reviewedPlaceIDs: elevatorPlaceIDs)
        case .saved: return savedIDs.contains(place.id)
        }
    }

    static func matchesAll(_ selected: Set<Self>, _ place: Place, average: Double?, savedIDs: Set<String>, elevatorPlaceIDs: Set<String> = []) -> Bool {
        selected.allSatisfy { $0.matches(place, average: average, savedIDs: savedIDs, elevatorPlaceIDs: elevatorPlaceIDs) }
    }
}

struct ResearchRegistry: Decodable {
    struct Source: Decodable, Identifiable {
        let id: String
        let title: String
        let url: String
        let publishedOn: String
        let dateKind: String
        let limitations: String
    }
    struct Fact: Decodable, Hashable { let field: String; let value: String }
    struct Report: Decodable, Identifiable {
        let id: String
        let placeID: String
        let sourceID: String
        let venueLabel: String
        let reportedOn: String?
        let facts: [Fact]
        let limitations: String
    }
    let cutoff: String
    let sources: [Source]
    let reports: [Report]
    static func load(bundle: Bundle = .main) throws -> Self {
        guard let url = bundle.url(forResource: "source-reports", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
    }
    func reports(for id: String) -> [Report] { reports.filter { $0.placeID == id } }
    func source(for report: Report) -> Source? { sources.first { $0.id == report.sourceID } }

    /// Reviewed restroom-level evidence only. A lobby elevator or an accessibility
    /// label does not establish an elevator route to the restroom.
    var reportedElevatorPlaceIDs: Set<String> {
        Set(reports.compactMap { report in
            guard report.id == "7e357bd832b142605e31",
                  report.placeID == "community-30c01c58b8ff4dd8e3c4",
                  report.sourceID == "G26-002",
                  source(for: report)?.url == "https://www.beyond-borders.org/best-public-bathrooms-in-nyc/",
                  report.facts.contains(Fact(field: "elevatorAccess", value: "Explicitly directs elevator down to restroom level.")) else { return nil }
            return report.placeID
        })
    }
}

/// Empty discovery results are conclusive only after the feeds used by the
/// current criteria have finished successfully. Unrelated account or rating
/// feeds must not prevent ordinary anonymous browsing.
enum DiscoveryResultsReadiness: Equatable {
    case loading, unavailable, ready

    static func evaluate(filters: Set<PlaceFilter>, publicLoading: Bool, publicFailed: Bool,
                         ratingsLoading: Bool, ratingsFailed: Bool, signedIn: Bool,
                         privateLoading: Bool, privateFailed: Bool,
                         accessDetailsLoading: Bool = false, accessDetailsFailed: Bool = false) -> Self {
        let needsRatings = filters.contains(.clean)
        let needsPrivate = filters.contains(.saved)
        let needsAccessDetails = filters.contains(.stairFree) || filters.contains(.elevator)
        if publicFailed || (needsRatings && ratingsFailed)
            || (needsAccessDetails && accessDetailsFailed)
            || (needsPrivate && (!signedIn || privateFailed)) {
            return .unavailable
        }
        if publicLoading || (needsRatings && ratingsLoading) || (needsPrivate && privateLoading)
            || (needsAccessDetails && accessDetailsLoading) {
            return .loading
        }
        return .ready
    }
}
