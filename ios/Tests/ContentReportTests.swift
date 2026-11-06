import XCTest
@testable import RestroomDirectory

final class ContentReportTests: XCTestCase {
    private let place = "i7jb-7jku:row-ahsi-k4c4-scek"
    private let record = "AbCdEfGhIjKlMnOpQrSt"
    private let action = "12345678-1234-4123-8123-123456789abc"
    private let posted = "1790000000:123456789"

    func testAuthoredTargetPinsExactNanosecondsAndSendsOnlyPrivateReference() throws {
        for kind in [ContentReportKind.publicNote, .unifiedVisit, .legacyCode, .codeReport] {
            let target = try ContentReportTarget(kind: kind, placeID: place, recordID: record, postedAt: posted)
            let attempt = try ContentReportAttempt(target: target, reason: .harassment, actionID: action)
            let data = try attempt.encodedBody()
            let value = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
            XCTAssertEqual(Set(value.keys), ["kind", "placeID", "recordID", "postedAt", "reason", "actionId"])
            XCTAssertEqual(value["postedAt"], posted)
            XCTAssertEqual(value["kind"], kind.rawValue)
            XCTAssertEqual(data, try attempt.encodedBody())
            XCTAssertNil(value["body"]); XCTAssertNil(value["authorUID"]); XCTAssertNil(value["sourceURL"])
        }
    }

    func testImportedTargetHashesExactUTF8TextWithoutSendingTextOrPostDate() throws {
        let target = try ContentReportTarget.imported(kind: .researchComment, placeID: place,
                                                     recordID: "review:comment-1", text: "Hello")
        XCTAssertEqual(target.contentHash, "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969")
        let attempt = try ContentReportAttempt(target: target, reason: .personalInformation, actionID: action)
        let value = try XCTUnwrap(JSONSerialization.jsonObject(with: attempt.encodedBody()) as? [String: String])
        XCTAssertEqual(Set(value.keys), ["kind", "placeID", "recordID", "contentHash", "reason", "actionId"])
        XCTAssertFalse(String(decoding: try attempt.encodedBody(), as: UTF8.self).contains("Hello"))
        let composed = try ContentReportTarget.imported(kind: .sourceComment, placeID: place, recordID: "external-1", text: "é")
        let decomposed = try ContentReportTarget.imported(kind: .sourceComment, placeID: place, recordID: "external-1", text: "e\u{301}")
        XCTAssertNotEqual(composed.contentHash, decomposed.contentHash, "The pin must match the exact server UTF-8 text, not normalize it.")
    }

    func testTargetRejectsPathTraversalTimestampCoercionAndMixedPins() throws {
        for invalid in ["", "../users", "community-wrong", String(repeating: "A", count: 129), "venue?secret=1"] {
            XCTAssertThrowsError(try ContentReportTarget(kind: .publicNote, placeID: invalid, recordID: record, postedAt: posted))
        }
        for invalid in ["0123:0", "1790000000:1000000000", "1790000000:-1", "1790000000:01", "1790000000.1:0", "12:0"] {
            XCTAssertThrowsError(try ContentReportTarget(kind: .publicNote, placeID: place, recordID: record, postedAt: invalid))
        }
        XCTAssertThrowsError(try ContentReportTarget(kind: .publicNote, placeID: place, recordID: record, postedAt: posted,
                                                    contentHash: String(repeating: "a", count: 64)))
        XCTAssertThrowsError(try ContentReportTarget(kind: .sourceComment, placeID: place, recordID: "x", postedAt: posted,
                                                    contentHash: String(repeating: "a", count: 64)))
        XCTAssertThrowsError(try ContentReportTarget(kind: .researchComment, placeID: place, recordID: "../comment",
                                                    contentHash: String(repeating: "a", count: 64)))
    }

    func testConfirmationRequiresThisExactAttemptAndBoundedSuccessSchema() throws {
        let target = try ContentReportTarget(kind: .publicNote, placeID: place, recordID: record, postedAt: posted)
        let attempt = try ContentReportAttempt(target: target, reason: .spam, actionID: action)
        let correct = try JSONSerialization.data(withJSONObject: ["status": "received", "reportID": action])
        XCTAssertNoThrow(try attempt.confirm(httpStatus: 200, data: correct))
        for value in [
            ["status": "received", "reportID": "87654321-1234-4123-8123-123456789abc"],
            ["status": "sent", "reportID": action],
            ["status": "received", "reportID": action, "authorUID": "must-not-be-returned"]
        ] {
            XCTAssertThrowsError(try attempt.confirm(httpStatus: 200, data: JSONSerialization.data(withJSONObject: value)))
        }
        XCTAssertThrowsError(try attempt.confirm(httpStatus: 202, data: correct))
        XCTAssertThrowsError(try attempt.confirm(httpStatus: 200, data: Data(repeating: 32, count: 4097)))
        XCTAssertThrowsError(try ContentReportAttempt(target: target, reason: .spam, actionID: "not-a-stable-uuid"))
    }

    func testFailuresHaveAllowlistedMessagesAndKeepOriginalAttempt() throws {
        let target = try ContentReportTarget(kind: .unifiedVisit, placeID: place, recordID: record, postedAt: posted)
        let attempt = try ContentReportAttempt(target: target, reason: .misleading, actionID: action)
        let original = try attempt.encodedBody()
        let cases: [(Int, String, ContentReportError)] = [
            (401, "authentication_required", .authenticationRequired),
            (403, "contribution_suspended", .suspended), (404, "not_found", .outdated),
            (409, "stale_revision", .outdated), (409, "action_conflict", .conflict),
            (429, "rate_limited", .rateLimited), (503, "moderation_unavailable", .unavailable),
            (503, "secret-user-content", .notConfirmed)
        ]
        for (status, code, expected) in cases {
            XCTAssertThrowsError(try attempt.confirm(httpStatus: status, data: JSONSerialization.data(withJSONObject: ["error": code]))) {
                XCTAssertEqual($0 as? ContentReportError, expected)
                XCTAssertFalse($0.localizedDescription.contains("secret-user-content"))
            }
            XCTAssertEqual(original, try attempt.encodedBody())
        }
    }

    func testReportAnalyticsContainsOnlyPredefinedActionAndScreenLabels() {
        XCTAssertEqual(NativeAnalyticsEvent.mutationSucceeded(.reportContent).payload,
                       NativeAnalyticsPayload(name: "content_report_submit", parameters: ["event_schema": "1"]))
        XCTAssertEqual(NativeAnalyticsEvent.screen(.contentReport).payload.parameters,
                       ["event_schema": "1", "screen_name": "content_report", "screen_class": "ContentReportForm"])
    }

    func testContributionStatusCannotTreatUnknownOrExtraIdentityFieldsAsAllowed() throws {
        XCTAssertEqual(try PublicContributionStatus.decode(Data("{\"status\":\"allowed\"}".utf8)), .allowed)
        XCTAssertEqual(try PublicContributionStatus.decode(Data("{\"status\":\"suspended\"}".utf8)), .suspended)
        for raw in ["{}", "{\"status\":\"unknown\"}", "{\"status\":true}", "{\"status\":\"allowed\",\"uid\":\"private\"}"] {
            XCTAssertThrowsError(try PublicContributionStatus.decode(Data(raw.utf8)))
        }
    }
}
