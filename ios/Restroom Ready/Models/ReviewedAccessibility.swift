import Foundation
import CoreFoundation

/// A general reported-accessibility label, not a stair-free/elevator/stall claim.
/// The original per-source evidence stays in Sources & dates.
struct ReviewedAccessibilityEvidence: Equatable {
    struct Claim: Decodable, Equatable {
        let id: String
        let field: String
        let scope: String
        let value: String
        let sourceID: String
    }
    let claims: [Claim]

    enum Answer { case yes, no, unknown }

    var answer: Answer {
        let values = claims.map(Self.answer)
        // Partial, negative, conflicting or ambiguous evidence cannot create a
        // positive discovery match. A source's route description is not a badge.
        if values.contains(.no) { return .no }
        if values.isEmpty || values.contains(.unknown) { return .unknown }
        return .yes
    }

    private static func answer(_ claim: Claim) -> Answer {
        let value = claim.value
        if claim.field == "facilityAccessibility" {
            if value == "Fully Accessible" { return .yes }
            if ["Not Accessible", "Partially Accessible", "Limited Accessibility"].contains(value) { return .no }
            return .unknown
        }
        if ["Not accessible", "Partially accessible"].contains(value) { return .no }
        // Exact reviewed statements, deliberately not substring matching:
        // 'not wheelchair accessible' must never become a positive answer.
        let positives: Set<String> = [
            "Fully accessible", "Wheelchair accessible",
            "Wheelchair-accessible restrooms on floor 2",
            "Accessible stalls in Visitor Center and Conservatory; accessible single-user restrooms by Yellow Magnolia Café and Flatbush Avenue entrance.",
            "Accessible restrooms; single-user/all-gender options on -1, 3 and 8",
            "All public arena restrooms are accessible",
            "Lincoln Center venues have accessible entrances and restrooms.",
            "Museum supports wheelchair users and visitors avoiding stairs; staff and the interactive map identify step-free routes.",
            "Accessible restrooms are identified on the Rotunda Floor and Tower Level 7",
            "All public museum restrooms have wheelchair-accessible stalls",
            "Operator describes entrances, public spaces and common amenities as ADA-accessible",
            "Every public Top of the Rock restroom has wheelchair-accessible stalls",
            "Operator says the Museum and its programs are wheelchair accessible",
            "Operator describes all restrooms and main entrances as handicap-accessible",
            "City Point main entrances/public restrooms are designed for wheelchair and mobility-device users",
            "Oculus levels are wheelchair accessible and served by elevators; transfers may be required",
            "Operator says terminal restrooms are ADA accessible",
            "All restrooms are wheelchair accessible",
            "Accessible restrooms on every museum floor",
            "86th Floor Observation Deck restrooms are described as accessible",
            "NYC311 describes automatic public toilets as wheelchair accessible",
            "BPL describes one public restroom as wheelchair-accessible. The branch is currently closed for renovations.",
            "BPL explicitly describes an ADA restroom."
        ]
        return positives.contains(value) ? .yes : .unknown
    }
}

struct ReviewedAccessibilityIndex {
    let manifestSHA256: String
    let sourceSHA256: String
    private let entries: [String: ReviewedAccessibilityEvidence]

    func evidence(for placeID: String) -> ReviewedAccessibilityEvidence? { entries[placeID] }

    enum DecodeError: Error { case invalidIndex }

    static func load(bundle: Bundle = .main) throws -> Self {
        guard let url = bundle.url(forResource: "reviewed-accessibility", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try decode(Data(contentsOf: url))
    }

    static func decode(_ data: Data) throws -> Self {
        guard data.count <= 1_000_000,
              let raw = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(raw.keys) == ["schemaVersion", "manifestSHA256", "sourceSHA256", "entries"],
              let version = raw["schemaVersion"] as? NSNumber,
              CFGetTypeID(version) != CFBooleanGetTypeID(), !["f", "d"].contains(String(cString: version.objCType)),
              version.intValue == 1,
              let manifest = raw["manifestSHA256"] as? String,
              let source = raw["sourceSHA256"] as? String,
              [manifest, source].allSatisfy({ $0.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil }),
              let rows = raw["entries"] as? [[String: Any]], rows.count <= 1200 else { throw DecodeError.invalidIndex }
        var entries: [String: ReviewedAccessibilityEvidence] = [:]
        for row in rows {
            guard Set(row.keys) == ["placeID", "claims"], let id = row["placeID"] as? String,
                  id.range(of: "^[A-Za-z0-9][A-Za-z0-9:._~-]{0,159}$", options: .regularExpression) != nil,
                  entries[id] == nil, let claims = row["claims"] as? [[String: Any]],
                  !claims.isEmpty, claims.count <= 128 else { throw DecodeError.invalidIndex }
            var facts: [ReviewedAccessibilityEvidence.Claim] = []
            var factIDs = Set<String>()
            for claim in claims {
                guard Set(claim.keys) == ["id", "field", "scope", "value", "sourceID"],
                      let factID = claim["id"] as? String, let sourceID = claim["sourceID"] as? String,
                      [factID, sourceID].allSatisfy({ $0.range(of: "^[a-f0-9]{20}$", options: .regularExpression) != nil }),
                      factIDs.insert(factID).inserted,
                      let field = claim["field"] as? String,
                      let scope = claim["scope"] as? String,
                      ["buildingAccessibility": "building", "restroomAccessibility": "restroom", "facilityAccessibility": "restroom"][field] == scope,
                      let value = claim["value"] as? String, !value.isEmpty, value.utf16.count <= 3000,
                      value.rangeOfCharacter(from: .controlCharacters) == nil else { throw DecodeError.invalidIndex }
                facts.append(.init(id: factID, field: field, scope: scope, value: value, sourceID: sourceID))
            }
            entries[id] = .init(claims: facts)
        }
        return .init(manifestSHA256: manifest, sourceSHA256: source, entries: entries)
    }
}
