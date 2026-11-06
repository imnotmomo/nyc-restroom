import XCTest
@testable import RestroomDirectory

final class RestroomSubmissionRequestTests: XCTestCase {
    private let submitted = Date(timeIntervalSince1970: 1_790_000_000)
    private var reviewed: Date { submitted.addingTimeInterval(60) }

    func testPendingRequiresInitialRevisionAndNoDecisionMetadata() throws {
        let value = try RestroomSubmissionState(schemaVersion: 1, status: "pending", revision: 1,
            submittedAt: submitted, reviewedAt: nil, reason: nil)
        XCTAssertEqual(value.status, .pending)
        XCTAssertEqual(value.status.title, "Awaiting approval")
        XCTAssertThrowsError(try RestroomSubmissionState(schemaVersion: 1, status: "pending", revision: 2,
            submittedAt: submitted, reviewedAt: nil, reason: nil))
        XCTAssertThrowsError(try RestroomSubmissionState(schemaVersion: 1, status: "pending", revision: 1,
            submittedAt: submitted, reviewedAt: reviewed, reason: nil))
        XCTAssertThrowsError(try RestroomSubmissionState(schemaVersion: 1, status: "pending", revision: 1,
            submittedAt: submitted, reviewedAt: nil, reason: ""))
    }

    func testTerminalStatesRequireRevisionTwoAndOriginalTimeOrder() throws {
        let approved = try RestroomSubmissionState(schemaVersion: 1, status: "approved", revision: 2,
            submittedAt: submitted, reviewedAt: reviewed, reason: "")
        XCTAssertNil(approved.reason)
        for reason in RestroomSubmissionReason.allCases {
            let denied = try RestroomSubmissionState(schemaVersion: 1, status: "denied", revision: 2,
                submittedAt: submitted, reviewedAt: reviewed, reason: reason.rawValue)
            XCTAssertEqual(denied.reason, reason)
        }
        for (status, revision, date, reason) in [
            ("approved", 1, reviewed, ""), ("approved", 2, submitted.addingTimeInterval(-1), ""),
            ("approved", 2, reviewed, "other"), ("denied", 2, reviewed, ""),
            ("denied", 2, reviewed, "free text must not be accepted")
        ] {
            XCTAssertThrowsError(try RestroomSubmissionState(schemaVersion: 1, status: status, revision: revision,
                submittedAt: submitted, reviewedAt: date, reason: reason))
        }
    }

    func testUnknownVersionStatusAndMissingReviewDateFailClosed() {
        for (version, status) in [(2, "pending"), (1, "published"), (1, "Pending")] {
            XCTAssertThrowsError(try RestroomSubmissionState(schemaVersion: version, status: status, revision: 1,
                submittedAt: submitted, reviewedAt: nil, reason: nil))
        }
        XCTAssertThrowsError(try RestroomSubmissionState(schemaVersion: 1, status: "approved", revision: 2,
            submittedAt: submitted, reviewedAt: nil, reason: ""))
    }

    func testCodeCommitmentIsVisibilityBoundAndDeterministic() throws {
        let a = try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "EXAMPLE-1", visibility: "private")
        // Fixed UTF-8/NUL vector independently calculated with Python hashlib.
        XCTAssertEqual(a, "4a90945b5b96bbf04c8845d4602e31de2ace560d725532ccd849e5271706e5d0")
        XCTAssertEqual(try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "3434", visibility: "private"),
                       "23c35eb763da936366b6efeefa0577de853356f1ef008cb779d8e6e8ecee95ad")
        XCTAssertEqual(a, try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "EXAMPLE-1", visibility: "private"))
        XCTAssertNotEqual(a, try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "EXAMPLE-1", visibility: "public"))
        XCTAssertNotEqual(a, try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "EXAMPLE-2", visibility: "private"))
        XCTAssertTrue(RestroomSubmissionCodeCommitment.valid(a))
        XCTAssertFalse(RestroomSubmissionCodeCommitment.valid(a.uppercased()))
    }

    func testCommitmentRejectsUnnormalizedOrInvalidCodeInputs() {
        for code in ["", " EXAMPLE-1", "EXAMPLE-1 ", "EXAMPLE\n1", "\tEXAMPLE-1", "é", String(repeating: "A", count: 41)] {
            XCTAssertThrowsError(try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: code, visibility: "private"))
        }
        XCTAssertThrowsError(try RestroomSubmissionCodeCommitment.fingerprint(normalizedCode: "EXAMPLE-1", visibility: "everyone"))
    }

    func testRequestConfirmationDoesNotClaimPublication() {
        XCTAssertTrue(RestroomSubmissionStatus.pending.confirmationMessage.contains("after moderator approval"))
        XCTAssertNotEqual(NativeAnalyticsEvent.mutationSucceeded(.submitRestroomRequest).payload.name,
                          NativeAnalyticsEvent.mutationSucceeded(.submitCodeReport).payload.name)
        XCTAssertEqual(NativeAnalyticsEvent.mutationSucceeded(.submitRestroomRequest).payload.parameters, ["event_schema": "1"])
    }
}
