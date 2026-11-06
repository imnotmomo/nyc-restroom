import Foundation
import CryptoKit
import XCTest
@testable import RestroomDirectory

final class ReviewedAccessibilityTests: XCTestCase {
    private let morgan = "community-82d3c2a31534b1f5fcfd"
    private var repo: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    }
    private func indexData() throws -> Data {
        try Data(contentsOf: repo.appendingPathComponent("ios/Restroom Ready/Resources/reviewed-accessibility.json"))
    }
    private func evidence(_ values: [(String, String)]) -> ReviewedAccessibilityEvidence {
        .init(claims: values.enumerated().map { offset, value in
            .init(id: String(format: "%020x", offset), field: value.0,
                  scope: value.0 == "buildingAccessibility" ? "building" : "restroom", value: value.1,
                  sourceID: String(repeating: "a", count: 20))
        })
    }
    private func community() -> Place {
        Place(id: morgan, name: "Morgan Library & Museum", latitude: 40.749, longitude: -73.982,
              locationType: "Other", stepFreeAccess: "unknown")
    }

    func testMorganMatchesAccessibleBeforeAnyCardProfileLoadsWithoutInventingRouteFacts() throws {
        let index = try ReviewedAccessibilityIndex.decode(indexData())
        var place = community()
        XCTAssertFalse(place.isReportedAccessible)
        place.reviewedAccessibility = try XCTUnwrap(index.evidence(for: morgan))
        XCTAssertEqual(place.reviewedAccessibility?.answer, .yes)
        XCTAssertEqual(place.stepFreeAccess, "unknown")
        XCTAssertTrue(PlaceFilter.accessible.matches(place, average: nil, savedIDs: []))
        XCTAssertEqual(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false), ["Accessible"])
        XCTAssertFalse(PlaceFilter.stairFree.matches(place, average: nil, savedIDs: []))
        XCTAssertFalse(PlaceFilter.elevator.matches(place, average: nil, savedIDs: []))
        XCTAssertNil(place.facilityAccessibility)
    }

    func testExplicitCommunityNoVetoesReviewedPositiveAndUnknownNeverFallsBackToCity() throws {
        var place = community()
        place.facilityAccessibility = "Fully Accessible"
        XCTAssertFalse(place.isReportedAccessible)
        place.reviewedAccessibility = try ReviewedAccessibilityIndex.decode(indexData()).evidence(for: morgan)
        XCTAssertTrue(place.isReportedAccessible)
        for value in ["no", "Yes", "", "true"] {
            place.stepFreeAccess = value
            XCTAssertFalse(place.isReportedAccessible, value)
            XCTAssertFalse(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false).contains("Accessible"))
        }
    }

    func testExplicitCityNegativeOrPartialStatusDoesNotBecomePositiveFromBuildingClaim() throws {
        var place = Place(id: "city-test", name: "City listing", latitude: 40.75, longitude: -73.99, locationType: "Library")
        place.reviewedAccessibility = try ReviewedAccessibilityIndex.decode(indexData()).evidence(for: morgan)
        for value in ["Not Accessible", "Partially Accessible", "Limited Accessibility"] {
            place.facilityAccessibility = value
            XCTAssertFalse(place.isReportedAccessible)
        }
    }

    func testAmbiguityNegationPartialAndConflictsCannotCreatePositiveMatches() {
        let positive = ("buildingAccessibility", "Wheelchair accessible")
        XCTAssertEqual(evidence([positive]).answer, .yes)
        for text in ["Not accessible", "Partially accessible", "not wheelchair accessible", "Accessible route not confirmed", "Main entrance has stairs; alternative elevator route to reception reported."] {
            XCTAssertNotEqual(evidence([("buildingAccessibility", text)]).answer, .yes)
            XCTAssertNotEqual(evidence([positive, ("buildingAccessibility", text)]).answer, .yes)
        }
        XCTAssertEqual(evidence([]).answer, .unknown)
        var place = community()
        place.stepFreeAccess = "yes"
        place.reviewedAccessibility = evidence([("buildingAccessibility", "Partially accessible")])
        XCTAssertFalse(place.isReportedAccessible)
        place.reviewedAccessibility = evidence([("buildingAccessibility", "Accessible route not confirmed")])
        XCTAssertTrue(place.isReportedAccessible)
    }

    func testIndexKeepsExactReviewedProvenanceAndDoesNotChangeUnknownSourceFacts() throws {
        let sourceData = try Data(contentsOf: repo.appendingPathComponent("data/research-map-2026-10-24/public-card-profiles.json"))
        let source = try XCTUnwrap(JSONSerialization.jsonObject(with: sourceData) as? [String: Any])
        let index = try ReviewedAccessibilityIndex.decode(indexData())
        XCTAssertEqual(index.manifestSHA256, source["manifestSHA256"] as? String)
        XCTAssertEqual(index.sourceSHA256, SHA256.hash(data: sourceData).map { String(format: "%02x", $0) }.joined())
        let profiles = try XCTUnwrap(source["profiles"] as? [[String: Any]])
        var count = 0
        for profile in profiles {
            let id = try XCTUnwrap(profile["placeID"] as? String)
            let facts = try XCTUnwrap(profile["facts"] as? [[String: Any]])
            let hasIndependent = facts.contains { ["buildingAccessibility", "restroomAccessibility"].contains($0["field"] as? String ?? "") }
            if hasIndependent {
                count += 1
                let reviewed = try XCTUnwrap(index.evidence(for: id))
                for claim in reviewed.claims {
                    XCTAssertTrue(facts.contains { $0["id"] as? String == claim.id && $0["field"] as? String == claim.field
                        && $0["scope"] as? String == claim.scope && $0["value"] as? String == claim.value
                        && $0["sourceID"] as? String == claim.sourceID })
                }
            } else { XCTAssertNil(index.evidence(for: id)) }
        }
        XCTAssertEqual(count, 139)
    }

    func testIndexRejectsUnboundedForeignAndMalformedShapes() throws {
        let original = try XCTUnwrap(JSONSerialization.jsonObject(with: indexData()) as? [String: Any])
        func check(_ value: [String: Any], file: StaticString = #filePath, line: UInt = #line) {
            XCTAssertThrowsError(try ReviewedAccessibilityIndex.decode(JSONSerialization.data(withJSONObject: value)), file: file, line: line)
        }
        var raw = original; raw["schemaVersion"] = true; check(raw)
        raw = original; raw["schemaVersion"] = 1.5; check(raw)
        raw = original; raw["secret"] = "unexpected"; check(raw)
        raw = original; raw["sourceSHA256"] = "wrong"; check(raw)
        let entries = try XCTUnwrap(original["entries"] as? [[String: Any]])
        raw = original; raw["entries"] = entries + [entries[0]]; check(raw)
        raw = original; raw["entries"] = Array(repeating: entries[0], count: 1201); check(raw)
        var row = entries[0]; row["placeID"] = "../foreign"; raw = original; raw["entries"] = [row]; check(raw)
        var claims = try XCTUnwrap(entries[0]["claims"] as? [[String: Any]])
        claims[0]["scope"] = "venue"; row = entries[0]; row["claims"] = claims
        raw = original; raw["entries"] = [row]; check(raw)
    }

    func testConciseAmenitiesUseSameResolver() {
        var place = community()
        place.restroomType = "Single-Stall All Gender Restroom(s)"
        place.changingStations = "Yes"
        XCTAssertEqual(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false),
                       ["Changing stations", "All-gender restroom"])
        place.reviewedAccessibility = evidence([("buildingAccessibility", "Wheelchair accessible")])
        XCTAssertEqual(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false),
                       ["Accessible", "Changing stations", "All-gender restroom"])
        XCTAssertTrue(PlaceFilter.accessible.matches(place, average: nil, savedIDs: []))
        XCTAssertFalse(PlaceFilter.matchesAll([.accessible, .stairFree], place, average: nil, savedIDs: []))
    }

    func testSelectedProfileCannotCreateAnAccessibilityLabelOrLeakOtherPlaceAmenities() {
        let place = community()
        let profile = CardResearchProfile(placeID: place.id, manifestSHA256: String(repeating: "a", count: 64),
            generatedAt: "2026-10-24T05:00:00Z", sources: [], facts: [
                .init(id: String(repeating: "a", count: 20), field: "buildingAccessibility", label: "Building accessibility",
                      value: "Wheelchair accessible", scope: "building", sourceID: String(repeating: "b", count: 20), section: "amenities", context: "")
            ], comments: [], coveredCommentIDs: [])
        XCTAssertFalse(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false, researchProfile: profile).contains("Accessible"))
        let other = CardResearchProfile(placeID: "another-place", manifestSHA256: profile.manifestSHA256,
            generatedAt: profile.generatedAt, sources: [], facts: [
                .init(id: String(repeating: "a", count: 20), field: "soap", label: "Soap", value: "yes", scope: "restroom",
                      sourceID: String(repeating: "b", count: 20), section: "amenities", context: "")
            ], comments: [], coveredCommentIDs: [])
        XCTAssertFalse(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false, researchProfile: other).contains("Soap"))
    }

    func testMensAndWomensDesignationStaysInRestroomType() {
        var place = community()
        place.restroomType = "Multi-Stall W/M Restrooms"
        XCTAssertTrue(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false).isEmpty)
        XCTAssertEqual(place.restroomType, "Multi-Stall W/M Restrooms")

        place.restroomType = "Both Single-Stall All Gender and Multi-Stall W/M"
        place.changingStations = "Yes"
        XCTAssertEqual(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false),
                       ["Changing stations", "All-gender restroom"])
        XCTAssertEqual(place.restroomType, "Both Single-Stall All Gender and Multi-Stall W/M")
    }

    func testEveryReviewedProfileUsesTheSameAccessibleFilterAndBoundedAmenityVocabulary() throws {
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:
            repo.appendingPathComponent("data/research-map-2026-10-24/public-card-profiles.json"))) as? [String: Any])
        let profiles = try XCTUnwrap(raw["profiles"] as? [[String: Any]])
        let index = try ReviewedAccessibilityIndex.decode(indexData())
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf:
            repo.appendingPathComponent("ios/Restroom Ready/Resources/restrooms.json")))
        let cityByID = Dictionary(uniqueKeysWithValues: city.places.map { ($0.id, $0) })
        let vocabulary: Set<String> = ["Elevator", "Accessible", "Stair free", "Changing stations", "Soap", "Toilet paper",
            "All-gender restroom", "Automatic toilet", "Handwashing basin", "Mirror",
            "Family restroom", "Adult changing table"]
        var indexed = 0
        for row in profiles {
            let id = try XCTUnwrap(row["placeID"] as? String)
            let profile = try CardResearchProfile.decode(id: id, data: row)
            var place = cityByID[id] ?? Place(id: id, name: "Reviewed location", latitude: 40.75, longitude: -73.99,
                locationType: "Other", stepFreeAccess: "unknown")
            place.reviewedAccessibility = index.evidence(for: id)
            if place.reviewedAccessibility != nil { indexed += 1 }
            let labels = place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false, researchProfile: profile)
            XCTAssertEqual(labels.contains("Accessible"), PlaceFilter.accessible.matches(place, average: nil, savedIDs: []), id)
            XCTAssertTrue(Set(labels).isSubset(of: vocabulary), id)
            XCTAssertEqual(Set(labels).count, labels.count, id)
            XCTAssertTrue(labels.allSatisfy { $0.count <= 28 && !$0.contains("\n") }, id)
            XCTAssertFalse(PlaceFilter.stairFree.matches(place, average: nil, savedIDs: []), id)
            XCTAssertFalse(PlaceFilter.elevator.matches(place, average: nil, savedIDs: []), id)
        }
        XCTAssertEqual(profiles.count, 1146)
        XCTAssertEqual(indexed, 139)
    }

    private func amenityProfile(_ observations: [(String, String)], kind: String = "inspection", field: String = "changingStations") -> CardResearchProfile {
        let sourceID = String(repeating: "b", count: 20)
        let source = CardResearchSource(id: sourceID, label: "Inspection", title: "Room inventory",
            url: "https://example.org/inspection", kind: kind, publishedOn: nil, displayedDate: "",
            observedOn: "2026-07-27", retrievedAt: "2026-10-24T05:00:00Z", limitations: "Dated observations")
        return CardResearchProfile(placeID: morgan, manifestSHA256: String(repeating: "a", count: 64),
            generatedAt: "2026-10-24T05:00:00Z", sources: [source],
            facts: observations.enumerated().map { offset, row in
                .init(id: String(format: "%020x", offset), field: field, label: "Reported amenity",
                    value: row.0, scope: "restroom", sourceID: sourceID, section: "amenities", context: row.1)
            }, comments: [], coveredCommentIDs: [])
    }

    private func reportsChangingStations(_ profile: CardResearchProfile, fallback: String? = nil) -> Bool {
        var place = community()
        place.changingStations = fallback
        return place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false,
            researchProfile: profile).contains("Changing stations")
    }

    func testStNicholasDirectoryYesAndDifferentRoomZeroOneCountsKeepKnownChangingStations() throws {
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:
            repo.appendingPathComponent("data/research-map-2026-10-24/public-card-profiles.json"))) as? [String: Any])
        let rows = try XCTUnwrap(raw["profiles"] as? [[String: Any]])
        let id = "i7jb-7jku:row-23tw-52x4~fjrq"
        let row = try XCTUnwrap(rows.first { $0["placeID"] as? String == id })
        let profile = try CardResearchProfile.decode(id: id, data: row)
        let facts = profile.facts(in: "amenities").filter { $0.field == "changingStations" }
        XCTAssertTrue(facts.contains { $0.value == "Yes" && $0.context.isEmpty })
        XCTAssertTrue(facts.contains { $0.value == "0" && $0.context == "Men’s room" })
        XCTAssertTrue(facts.contains { $0.value == "1" && $0.context == "Women’s room" })
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf:
            repo.appendingPathComponent("ios/Restroom Ready/Resources/restrooms.json")))
        let place = try XCTUnwrap(city.places.first { $0.id == id })
        XCTAssertTrue(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false,
            researchProfile: profile).contains("Changing stations"))
    }

    func testPositiveInspectedCountInOneRoomIsNotNegatedByZeroInAnotherRoom() {
        XCTAssertTrue(reportsChangingStations(amenityProfile([("0", "Men’s room"), ("1", "Women’s room")])))
        XCTAssertTrue(reportsChangingStations(amenityProfile([("unknown", "Men’s room"), ("1", "Women’s room")])))
        XCTAssertFalse(reportsChangingStations(amenityProfile([("0", "Men’s room"), ("0", "Women’s room")])))
        XCTAssertTrue(reportsChangingStations(amenityProfile([("Yes", ""), ("0", "Men’s room"), ("1", "Women’s room")])))
    }

    func testGlobalNoUnknownAndConflictsCannotBeOverriddenByRoomCounts() {
        for global in ["No", "unknown", "not-reported", "0", "not available"] {
            XCTAssertFalse(reportsChangingStations(amenityProfile([(global, ""), ("1", "Women’s room")])), global)
        }
        XCTAssertFalse(reportsChangingStations(amenityProfile([("Yes", ""), ("No", ""), ("1", "Women’s room")])))
        for fallback in ["No", "Unknown", ""] {
            XCTAssertFalse(reportsChangingStations(amenityProfile([("1", "Women’s room")]), fallback: fallback), fallback)
        }
    }

    func testSameRoomContradictionsAndUninspectedOrMalformedCountsDoNotEstablishPresence() {
        XCTAssertFalse(reportsChangingStations(amenityProfile([("1", "Women’s room"), ("0", "Women's room")])))
        XCTAssertFalse(reportsChangingStations(amenityProfile([("1", "Women’s room"), ("unknown", "Women’s room")])))
        for value in ["-1", "1.5", "+1", "01", "one", "10000"] {
            XCTAssertFalse(reportsChangingStations(amenityProfile([(value, "Women’s room")])), value)
        }
        XCTAssertFalse(reportsChangingStations(amenityProfile([("1", "Women’s room")], kind: "guide")))
        XCTAssertFalse(reportsChangingStations(amenityProfile([])))
    }

    func testAll135LimitedRoomDirectoryPositivesRetainGeneralChangingStationsLabel() throws {
        let aliases = ["\"Yes, in women's restroom only\"": 83, "\"Yes, in men's restroom only\"": 26,
            "\"Yes, in single-stall all gender restroom only\"": 26]
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf:
            repo.appendingPathComponent("ios/Restroom Ready/Resources/restrooms.json")))
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf:
            repo.appendingPathComponent("data/research-map-2026-10-24/public-card-profiles.json"))) as? [String: Any])
        let rows = try XCTUnwrap(raw["profiles"] as? [[String: Any]])
        let byID = Dictionary(uniqueKeysWithValues: rows.map { ($0["placeID"] as! String, $0) })
        var checked = 0
        for (alias, count) in aliases {
            let places = city.places.filter { $0.changingStations == alias }
            XCTAssertEqual(places.count, count, alias)
            for place in places {
                XCTAssertTrue(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false).contains("Changing stations"), place.id)
                let profile = try CardResearchProfile.decode(id: place.id, data: XCTUnwrap(byID[place.id]))
                XCTAssertTrue(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false,
                    researchProfile: profile).contains("Changing stations"), place.id)
                checked += 1
            }
        }
        XCTAssertEqual(checked, 135)
    }

    func testExactLimitedRoomAndReviewedLocationClaimsDoNotOverrideGlobalNoOrUnknown() {
        let values = ["Yes, in women's restroom only", "Yes, in men's restroom only", "Yes, in single-stall all gender restroom only",
            "\"Yes, in women's restroom only\"", "\"Yes, in men's restroom only\"", "\"Yes, in single-stall all gender restroom only\"",
            "Floor 2", "Changing stations on each floor, including private all-gender restrooms"]
        for value in values {
            XCTAssertTrue(reportsChangingStations(amenityProfile([(value, "")], kind: "official-page")), value)
            XCTAssertTrue(reportsChangingStations(amenityProfile([]), fallback: value), value)
            XCTAssertFalse(reportsChangingStations(amenityProfile([(value, ""), ("No", "")])), value)
            XCTAssertFalse(reportsChangingStations(amenityProfile([(value, ""), ("unknown", "")])), value)
        }
        for value in ["N/A", "\"N/A, restrooms closed\"", "N/A - closed for capital", "No", "Unknown",
                      "No, in women's restroom only", "Yes, maybe on floor 2"] {
            XCTAssertFalse(reportsChangingStations(amenityProfile([(value, "")])), value)
            XCTAssertFalse(reportsChangingStations(amenityProfile([]), fallback: value), value)
        }
    }

    func testDispenserCountsNeverBecomeSoapOrPaperSupplyAvailability() {
        let place = community()
        for (field, label) in [("soap", "Soap"), ("toiletPaper", "Toilet paper")] {
            for value in ["0", "1", "2", "Yes, in women's restroom only", "Floor 2"] {
                let profile = amenityProfile([(value, "Men’s room")], field: field)
                XCTAssertFalse(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false,
                    researchProfile: profile).contains(label), field + ":" + value)
            }
            let profile = amenityProfile([("Yes", "")], kind: "official-page", field: field)
            XCTAssertTrue(place.amenityLabels(accessDetailsLoading: false, accessDetailsFailed: false,
                researchProfile: profile).contains(label))
        }
    }
}
