import XCTest
@testable import RestroomDirectory

final class PublicTextSafetyTests: XCTestCase {
    func testOrdinaryRestroomDescriptionsAreNotSubstringBlocked() {
        for text in ["Accessible assistance is available.", "A class visited this restroom.", "Cockroaches were reported.",
                     "The elevator was broken.", "Ask staff to open the automatic door.", "", "Soap and toilet paper present."] {
            XCTAssertTrue(PublicTextSafety.allows(text), text)
        }
    }

    func testThreatsAndAbusiveWholeTokensAreBlockedCaseInsensitively() {
        for text in ["go die", "Go\tdie!", "K1LL yourself", "fuck", "FUCKING", "motherfucker", "rape you", "child porn"] {
            XCTAssertFalse(PublicTextSafety.allows(text), text)
        }
    }

    func testPublicationFilteringDoesNotBreakLegacyReadingOrRemoval() throws {
        let now = Date(timeIntervalSince1970: 1_790_000_000)
        XCTAssertThrowsError(try PublicTextSafety.validateForPublication("go die")) {
            XCTAssertTrue($0 is PublicTextSafetyError)
        }
        // Stored old content still decodes for owner cleanup and reporting;
        // the draft/store publication path invokes validateForPublication.
        XCTAssertNoThrow(try PublicNoteFields(observedAt: now, body: "go die", condition: "not-reported",
            soap: "not-reported", toiletPaper: "not-reported", stairs: "not-reported", now: now))
    }

    func testOnlyPublicCodeSharingUsesTheTextFilter() {
        XCTAssertTrue(PublicTextSafety.allowsCodeSharing("3434#", visibility: "public"))
        XCTAssertTrue(PublicTextSafety.allowsCodeSharing("fuck", visibility: "private"))
        XCTAssertFalse(PublicTextSafety.allowsCodeSharing("fuck", visibility: "public"))
        XCTAssertFalse(PublicTextSafety.allowsCodeSharing("3434#", visibility: "unknown"))
    }
}
