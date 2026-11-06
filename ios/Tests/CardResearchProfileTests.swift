import XCTest
@testable import RestroomDirectory

final class CardResearchProfileTests: XCTestCase {
    private let place = "i7jb-7jku:row-test"
    private let source = String(repeating: "a", count: 20)
    private let fact = String(repeating: "b", count: 20)
    private let comment = String(repeating: "c", count: 20)

    private func fixture() -> [String: Any] {
        ["schemaVersion": 1, "placeID": place, "manifestSHA256": String(repeating: "d", count: 64), "generatedAt": "2026-10-24T05:00:00Z",
         "sources": [["id": source, "label": "NYC Parks", "title": "Room inspection", "url": "https://data.cityofnewyork.us/resource/yp6n-7jdy",
             "kind": "inspection", "publishedOn": NSNull(), "displayedDate": "Inspection July 27", "observedOn": "2026-07-27",
             "retrievedAt": "2026-10-24T04:00:00.123456Z", "limitations": "Past inspection, not current conditions."]],
         "facts": [["id": fact, "field": "inspectionFixtureCount", "label": "Soap dispensers", "value": "0", "scope": "restroom", "sourceID": source, "section": "amenities", "context": "Men's room"]],
         "comments": [], "coveredCommentIDs": [source]]
    }

    private func decode(_ row: [String: Any]) throws -> CardResearchProfile {
        try CardResearchProfile.decode(id: place, data: row, now: Date(timeIntervalSince1970: 1_792_886_400))
    }

    func testDatedRoomCountPreservesZeroContextAndPublicationUnknown() throws {
        let profile = try decode(fixture())
        XCTAssertEqual(profile.facts[0].value, "0")
        XCTAssertEqual(profile.facts[0].displayValue, "Men's room: 0")
        XCTAssertTrue(profile.sources[0].caption.contains("Inspected Jul 27, 2026"))
        XCTAssertNil(profile.sources[0].publishedOn)
        XCTAssertEqual(profile.facts(in: "amenities").count, 1)
        XCTAssertTrue(profile.coveredCommentIDs.contains(source))
        XCTAssertTrue(profile.codeClaims.isEmpty)
    }

    func testExactSchemaForeignIdentityDuplicatesAndReferencesFailClosed() throws {
        var row = fixture(); row["authorUID"] = "must-not-publish"; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["placeID"] = "another-place"; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["schemaVersion"] = true; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["schemaVersion"] = 1.0; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["coveredCommentIDs"] = [comment, comment]; XCTAssertThrowsError(try decode(row))
        row = fixture(); var facts = row["facts"] as! [[String: Any]]; facts[0]["sourceID"] = String(repeating: "e", count: 20); row["facts"] = facts; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["facts"] = Array(repeating: (row["facts"] as! [[String: Any]])[0], count: 129); XCTAssertThrowsError(try decode(row))
    }

    func testUnsafeLinksUnknownEnumsAndInventedDatesAreRejected() throws {
        for url in ["http://example.org", "https://user:secret@example.org", "https://host.local/", "https://127.1/", "https://example.org/?API_KEY=secret"] {
            var row = fixture(); var sources = row["sources"] as! [[String: Any]]; sources[0]["url"] = url; row["sources"] = sources
            XCTAssertThrowsError(try decode(row), url)
        }
        for date in ["2026-02-30", "2027-01-01", "July 27"] {
            var row = fixture(); var sources = row["sources"] as! [[String: Any]]; sources[0]["observedOn"] = date; row["sources"] = sources
            XCTAssertThrowsError(try decode(row))
        }
        var row = fixture(); var facts = row["facts"] as! [[String: Any]]; facts[0]["scope"] = "current-guarantee"; row["facts"] = facts
        XCTAssertThrowsError(try decode(row))
    }

