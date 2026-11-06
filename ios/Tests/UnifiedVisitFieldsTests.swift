import Foundation
import XCTest
@testable import RestroomDirectory

final class UnifiedVisitFieldsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_792_800_000)
    private func fields(comment: String = "Observed a usable room.", anonymous: Bool = true,
                        authorName: String? = nil, entry: String = "not-reported", code: String = "not-reported",
                        stairs: String = "not-reported", observed: Date? = nil, validationTime: Date? = nil) throws -> UnifiedVisitFields {
        try UnifiedVisitFields(observedAt: observed ?? now.addingTimeInterval(-60), entryRule: entry,
            purchaseRequired: "not-reported", codeRequired: code, stairs: stairs, soap: "not-reported",
            toiletPaper: "not-reported", floor: "not-reported", condition: "not-reported", comment: comment,
            anonymous: anonymous, authorName: authorName, now: validationTime ?? now)
    }
    func testCommentOnlyAndObservedDetailOnlyAreAllowedWithoutInventingUnknownFacts() throws {
        let note = try fields(comment: " \nUse the right door.\nRoom is upstairs. \t")
        XCTAssertEqual(note.comment, "Use the right door.\nRoom is upstairs.")
        XCTAssertEqual(note.stairs, "not-reported"); XCTAssertEqual(note.codeRequired, "not-reported")
        XCTAssertTrue(note.anonymous); XCTAssertNil(note.authorName)
        XCTAssertNoThrow(try fields(comment: "", entry: "public"))
        XCTAssertNoThrow(try fields(comment: "", code: "yes"))
        XCTAssertNoThrow(try fields(comment: "", stairs: "no"))
    }
    func testNoCommentAndAllUnknownIsNotAVisitObservation() {
        for comment in ["", " \n\t", "\u{0085}", "\u{2003}"] { XCTAssertThrowsError(try fields(comment: comment)) }
    }
    func testPublicNameRequiresExplicitNamedModeAndSafeNameWithoutRewritingIt() throws {
        XCTAssertThrowsError(try fields(authorName: "Example Visitor"))
        XCTAssertThrowsError(try fields(anonymous: false))
        for name in ["", " \n", "\u{0085}", "a\nname", "a\u{7f}name", String(repeating: "x", count: 121)] {
            XCTAssertFalse(UnifiedVisitFields.validAuthorName(name)); XCTAssertThrowsError(try fields(anonymous: false, authorName: name))
        }
        let named = try fields(anonymous: false, authorName: " Example Visitor ")
        XCTAssertEqual(named.authorName, " Example Visitor ")
        XCTAssertNoThrow(try fields(anonymous: false, authorName: String(repeating: "x", count: 120)))
        XCTAssertNoThrow(try fields(anonymous: false, authorName: "Zoë 陳"))
    }
    func testCommentControlAndUTF16Limits() throws {
        XCTAssertNoThrow(try fields(comment: String(repeating: "🚻", count: 500)))
        XCTAssertThrowsError(try fields(comment: String(repeating: "🚻", count: 501)))
        XCTAssertThrowsError(try fields(comment: String(repeating: "x", count: 1001)))
        for scalar in [0,1,8,11,12,14,31,127] { XCTAssertThrowsError(try fields(comment: "before\(UnicodeScalar(scalar)!)after")) }
        XCTAssertNoThrow(try fields(comment: "One\ttwo\nthree\rfour"))
    }
    func testDatesAreActualFinitePastVisits() {
        for observed in [now.addingTimeInterval(1), Date(timeIntervalSince1970: 946_684_799),
                         Date(timeIntervalSince1970: .nan), Date(timeIntervalSince1970: .infinity)] {
            XCTAssertThrowsError(try fields(observed: observed))
        }
        XCTAssertThrowsError(try fields(validationTime: Date(timeIntervalSince1970: .nan)))
        XCTAssertNoThrow(try fields(observed: now))
    }
    func testOnlyExactListedEnumsAreAccepted() {
        XCTAssertThrowsError(try fields(entry: "free")); XCTAssertThrowsError(try fields(code: "Yes"))
        XCTAssertThrowsError(try fields(stairs: "unknown"))
    }

    func testAmenityOnlyNotesKeepNegativeAndUnknownAnswersDistinct() throws {
        func amenity(_ elevator: String = "not-reported", _ door: String = "not-reported") throws -> UnifiedVisitFields {
            try UnifiedVisitFields(observedAt: now.addingTimeInterval(-60), entryRule: "not-reported",
                purchaseRequired: "not-reported", codeRequired: "not-reported", stairs: "not-reported",
                soap: "not-reported", toiletPaper: "not-reported", floor: "not-reported", condition: "not-reported",
                elevatorPresent: elevator, automaticDoorPresent: door, comment: "", anonymous: true, authorName: nil, now: now)
        }
        let elevator = try amenity("yes")
        XCTAssertEqual(elevator.elevatorPresent, "yes"); XCTAssertEqual(elevator.automaticDoorPresent, "not-reported")
        XCTAssertEqual(elevator.stairs, "not-reported")
        XCTAssertEqual(elevator.observationSummary, "Visit details: Elevator present: Yes")
        XCTAssertEqual(try amenity("not-reported", "no").observationSummary, "Visit details: Automatic door present: No")
        XCTAssertThrowsError(try amenity())
        for invalid in ["unknown", "Yes", "", "true"] {
            XCTAssertThrowsError(try amenity(invalid)); XCTAssertThrowsError(try amenity("yes", invalid))
        }
    }

    func testOldInitializerStillDefaultsAmenityObservationsToUnknown() throws {
        let old = try fields()
        XCTAssertEqual(old.elevatorPresent, "not-reported")
        XCTAssertEqual(old.automaticDoorPresent, "not-reported")
        XCTAssertFalse(old.observationSummary.contains("Elevator"))
        XCTAssertFalse(old.observationSummary.contains("Automatic door"))
    }
}
