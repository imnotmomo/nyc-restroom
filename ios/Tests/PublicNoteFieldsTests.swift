import Foundation
import XCTest
@testable import RestroomDirectory

final class PublicNoteFieldsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_792_800_000)

    private func fields(body: String = "", condition: String = "not-reported", soap: String = "not-reported",
                        toiletPaper: String = "not-reported", stairs: String = "not-reported",
                        observedAt: Date? = nil, validationTime: Date? = nil) throws -> PublicNoteFields {
        try PublicNoteFields(observedAt: observedAt ?? now.addingTimeInterval(-60), body: body,
            condition: condition, soap: soap, toiletPaper: toiletPaper, stairs: stairs, now: validationTime ?? now)
    }

    func testPublicTextTrimsOnlyBoundariesAndPreservesActualWords() throws {
        let note = try fields(body: " \n A quiet room.\nUse the right door. \t")
        XCTAssertEqual(note.body, "A quiet room.\nUse the right door.")
        XCTAssertEqual(note.condition, "not-reported")
        XCTAssertEqual(note.stairs, "not-reported")
    }

    func testEmptyOrWhitespaceOnlyAllUnknownNoteCannotBePublished() {
        for body in ["", " \t\n", "\u{2003}\n"] {
            XCTAssertThrowsError(try fields(body: body)) { error in
                XCTAssertEqual(error as? PublicNoteValidationError, .empty)
            }
        }
    }

    func testAnyExplicitPositiveOrNegativeObservationCanStandWithoutBody() throws {
        for note in [try fields(condition: "usable"), try fields(condition: "needs-attention"),
                     try fields(soap: "yes"), try fields(soap: "no"),
                     try fields(toiletPaper: "yes"), try fields(toiletPaper: "no"),
                     try fields(stairs: "yes"), try fields(stairs: "no")] {
            XCTAssertEqual(note.body, "")
        }
        let noStairs = try fields(stairs: "no")
        XCTAssertEqual(noStairs.stairs, "no")
        XCTAssertEqual(noStairs.condition, "not-reported")
        XCTAssertEqual(noStairs.soap, "not-reported")
        XCTAssertEqual(noStairs.toiletPaper, "not-reported")
    }

    func testOnlyExactKnownAnswersAreAccepted() {
        for operation in [
            { try self.fields(body: "Observed", condition: "clean") },
            { try self.fields(body: "Observed", soap: "Yes") },
            { try self.fields(body: "Observed", toiletPaper: "unknown") },
            { try self.fields(body: "Observed", stairs: "0") }
        ] {
            XCTAssertThrowsError(try operation()) { error in
                XCTAssertEqual(error as? PublicNoteValidationError, .answer)
            }
        }
    }

    func testVisitTimeMustBeFinitePastAndWithinSupportedRange() throws {
        for date in [Date(timeIntervalSince1970: 946_684_799), now.addingTimeInterval(1),
                     Date(timeIntervalSince1970: .nan), Date(timeIntervalSince1970: .infinity)] {
            XCTAssertThrowsError(try fields(body: "Observed", observedAt: date))
        }
        XCTAssertThrowsError(try fields(body: "Observed", validationTime: Date(timeIntervalSince1970: .nan)))
        XCTAssertThrowsError(try fields(body: "Observed", validationTime: Date(timeIntervalSince1970: .infinity)))
        XCTAssertNoThrow(try fields(body: "Observed", observedAt: Date(timeIntervalSince1970: 946_684_800)))
        XCTAssertNoThrow(try fields(body: "Observed", observedAt: now))
    }

    func testBodyLimitUsesUTF16AfterTrimming() throws {
        XCTAssertEqual(try fields(body: " \n" + String(repeating: "a", count: 1_000) + "\n ").body.utf16.count, 1_000)
        XCTAssertThrowsError(try fields(body: String(repeating: "a", count: 1_001)))
        XCTAssertEqual(try fields(body: String(repeating: "🚻", count: 500)).body.utf16.count, 1_000)
        XCTAssertThrowsError(try fields(body: String(repeating: "🚻", count: 501)))
    }

    func testUnsupportedControlsAreRejectedButLineBreaksAndTabsRemain() throws {
        XCTAssertThrowsError(try fields(body: "Room\u{0000}note"))
        XCTAssertThrowsError(try fields(body: "Room\u{007F}note"))
        XCTAssertEqual(try fields(body: "Room\n\tnote").body, "Room\n\tnote")
    }

    func testRetryMatchesOnlySameCanonicalContentAndVisitTime() throws {
        let original = try fields(body: "Observed", condition: "usable", soap: "no", stairs: "no")
        XCTAssertTrue(original.matches(try fields(body: " \nObserved\n ", condition: "usable", soap: "no", stairs: "no")))
        XCTAssertTrue(original.matches(try fields(body: "Observed", condition: "usable", soap: "no", stairs: "no",
            observedAt: original.observedAt.addingTimeInterval(0.0005))))
        XCTAssertFalse(original.matches(try fields(body: "Observed", condition: "usable", soap: "no", stairs: "no",
            observedAt: original.observedAt.addingTimeInterval(0.002))))
        for changed in [try fields(body: "Another observation", condition: "usable", soap: "no", stairs: "no"),
                        try fields(body: "Observed", condition: "needs-attention", soap: "no", stairs: "no"),
                        try fields(body: "Observed", condition: "usable", soap: "yes", stairs: "no"),
                        try fields(body: "Observed", condition: "usable", soap: "no", toiletPaper: "no", stairs: "no"),
                        try fields(body: "Observed", condition: "usable", soap: "no", stairs: "yes")] {
            XCTAssertFalse(original.matches(changed))
        }
    }
}