    func testPublishedDatesAndUnknownDatesNeverUseRetrievalOrCompilation() throws {
        var row = fixture(); var sources = row["sources"] as! [[String: Any]]
        sources[0]["kind"] = "social-comment"; sources[0]["observedOn"] = NSNull(); sources[0]["publishedOn"] = "2026-05-13"; row["sources"] = sources
        XCTAssertEqual(try decode(row).sources[0].caption, "From NYC Parks · Published May 13, 2026")
        sources[0]["publishedOn"] = NSNull(); row["sources"] = sources
        XCTAssertEqual(try decode(row).sources[0].caption, "From NYC Parks · Date not shown")
    }

    func testCodeClaimsPreserveLeadingZeroWithoutVoteOrOwnershipData() throws {
        var row = fixture(); var facts = row["facts"] as! [[String: Any]]
        facts[0]["field"] = "passcode"; facts[0]["section"] = "passcodes"; facts[0]["value"] = "0225"; facts[0]["context"] = ""; row["facts"] = facts
        let decoded = try decode(row)
        XCTAssertEqual(decoded.codeClaims.first?.value, "0225")
        XCTAssertEqual(decoded.codeClaims.first?.displayValue, "0225")
        XCTAssertEqual(decoded.facts(in: "ratings").count, 0)
        facts[0]["usedCount"] = 4; row["facts"] = facts; XCTAssertThrowsError(try decode(row))
    }

    func testSeasonalityRemainsASeparateDetailAndNeverBecomesASchedule() throws {
        var row = fixture(); var facts = row["facts"] as! [[String: Any]]
        facts[0]["field"] = "seasonality"; facts[0]["section"] = "hours"; facts[0]["value"] = "Year Round"; row["facts"] = facts
        let profile = try decode(row)
        XCTAssertTrue(profile.scheduleFacts.isEmpty)
        XCTAssertEqual(profile.facts(in: "hours").first?.value, "Year Round")
        facts[0]["field"] = "hours"; facts[0]["value"] = "Open by permit"; row["facts"] = facts
        XCTAssertEqual(try decode(row).scheduleFacts.first?.value, "Open by permit")
    }

    func testEquivalentUTCFractionsAndEmptyOptionalDisplayText() throws {
        var row = fixture(); row["generatedAt"] = "2026-10-24T05:00:00.000Z"
        var sources = row["sources"] as! [[String: Any]]; sources[0]["retrievedAt"] = "2026-10-24T05:00:00Z"; sources[0]["displayedDate"] = ""; row["sources"] = sources
        XCTAssertNoThrow(try decode(row))
    }

    func testDatasetMetadataCannotBecomePublicationDate() throws {
        for kind in ["inspection", "official-dataset"] {
            var row = fixture(); var sources = row["sources"] as! [[String: Any]]
            sources[0]["kind"] = kind; sources[0]["publishedOn"] = "2026-07-27"; row["sources"] = sources
            XCTAssertThrowsError(try decode(row))
        }
    }

    func testFieldSectionsScopesCommentKindsAndControlCharactersStayStrict() throws {
        var row = fixture(); var facts = row["facts"] as! [[String: Any]]
        facts[0]["section"] = "ratings"; row["facts"] = facts; XCTAssertThrowsError(try decode(row))
        row = fixture(); facts = row["facts"] as! [[String: Any]]
        facts[0]["field"] = "buildingAccessibility"; row["facts"] = facts; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["comments"] = [["id": comment, "text": "A comment", "sourceID": source]]
        XCTAssertThrowsError(try decode(row), "An inspection is not a visitor comment")
        row = fixture(); row["coveredCommentIDs"] = [comment]; XCTAssertThrowsError(try decode(row))
        row = fixture(); var sources = row["sources"] as! [[String: Any]]
        sources[0]["observedOn"] = NSNull(); row["sources"] = sources; XCTAssertThrowsError(try decode(row))
        row = fixture(); sources = row["sources"] as! [[String: Any]]
        sources[0]["label"] = "Unsafe\u{0085}label"; row["sources"] = sources; XCTAssertThrowsError(try decode(row))
        row = fixture(); row["generatedAt"] = "2026-02-30T05:00:00Z"; XCTAssertThrowsError(try decode(row))
    }

