import Foundation
import XCTest
@testable import RestroomDirectory

final class DirectoryTests: XCTestCase {
    private var resources: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Restroom Ready/Resources")
    }
    private func place() -> Place {
        Place(id: "i7jb-7jku:row-xx8b.jbx~cp6w", name: "Directory place", latitude: 40.75,
              longitude: -73.99, locationType: "Library", sourceRecordId: "row-xx8b.jbx~cp6w")
    }

    private func registryJSON() throws -> [String: Any] {
        let data = try Data(contentsOf: resources.appendingPathComponent("source-reports.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func registry(from json: [String: Any]) throws -> ResearchRegistry {
        try JSONDecoder().decode(ResearchRegistry.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testBundledDirectoryRetainsWebIDsAndMissingFacts() throws {
        let data = try Data(contentsOf: resources.appendingPathComponent("restrooms.json"))
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let records = try XCTUnwrap(raw["restrooms"] as? [[String: Any]])
        let city = try JSONDecoder().decode(CitySnapshot.self, from: data)
        XCTAssertGreaterThan(city.places.count, 1000)
        XCTAssertEqual(city.places.map(\.id), records.compactMap { $0["id"] as? String })
        XCTAssertEqual(Set(city.places.map(\.id)).count, city.places.count)
        XCTAssertTrue(city.places.allSatisfy { !$0.isCommunity && $0.entryRule == nil && $0.passcodeRequired == nil })
        XCTAssertEqual(city.places.count, 1064)
        XCTAssertEqual(city.places.filter { PlaceFilter.accessible.matches($0, average: nil, savedIDs: []) }.count, 619)
        XCTAssertFalse(city.source.limitations.isEmpty)
    }

    func testMissingCodeIsNotAnExplicitNoCodeReport() {
        var p = place()
        XCTAssertFalse(PlaceFilter.noCode.matches(p, average: nil, savedIDs: []))
        p = Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Venue", latitude: 40.75,
                  longitude: -73.99, locationType: "Store", passcodeRequired: "unknown")
        XCTAssertFalse(PlaceFilter.noCode.matches(p, average: nil, savedIDs: []))
        p.passcodeRequired = "no"
        XCTAssertTrue(PlaceFilter.noCode.matches(p, average: nil, savedIDs: []))
    }

    func testCleanFilterExcludesUnratedInvalidAndLowRatings() {
        let p = place()
        for value in [nil, Double.nan, Double.infinity, -1, 3.99, 5.5] as [Double?] {
            XCTAssertFalse(PlaceFilter.clean.matches(p, average: value, savedIDs: []))
        }
        XCTAssertTrue(PlaceFilter.clean.matches(p, average: 4, savedIDs: []))
    }

    func testDiscoveryFiltersContainOnlyTheFiveIndependentChoices() {
        XCTAssertEqual(PlaceFilter.discoveryFilters, [.clean, .accessible, .stairFree, .public, .elevator])
        XCTAssertEqual(PlaceFilter.discoveryFilters.map(\.title), ["Clean", "Accessible", "Stair Free", "Public", "Elevator access"])
        XCTAssertFalse(PlaceFilter.allCases.map(\.rawValue).contains("all"))
        XCTAssertFalse(PlaceFilter.discoveryFilters.contains(.noCode))
        XCTAssertFalse(PlaceFilter.discoveryFilters.contains(.saved))
    }

    func testNoSelectedFiltersIncludesPlacesWithUnknownFacts() {
        let p = Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Unreported venue", latitude: 40.75,
                      longitude: -73.99, locationType: "Store")
        XCTAssertTrue(PlaceFilter.matchesAll([], p, average: nil, savedIDs: []))
        for filter in PlaceFilter.discoveryFilters {
            XCTAssertFalse(PlaceFilter.matchesAll([filter], p, average: nil, savedIDs: []), filter.title)
        }
    }

    func testMultipleFiltersRequireEverySelectedCondition() {
        var p = Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Reported venue", latitude: 40.75,
                      longitude: -73.99, locationType: "Store", entryRule: "public", stepFreeAccess: "yes")
        let choices: Set<PlaceFilter> = [.clean, .accessible, .stairFree, .public, .elevator]
        XCTAssertTrue(PlaceFilter.matchesAll(choices, p, average: 4.5, savedIDs: [], elevatorPlaceIDs: [p.id]))

        // A match for the other choices cannot compensate for a missing condition.
        XCTAssertFalse(PlaceFilter.matchesAll(choices, p, average: nil, savedIDs: [], elevatorPlaceIDs: [p.id]))
        XCTAssertFalse(PlaceFilter.matchesAll(choices, p, average: 3.5, savedIDs: [], elevatorPlaceIDs: [p.id]))
        XCTAssertFalse(PlaceFilter.matchesAll(choices, p, average: 4.5, savedIDs: []))
        p.entryRule = "customers"
        XCTAssertFalse(PlaceFilter.matchesAll(choices, p, average: 4.5, savedIDs: [], elevatorPlaceIDs: [p.id]))
        p.entryRule = "public"
        p.stepFreeAccess = "unknown"
        XCTAssertFalse(PlaceFilter.matchesAll(choices, p, average: 4.5, savedIDs: [], elevatorPlaceIDs: [p.id]))

        // Removing a choice makes only that requirement optional; clearing restores the full set.
        var remaining = choices
        remaining.remove(.accessible)
        XCTAssertFalse(PlaceFilter.matchesAll(remaining, p, average: 4.5, savedIDs: [], elevatorPlaceIDs: [p.id]))
        remaining.remove(.stairFree)
        XCTAssertTrue(PlaceFilter.matchesAll(remaining, p, average: 4.5, savedIDs: [], elevatorPlaceIDs: [p.id]))
        remaining.removeAll()
        XCTAssertTrue(PlaceFilter.matchesAll(remaining, p, average: nil, savedIDs: []))
        XCTAssertEqual(p.stepFreeAccess, "unknown")
        XCTAssertNil(p.facilityAccessibility)
    }

    func testPublicRequiresDirectoryProvenanceOrExplicitPublicEntry() {
        XCTAssertTrue(PlaceFilter.public.matches(place(), average: nil, savedIDs: []))
        let unknown = Place(id: "unattributed", name: "Unattributed place", latitude: 40.75,
                            longitude: -73.99, locationType: "Library")
        XCTAssertFalse(PlaceFilter.public.matches(unknown, average: nil, savedIDs: []))
        var community = Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Reported venue", latitude: 40.75,
                              longitude: -73.99, locationType: "Store", sourceRecordId: "unrelated-city-row")
        for entry in [nil, "unknown", "customers", "Public", ""] as [String?] {
            community.entryRule = entry
            XCTAssertFalse(PlaceFilter.public.matches(community, average: nil, savedIDs: []), String(describing: entry))
        }
        community.entryRule = "public"
        XCTAssertTrue(PlaceFilter.public.matches(community, average: nil, savedIDs: []))
    }

    func testElevatorFilterDoesNotInferRestroomRouteFromAccessibilityOrFreeText() {
        var p = place()
        p.facilityAccessibility = "Fully Accessible"
        p.stepFreeAccess = "yes"
        p.accessNotes = "Elevator to lobby"
        p.communityNotes = "Elevator; accessible entrance; no stairs"
        XCTAssertTrue(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
        XCTAssertFalse(PlaceFilter.elevator.matches(p, average: nil, savedIDs: []))
        XCTAssertFalse(PlaceFilter.elevator.matches(p, average: nil, savedIDs: [], elevatorPlaceIDs: ["another-place"]))
        p.facilityAccessibility = nil
        p.stepFreeAccess = nil
        XCTAssertTrue(PlaceFilter.elevator.matches(p, average: nil, savedIDs: [], elevatorPlaceIDs: [p.id]))
        XCTAssertFalse(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
    }

    func testStepFreeReportIsNotAFacilityAccessibilityCertification() {
        var p = place()
        p.stepFreeAccess = "yes"
        XCTAssertFalse(p.isReportedAccessible)
        XCTAssertEqual(p.accessibilityLabel, "Not confirmed")
        XCTAssertFalse(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
        p.facilityAccessibility = "Fully Accessible"
        XCTAssertTrue(p.isReportedAccessible)
        XCTAssertEqual(p.accessibilityLabel, "Reported accessible")
        XCTAssertTrue(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
    }

    func testAccessibleIncludesOnlyExplicitCommunityStepFreeReportsWithoutChangingCityProvenance() throws {
        let data: [String: Any] = [
            "name": "Reported venue", "address": "NYC venue address", "latitude": 40.75, "longitude": -73.99,
            "locationType": "other", "entryRule": "unknown", "stepFreeAccess": "yes", "notes": "Elevator; no stairs",
            "submittedAt": Date(timeIntervalSince1970: 1_792_670_400)
        ]
        var p = try XCTUnwrap(Place.community(id: "community-ABCDEFGHIJKLMNOPQRST", data: data))
        XCTAssertTrue(p.isReportedAccessible)
        XCTAssertEqual(p.accessibilityLabel, "Reported accessible")
        XCTAssertTrue(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
        XCTAssertEqual(p.stepFreeAccess, "yes")
        XCTAssertNil(p.facilityAccessibility)
        XCTAssertNil(p.sourceRecordId)
        XCTAssertNil(p.sourceUrl)

        for value in [nil, "no", "unknown", "Yes", ""] as [String?] {
            p.stepFreeAccess = value
            XCTAssertFalse(p.isReportedAccessible)
            XCTAssertEqual(p.accessibilityLabel, "Not confirmed")
            XCTAssertFalse(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
        }
        XCTAssertNil(p.facilityAccessibility)
    }

    func testCommunityUnknownAndNegativeReportsCannotFallBackToCityField() {
        var p = Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Reported venue", latitude: 40.75,
                      longitude: -73.99, locationType: "Store", facilityAccessibility: "Fully Accessible",
                      communityNotes: "Accessible elevator; no stairs")
        for value in [nil, "no", "unknown", "Yes", "true", ""] as [String?] {
            p.stepFreeAccess = value
            XCTAssertFalse(p.isReportedAccessible, "Unexpected positive for \(String(describing: value))")
            XCTAssertEqual(p.accessibilityLabel, "Not confirmed")
            XCTAssertFalse(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
            XCTAssertEqual(p.facilityAccessibility, "Fully Accessible")
        }
        p.stepFreeAccess = "yes"
        XCTAssertTrue(p.isReportedAccessible)
        XCTAssertEqual(p.accessibilityLabel, "Reported accessible")
        XCTAssertTrue(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
    }

    func testCityUnknownPartialAndMalformedValuesStayUnconfirmed() {
        var p = place()
        p.stepFreeAccess = "yes"
        p.accessNotes = "Step-free route reported in notes"
        for value in [nil, "Not Accessible", "Partially Accessible", "Unknown", "fully accessible", ""] as [String?] {
            p.facilityAccessibility = value
            XCTAssertFalse(p.isReportedAccessible)
            XCTAssertEqual(p.accessibilityLabel, "Not confirmed")
            XCTAssertFalse(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
        }
        p.facilityAccessibility = "Fully Accessible"
        XCTAssertTrue(p.isReportedAccessible)
        XCTAssertEqual(p.accessibilityLabel, "Reported accessible")
        XCTAssertTrue(PlaceFilter.accessible.matches(p, average: nil, savedIDs: []))
    }

    func testSourcesRemainSeparateFromVisitorObservationDates() throws {
        let data = try Data(contentsOf: resources.appendingPathComponent("source-reports.json"))
        let registry = try JSONDecoder().decode(ResearchRegistry.self, from: data)
        XCTAssertFalse(registry.reports.isEmpty)
        XCTAssertTrue(registry.reports.allSatisfy { registry.source(for: $0) != nil })
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let reports = try XCTUnwrap(raw["reports"] as? [[String: Any]])
        XCTAssertTrue(reports.allSatisfy { $0["observedOn"] is NSNull })
    }

    func testElevatorRegistryIncludesOnlyTheReviewedRestroomLevelRoute() throws {
        let json = try registryJSON()
        let registry = try registry(from: json)
        XCTAssertEqual(registry.reportedElevatorPlaceIDs, ["community-30c01c58b8ff4dd8e3c4"])
        XCTAssertFalse(registry.reportedElevatorPlaceIDs.contains("community-1b015ac4fc7adf2bb0d9"))

        // A lobby elevator remains source history; it is not silently rewritten into a restroom route.
        let lobbyReport = try XCTUnwrap(registry.reports.first { $0.id == "a2482ac37a893bc1fcc2" })
        XCTAssertEqual(lobbyReport.facts, [.init(field: "elevatorAccess", value: "Elevator to lobby")])
        let route = try XCTUnwrap(registry.reports.first { $0.id == "7e357bd832b142605e31" })
        XCTAssertEqual(route.sourceID, "G26-002")
        XCTAssertNil(route.reportedOn)
        XCTAssertTrue(route.facts.contains(.init(field: "elevatorAccess", value: "Explicitly directs elevator down to restroom level.")))
        XCTAssertEqual(registry.reports.count, (json["reports"] as? [[String: Any]])?.count)
    }

    func testElevatorRegistryRejectsMissingOrMismatchedReviewedEvidence() throws {
        let original = try registryJSON()
        let reports = try XCTUnwrap(original["reports"] as? [[String: Any]])
        let index = try XCTUnwrap(reports.firstIndex { $0["id"] as? String == "7e357bd832b142605e31" })
        let changes: [(String, Any)] = [
            ("id", "unreviewed-report"),
            ("sourceID", "reddit-1waugwo"),
            ("placeID", "community-1b015ac4fc7adf2bb0d9"),
            ("facts", [["field": "elevatorAccess", "value": "Elevator to lobby"]]),
            ("facts", [["field": "restroomLocation", "value": "Explicitly directs elevator down to restroom level."]])
        ]
        for (field, value) in changes {
            var changed = original
            var changedReports = reports
            changedReports[index][field] = value
            changed["reports"] = changedReports
            XCTAssertTrue(try registry(from: changed).reportedElevatorPlaceIDs.isEmpty, "Accepted altered \(field)")
        }
        var noReport = original
        noReport["reports"] = reports.filter { $0["id"] as? String != "7e357bd832b142605e31" }
        XCTAssertTrue(try registry(from: noReport).reportedElevatorPlaceIDs.isEmpty)

        var noSource = original
        let sources = try XCTUnwrap(original["sources"] as? [[String: Any]])
        noSource["sources"] = sources.filter { $0["id"] as? String != "G26-002" }
        XCTAssertTrue(try registry(from: noSource).reportedElevatorPlaceIDs.isEmpty)

        var changedSource = original
        var changedSources = sources
        let sourceIndex = try XCTUnwrap(sources.firstIndex { $0["id"] as? String == "G26-002" })
        changedSources[sourceIndex]["url"] = "https://example.com/unreviewed-elevator-claim"
        changedSource["sources"] = changedSources
        XCTAssertTrue(try registry(from: changedSource).reportedElevatorPlaceIDs.isEmpty)
    }

    func testCommunityCoordinatesMustBeFiniteAndInsideNYC() {
        XCTAssertFalse(Place.containsNYC(latitude: .nan, longitude: -73.99))
        XCTAssertFalse(Place.containsNYC(latitude: 39.95, longitude: -75.16))
        XCTAssertTrue(Place.containsNYC(latitude: 40.75, longitude: -73.99))
    }

    func testSavedFilterRequiresTheExactStableID() {
        let p = place()
        XCTAssertFalse(PlaceFilter.saved.matches(p, average: nil, savedIDs: ["another-id"]))
        XCTAssertTrue(PlaceFilter.saved.matches(p, average: nil, savedIDs: [p.id]))
    }

    private func readiness(_ filters: Set<PlaceFilter> = [], publicLoading: Bool = false,
                           publicFailed: Bool = false, ratingsLoading: Bool = false,
                           ratingsFailed: Bool = false, signedIn: Bool = false,
                           privateLoading: Bool = false, privateFailed: Bool = false,
                           accessDetailsLoading: Bool = false, accessDetailsFailed: Bool = false) -> DiscoveryResultsReadiness {
        DiscoveryResultsReadiness.evaluate(filters: filters, publicLoading: publicLoading,
            publicFailed: publicFailed, ratingsLoading: ratingsLoading, ratingsFailed: ratingsFailed,
            signedIn: signedIn, privateLoading: privateLoading, privateFailed: privateFailed,
            accessDetailsLoading: accessDetailsLoading, accessDetailsFailed: accessDetailsFailed)
    }

    func testEveryDiscoveryModeWaitsForPublicPlacesBeforeClaimingNoMatches() {
        let choices: [Set<PlaceFilter>] = [[], [.clean], [.accessible], [.stairFree], [.public], [.elevator],
            [.saved], [.clean, .accessible, .stairFree, .public, .elevator, .saved]]
        for filters in choices {
            XCTAssertEqual(readiness(filters, publicLoading: true, signedIn: true), .loading)
            XCTAssertEqual(readiness(filters, publicFailed: true, signedIn: true), .unavailable)
            XCTAssertEqual(readiness(filters, signedIn: true), .ready)
        }
    }

    func testCleanCannotClaimNoMatchesWhileRatingsLoadOrFail() {
        for filters: Set<PlaceFilter> in [[.clean], [.clean, .accessible, .public, .elevator]] {
            XCTAssertEqual(readiness(filters, ratingsLoading: true), .loading)
            XCTAssertEqual(readiness(filters, ratingsFailed: true), .unavailable)
            XCTAssertEqual(readiness(filters, ratingsLoading: true, ratingsFailed: true), .unavailable)
            XCTAssertEqual(readiness(filters), .ready)
        }
    }

    func testSavedEmptyClaimRequiresASignedInSuccessfulPrivateRead() {
        XCTAssertEqual(readiness([.saved]), .unavailable)
        XCTAssertEqual(readiness([.saved], privateLoading: true), .unavailable)
        XCTAssertEqual(readiness([.saved], signedIn: true, privateLoading: true), .loading)
        XCTAssertEqual(readiness([.saved], signedIn: true, privateFailed: true), .unavailable)
        XCTAssertEqual(readiness([.saved], signedIn: true), .ready)
    }

    func testOrdinaryDiscoveryIgnoresUnrelatedRatingsAndAccountFeeds() {
        for filters: Set<PlaceFilter> in [[], [.accessible], [.public], [.elevator], [.accessible, .public, .elevator]] {
            XCTAssertEqual(readiness(filters, ratingsLoading: true, ratingsFailed: true,
                signedIn: false, privateLoading: true, privateFailed: true), .ready)
        }
        XCTAssertEqual(readiness([.clean], signedIn: false, privateLoading: true, privateFailed: true), .ready)
        XCTAssertEqual(readiness([.saved], ratingsLoading: true, ratingsFailed: true, signedIn: true), .ready)
    }

    func testRelevantFailureAndAuthenticationTakePriorityOverLoading() {
        XCTAssertEqual(readiness(publicLoading: true, publicFailed: true), .unavailable)
        XCTAssertEqual(readiness([.clean], publicLoading: true, ratingsFailed: true), .unavailable)
        XCTAssertEqual(readiness([.saved], publicLoading: true, signedIn: false), .unavailable)
        XCTAssertEqual(readiness([.saved], publicLoading: true, signedIn: true, privateFailed: true), .unavailable)
        XCTAssertEqual(readiness([.clean, .saved], ratingsLoading: true,
            signedIn: true, privateFailed: true), .unavailable)
    }

    func testCombinedCleanAndSavedWaitForBothRequiredFeeds() {
        let filters: Set<PlaceFilter> = [.clean, .saved, .accessible]
        XCTAssertEqual(readiness(filters, ratingsLoading: true, signedIn: true), .loading)
        XCTAssertEqual(readiness(filters, signedIn: true, privateLoading: true), .loading)
        XCTAssertEqual(readiness(filters, ratingsFailed: true, signedIn: true), .unavailable)
        XCTAssertEqual(readiness(filters, signedIn: true, privateFailed: true), .unavailable)
        XCTAssertEqual(readiness(filters, signedIn: true), .ready)
    }

    private func accessData(_ id: String = "community-7398fe084d3d87eed23c") -> [String: Any] {
        let reported = Date(timeIntervalSince1970: 1_792_768_800)
        return ["schemaVersion": 1, "placeID": id, "restroomHours": "Open 24 hours a day, 7 days a week",
            "entranceLocation": "Use the step-free doors on the right side of the main entrance.",
            "entranceStepFree": "yes", "stairFreeRoute": "yes", "elevatorToRestroom": "yes",
            "elevatorNote": "Take the elevator and choose Penthouse.", "restroomFloor": "23rd floor",
            "stairsAfterEntry": 0, "sourceTitle": "Contributor report", "reportedAt": reported,
            "observedOn": NSNull(), "updatedAt": reported.addingTimeInterval(60),
            "limitations": "Observation date and entry permission not provided. Current operation and stall features are not confirmed."]
    }

    func testKnownCityHoursStayVisibleDuringOptionalFeedLoadingAndFailure() {
        var p = place()
        p.hours = "6:00 a.m. – 10:00 p.m."
        for (loading, failed) in [(false, false), (true, false), (false, true), (true, true)] {
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: loading, accessDetailsFailed: failed), p.hours)
        }
        XCTAssertEqual(p.hours, "6:00 a.m. – 10:00 p.m.")
    }

    func testUnknownHoursDistinguishLoadingFailureAndSuccessfulAbsence() {
        for p in [place(), Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Unreported", latitude: 40.75,
                                 longitude: -73.99, locationType: "Other")] {
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: true, accessDetailsFailed: false), "Loading hours…")
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: true), "Hours unavailable")
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: true, accessDetailsFailed: true), "Hours unavailable")
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false), "Hours unknown")
        }
    }

    func testValidatedHoursOverrideCityHoursWithoutRewritingEitherSource() throws {
        var p = place()
        p.hours = "Original directory hours"
        p.accessDetails = try RestroomAccessDetails.decode(id: p.id, data: accessData(p.id))
        for (loading, failed) in [(false, false), (true, false), (false, true)] {
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: loading, accessDetailsFailed: failed), "24 hours daily")
        }
        XCTAssertEqual(p.hours, "Original directory hours")
        XCTAssertEqual(p.reportedRestroomHours, "Open 24 hours a day, 7 days a week")
        XCTAssertNil(p.accessDetails?.observedOn)
    }

    func testCompactHoursSimplifiesOnlyTheExactCanonicalPhrase() {
        var p = place()
        for value in ["24/7", "Open 24 hours", "Open 24 hours a day, seven days a week",
                      "Open 24 hours a day, 7 days a week.", "Open dawn to dusk"] {
            p.hours = value
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false), value)
        }
        p.hours = "Open 24 hours a day, 7 days a week"
        XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false), "24 hours daily")
        p.hours = " \n "
        XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false), "Hours unknown")
    }

    func testEveryBundledKnownHourSurvivesAnUnrelatedSidecarFailure() throws {
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf: resources.appendingPathComponent("restrooms.json")))
        let known = city.places.filter { !($0.hours?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) }
        XCTAssertEqual(known.count, 971)
        for p in known {
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: true, accessDetailsFailed: true),
                           p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false), p.id)
        }
    }

    func testWeeklyHoursShowOnlyTodayAndPreserveRawDetails() {
        let raw = "Sunday: Closed \nMonday: 10–6 \nTuesday: 10–6\nWednesday: 10–6\nThursday: 10–6\nFriday: 10–5\nSaturday: 10–5"
        var p = place(); p.hours = raw
        let friday = ISO8601DateFormatter().date(from: "2026-11-06T17:00:00Z")!
        XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false, now: friday), "Today: 10–5")
        XCTAssertEqual(p.hours, raw)
        XCTAssertEqual(p.reportedRestroomHours, raw)
        let closed = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
            .map { $0 + ": Closed" }.joined(separator: "\n")
        XCTAssertEqual(Place.compactWeeklyHours(closed), "Mon–Sun: Closed")
    }

    func testWeeklyHoursDoNotMergeNonadjacentOrMerelySimilarSchedules() {
        let raw = "Monday: 10am–6pm\nTuesday: 10am–6pm\nWednesday: 10 am–6 pm\nThursday: 10am–6pm\nFriday: Closed\nSaturday: Closed\nSunday: 10am–6pm"
        XCTAssertEqual(Place.compactWeeklyHours(raw),
                       "Mon–Tue: 10am–6pm\nWed: 10 am–6 pm\nThu: 10am–6pm\nFri–Sat: Closed\nSun: 10am–6pm")
    }

    func testWeeklyHoursAcceptOnlyTheTwoKnownLiteralDayDelimiters() {
        let raw = "Monday\t10–6\nTuesday\t10–6\nWednesday\t10–6\nThursday\t10–6\nFriday\t10–6\nSaturday\tClosed\nSunday\tClosed"
        XCTAssertEqual(Place.compactWeeklyHours(raw), "Mon–Fri: 10–6\nSat–Sun: Closed")
        XCTAssertEqual(Place.compactWeeklyHours(raw.replacingOccurrences(of: "Friday\t", with: "Friday: ")),
                       "Mon–Fri: 10–6\nSat–Sun: Closed")
        for delimiter in [" ", ":", ":\t", " - "] {
            XCTAssertNil(Place.compactWeeklyHours(raw.replacingOccurrences(of: "Friday\t", with: "Friday" + delimiter)))
        }
    }

    func testMalformedWeeklySchedulesKeepOriginalBehindConciseFallbackWithoutGuessing() {
        let raw = "Monday: 10–6\nTuesday: 10–6\nWednesday: 10–6\nThursday: 10–6\nFriday: 10–5\nSaturday: 10–5\nSunday: Closed"
        let malformed = [raw.replacingOccurrences(of: "Sunday: Closed", with: "Monday: Closed"),
                         raw.replacingOccurrences(of: "Tuesday: 10–6\n", with: ""),
                         raw + "\nHoliday: Closed",
                         raw.replacingOccurrences(of: "Sunday: Closed", with: "Sunday: "),
                         raw.replacingOccurrences(of: "Friday: ", with: "Friday??? ")]
        for value in malformed {
            var p = place(); p.hours = value
            XCTAssertNil(Place.compactWeeklyHours(value))
            XCTAssertEqual(p.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false), "Schedule varies — see full schedule")
            XCTAssertEqual(p.resolvedHours()?.fullScheduleText, value)
        }
    }

    func testRealWeeklyLibraryScheduleGroupsWithoutChangingAnyDayValue() throws {
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf: resources.appendingPathComponent("restrooms.json")))
        let p = try XCTUnwrap(city.places.first { $0.id == "i7jb-7jku:row-ahsi-k4c4-scek" })
        let thursday = ISO8601DateFormatter().date(from: "2026-11-05T17:00:00Z")!
        XCTAssertEqual(p.overviewHours(accessDetailsLoading: true, accessDetailsFailed: true, now: thursday),
                       "Today: 10:00 am - 6:00 pm")
        XCTAssertTrue(try XCTUnwrap(p.reportedRestroomHours).contains("Thursday: 10:00 am - 6:00 pm"))
        XCTAssertEqual(try XCTUnwrap(p.reportedRestroomHours).components(separatedBy: "\n").count, 7)
    }

    func testAmenitiesUseOnlySupportedPositivesAndKeepUnknownStatesDistinct() {
        var p = place()
        p.accessNotes = "Elevator to lobby; automatic doors; no stairs"
        XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: false, accessDetailsFailed: false), "No amenities reported")
        XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: true, accessDetailsFailed: false), "Loading amenities…")
        XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: false, accessDetailsFailed: true), "Amenities unavailable")
        p.facilityAccessibility = "Fully Accessible"
        XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: false, accessDetailsFailed: false), "Accessible")
        XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: true, accessDetailsFailed: true), "Accessible")
        XCTAssertEqual(p.overviewAmenities(reviewedElevatorPlaceIDs: [p.id], accessDetailsLoading: false,
                                         accessDetailsFailed: false), "Elevator · Accessible")
        XCTAssertEqual(p.overviewAmenities(reviewedElevatorPlaceIDs: [p.id], accessDetailsLoading: true,
                                         accessDetailsFailed: false), "Accessible")
    }

    func testKnownSidecarAmenitiesSurviveUnrelatedFeedStateWithoutInferringAccessibleStalls() throws {
        let id = "community-7398fe084d3d87eed23c"
        var p = Place(id: id, name: "Peninsula", latitude: 40.75, longitude: -73.99,
                      locationType: "Other", stepFreeAccess: "yes")
        p.accessDetails = try RestroomAccessDetails.decode(id: id, data: accessData(id))
        for (loading, failed) in [(false, false), (true, false), (false, true)] {
            XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: loading, accessDetailsFailed: failed),
                           "Elevator · Accessible · Stair free")
        }
        // The original shared Accessible resolver remains independent from sidecar route answers.
        p.stepFreeAccess = "unknown"
        XCTAssertEqual(p.overviewAmenities(accessDetailsLoading: false, accessDetailsFailed: false), "Elevator · Stair free")
    }

    func testNegativeAndUnknownSidecarsSuppressAmenityFallbacks() throws {
        let id = "community-ABCDEFGHIJKLMNOPQRST"
        var p = Place(id: id, name: "Community", latitude: 40.75, longitude: -73.99,
                      locationType: "Other", stepFreeAccess: "yes")
        for answer in ["no", "unknown"] {
            var data = accessData(id)
            data["stairFreeRoute"] = answer
            data["elevatorToRestroom"] = answer
            p.accessDetails = try RestroomAccessDetails.decode(id: id, data: data)
            XCTAssertEqual(p.overviewAmenities(reviewedElevatorPlaceIDs: [id], accessDetailsLoading: false,
                                             accessDetailsFailed: false), "Accessible")
        }
        p.accessDetails = nil
        XCTAssertEqual(p.overviewAmenities(reviewedElevatorPlaceIDs: [id], accessDetailsLoading: true,
                                         accessDetailsFailed: false), "Accessible")
        XCTAssertEqual(p.overviewAmenities(reviewedElevatorPlaceIDs: [id], accessDetailsLoading: false,
                                         accessDetailsFailed: false), "Elevator · Accessible · Stair free")
    }

    func testStructuredPeninsulaFactsMatchAllReportedRouteFiltersWithoutInventingAVisit() throws {
        let id = "community-7398fe084d3d87eed23c"
        var p = Place(id: id, name: "The Peninsula", latitude: 40.7618705, longitude: -73.9754663,
            locationType: "Other", entryRule: "unknown", stepFreeAccess: "yes", communityNotes: "Original notes")
        p.accessDetails = try RestroomAccessDetails.decode(id: id, data: accessData(id))
        XCTAssertTrue(PlaceFilter.matchesAll([.accessible, .stairFree, .elevator], p, average: nil, savedIDs: []))
        XCTAssertEqual(p.reportedRestroomHours, "Open 24 hours a day, 7 days a week")
        XCTAssertEqual(p.accessDetails?.entranceLocation, "Use the step-free doors on the right side of the main entrance.")
        XCTAssertEqual(p.accessDetails?.restroomFloor, "23rd floor")
        XCTAssertEqual(p.accessDetails?.stairsAfterEntry, 0)
        XCTAssertEqual(p.accessDetails?.elevatorNote, "Take the elevator and choose Penthouse.")
        XCTAssertNil(p.accessDetails?.observedOn)
        XCTAssertNil(p.observedOn)
        XCTAssertNil(p.hours)
        XCTAssertEqual(p.entryRule, "unknown")
        XCTAssertEqual(p.communityNotes, "Original notes")
        XCTAssertFalse(PlaceFilter.public.matches(p, average: nil, savedIDs: []))
        XCTAssertFalse(PlaceFilter.clean.matches(p, average: nil, savedIDs: []))
    }

    func testStairFreeNeverInfersCityAccessibilityFloorsOrNotes() {
        var p = place()
        p.facilityAccessibility = "Fully Accessible"
        p.stepFreeAccess = "yes"
        p.accessNotes = "0 stairs; accessible elevator entrance"
        XCTAssertTrue(p.isReportedAccessible)
        XCTAssertFalse(p.isReportedStairFree)
        XCTAssertFalse(PlaceFilter.stairFree.matches(p, average: nil, savedIDs: []))
        p = Place(id: "community-ABCDEFGHIJKLMNOPQRST", name: "Community", latitude: 40.75,
            longitude: -73.99, locationType: "Other", communityNotes: "No stairs and elevator")
        for answer in [nil, "unknown", "no", "Yes", ""] as [String?] {
            p.stepFreeAccess = answer
            XCTAssertFalse(p.isReportedStairFree)
        }
        p.stepFreeAccess = "yes"
        XCTAssertTrue(p.isReportedStairFree)
    }

    func testSidecarUnknownAndNegativeOwnRouteAndElevatorWithoutErasingOriginalFacts() throws {
        let id = "community-ABCDEFGHIJKLMNOPQRST"
        var p = Place(id: id, name: "Community", latitude: 40.75, longitude: -73.99,
            locationType: "Other", hours: "Original directory hours", stepFreeAccess: "yes")
        for answer in ["unknown", "no"] {
            var data = accessData(id)
            data["stairFreeRoute"] = answer; data["elevatorToRestroom"] = answer
            data["restroomHours"] = NSNull(); data["entranceLocation"] = NSNull()
            data["elevatorNote"] = NSNull(); data["restroomFloor"] = NSNull(); data["stairsAfterEntry"] = NSNull()
            p.accessDetails = try RestroomAccessDetails.decode(id: id, data: data)
            XCTAssertFalse(PlaceFilter.stairFree.matches(p, average: nil, savedIDs: []))
            XCTAssertFalse(PlaceFilter.elevator.matches(p, average: nil, savedIDs: [], elevatorPlaceIDs: [id]))
            XCTAssertEqual(p.stairFreeRouteAnswer, answer)
            XCTAssertEqual(p.stepFreeAccess, "yes")
            XCTAssertTrue(p.isReportedAccessible)
            XCTAssertEqual(p.reportedRestroomHours, "Original directory hours")
            XCTAssertNil(p.accessDetails?.entranceLocation)
        }
        p.accessDetails = nil
        XCTAssertTrue(p.isReportedStairFree)
        XCTAssertTrue(PlaceFilter.elevator.matches(p, average: nil, savedIDs: [], elevatorPlaceIDs: [id]))
    }

    func testAccessDecoderRejectsWrongKeysIdentityTypesBoundsAndDateOrder() throws {
        let id = "community-7398fe084d3d87eed23c", original = accessData()
        for key in original.keys {
            var data = original; data.removeValue(forKey: key)
            XCTAssertThrowsError(try RestroomAccessDetails.decode(id: id, data: data), "Missing \(key)")
        }
        var extra = original; extra["hours"] = "24/7"
        XCTAssertThrowsError(try RestroomAccessDetails.decode(id: id, data: extra))
        let bad: [(String, Any)] = [("schemaVersion", true), ("schemaVersion", 2), ("schemaVersion", 1.0),
            ("placeID", "another-place"), ("restroomHours", ""), ("restroomHours", String(repeating: "x", count: 161)),
            ("entranceLocation", "Use right\nside"), ("entranceStepFree", "Yes"), ("stairFreeRoute", true),
            ("elevatorToRestroom", "not-reported"), ("elevatorNote", String(repeating: "x", count: 301)),
            ("restroomFloor", String(repeating: "x", count: 81)), ("stairsAfterEntry", -1),
            ("stairsAfterEntry", 201), ("stairsAfterEntry", true), ("stairsAfterEntry", 0.0),
            ("sourceTitle", NSNull()), ("reportedAt", "2026-10-23"), ("reportedAt", Date(timeIntervalSince1970: .nan)),
            ("observedOn", Date(timeIntervalSince1970: 1_792_768_801)),
            ("updatedAt", Date(timeIntervalSince1970: 1_792_768_799)), ("limitations", "\u{7f}")]
        for (key, value) in bad {
            var data = original; data[key] = value
            XCTAssertThrowsError(try RestroomAccessDetails.decode(id: id, data: data), "Accepted invalid \(key): \(value)")
        }
        XCTAssertThrowsError(try RestroomAccessDetails.decode(id: "../place", data: original))
    }

    func testStairFreeAndElevatorEmptyClaimsWaitForAccessFeedAndFailuresWin() {
        for filters: Set<PlaceFilter> in [[.stairFree], [.elevator], [.accessible, .stairFree, .elevator]] {
            XCTAssertEqual(readiness(filters, accessDetailsLoading: true), .loading)
            XCTAssertEqual(readiness(filters, accessDetailsFailed: true), .unavailable)
            XCTAssertEqual(readiness(filters, accessDetailsLoading: true, accessDetailsFailed: true), .unavailable)
            XCTAssertEqual(readiness(filters), .ready)
        }
        for filters: Set<PlaceFilter> in [[], [.accessible], [.clean], [.public]] {
            XCTAssertEqual(readiness(filters, accessDetailsLoading: true, accessDetailsFailed: true), .ready)
        }
    }

    func testAccessDecoderRejectsContradictoryPositiveCompleteRouteEvidence() throws {
        let id = "community-7398fe084d3d87eed23c"
        var data = accessData(id)
        data["entranceStepFree"] = "no"
        XCTAssertThrowsError(try RestroomAccessDetails.decode(id: id, data: data))
        data = accessData(id); data["stairsAfterEntry"] = 1
        XCTAssertThrowsError(try RestroomAccessDetails.decode(id: id, data: data))
        data = accessData(id); data["entranceStepFree"] = "unknown"; data["stairsAfterEntry"] = NSNull()
        XCTAssertEqual(try RestroomAccessDetails.decode(id: id, data: data).stairFreeRoute, "yes")
        data = accessData(id); data["stairFreeRoute"] = "no"; data["entranceStepFree"] = "no"
        XCTAssertEqual(try RestroomAccessDetails.decode(id: id, data: data).stairsAfterEntry, 0)
    }
}