    func testEmptyAndOversizedProfilesFailClosed() throws {
        var row = fixture(); row["sources"] = []; row["facts"] = []; row["coveredCommentIDs"] = []
        XCTAssertThrowsError(try decode(row))
        row = fixture(); row["facts"] = []; XCTAssertThrowsError(try decode(row))
        row = fixture(); let original = (row["facts"] as! [[String: Any]])[0]
        row["facts"] = (1...128).map { index -> [String: Any] in
            var fact = original; fact["id"] = String(format: "%020x", index); fact["value"] = String(repeating: "x", count: 3_000); return fact
        }
        XCTAssertThrowsError(try decode(row), "Individually bounded rows cannot exceed the document budget")
    }

    func testRoomGradesKeepIssuesAndYieldToNewerVisitorObservation() throws {
        var row = fixture()
        let base = (row["facts"] as! [[String: Any]])[0]
        func fact(_ id: String, _ field: String, _ value: String, _ context: String) -> [String: Any] {
            var result = base; result["id"] = String(repeating: id, count: 20); result["field"] = field
            result["value"] = value; result["section"] = "conditions"; result["context"] = context; return result
        }
        row["facts"] = [fact("1", "inspectionRating", "A", "Men's room"), fact("2", "inspectionRating", "U", "Women's room"), fact("3", "inspectionIssue", "Sink out of service", "Men's room")]
        let profile = try decode(row)
        XCTAssertEqual(profile.conditionSummary(visitorDay: nil)?.value, "Men's room: Acceptable · Women's room: Unacceptable · 1 issue reported")
        XCTAssertEqual(profile.conditionSummary(visitorDay: "2026-07-27")?.sourceID, source)
        XCTAssertNil(profile.conditionSummary(visitorDay: "2026-07-28"))
        XCTAssertFalse(profile.conditionSummary(visitorDay: nil)!.value.contains("star"))
    }

    func testExplicitClosureRemainsVisibleBesideDatedSourceRatherThanOldOperationalListing() throws {
        var row = fixture(); let base = (row["facts"] as! [[String: Any]])[0]
        var operational = base; operational["field"] = "publishedStatus"; operational["value"] = "Operational"; operational["section"] = "conditions"; operational["context"] = ""
        var closure = operational; closure["id"] = String(repeating: "e", count: 20); closure["field"] = "closure"; closure["value"] = "Library closed for renovations."
        row["facts"] = [operational, closure]
        let profile = try decode(row)
        XCTAssertEqual(profile.conditionSummary(visitorDay: "2026-10-23")?.value, "Closure reported: Library closed for renovations.")
        XCTAssertEqual(profile.sources[0].caption, "From NYC Parks · Inspected Jul 27, 2026")
        closure["value"] = "No"; row["facts"] = [operational, closure]
        XCTAssertEqual(try decode(row).conditionSummary(visitorDay: nil)?.value, "Listed Operational")
    }

    func testEveryActualCuratedProfileDecodesWithoutLosingOriginalFactsOrDateKinds() throws {
        let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let url = repository.appendingPathComponent("data/research-map-2026-10-24/public-card-profiles.json")
        let packet = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let rows = try XCTUnwrap(packet["profiles"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 1_146)
        var factCount = 0, commentCount = 0, coveredCount = 0
        for row in rows {
            let id = try XCTUnwrap(row["placeID"] as? String)
            let profile = try CardResearchProfile.decode(id: id, data: row, now: Date(timeIntervalSince1970: 1_792_886_400))
            XCTAssertEqual(profile.facts.count, (row["facts"] as! [[String: Any]]).count, id)
            XCTAssertEqual(profile.sources.count, (row["sources"] as! [[String: Any]]).count, id)
            for source in profile.sources where ["official-dataset", "inspection"].contains(source.kind) { XCTAssertNil(source.publishedOn, id) }
            factCount += profile.facts.count; commentCount += profile.comments.count; coveredCount += profile.coveredCommentIDs.count
        }
        XCTAssertEqual(factCount, 31_959)
        XCTAssertEqual(commentCount, 9)
        XCTAssertEqual(coveredCount, 863)
    }
}
