import XCTest
@testable import RestroomDirectory

final class CodeEvidenceTests: XCTestCase {
    private func record(_ id: String, source: CodeEvidenceSource = .report, time: Double = 1,
                        used: Int? = 0, invalid: Int? = 0, visibility: String = "public",
                        ownership: CodeOwnership = .other, loaded: Bool = true, nanos: Int = 0,
                        verified: Double? = nil, verifiedNanos: Int? = nil, rawVersion: String? = nil) -> CodeEvidence {
        CodeEvidence(source: source, placeID: "place", reportID: id, code: "0012#", updatedAt: Date(timeIntervalSince1970: time),
            verifiedAt: verified.map(Date.init(timeIntervalSince1970:)), version: rawVersion ?? "\(Int64(time)):\(nanos)", visibility: visibility, ownership: ownership,
            positiveCount: used, invalidCount: invalid, currentFeedback: nil, feedbackLoaded: loaded,
            verifiedVersion: verified.flatMap { date in verifiedNanos.map { "\(Int64(date)):\($0)" } })
    }
    func testExactNanosecondsDetermineNewestWhenDisplayDatesAreIdentical() {
        let older = record("z", nanos: 1), newer = record("a", nanos: 2)
        XCTAssertEqual(older.updatedAt, newer.updatedAt)
        XCTAssertEqual(CodeEvidencePresentation.newestPublic(in: [older, newer]), newer)
        XCTAssertNil(CodeTimestampVersion("1:1000000000"))
        XCTAssertNil(CodeTimestampVersion("1:01"))
    }
    func testLatestVerificationOutranksNewerUnverifiedReport() {
        let verified = record("old", time: 1, verified: 10), pending = record("new", time: 20)
        XCTAssertEqual(CodeEvidencePresentation.newestPublic(in: [pending, verified]), verified)
        XCTAssertEqual(CodeEvidencePresentation.sorted([verified, record("checked-later", time: 0, verified: 11)]).first?.reportID, "checked-later")
    }
    func testEqualVerificationUsesExactReportedVersionThenID() {
        let old = record("z", time: 1, nanos: 1, verified: 10, verifiedNanos: 9)
        let newer = record("a", time: 1, nanos: 2, verified: 10, verifiedNanos: 9)
        XCTAssertEqual(CodeEvidencePresentation.sorted([old, newer]), [newer, old])
        XCTAssertEqual(CodeEvidencePresentation.sorted([record("a", verified: 10), record("z", verified: 10)]).first?.reportID, "z")
    }
    func testVerificationHasOneCanonicalExactKeyForMixedDateOnlyFixtures() {
        let dateOnly = record("middle", time: 5, verified: 1_000_000_000)
        let exactA = record("a", time: 10, verified: 1_000_000_000, verifiedNanos: 1)
        let exactB = record("b", time: 1, verified: 1_000_000_000, verifiedNanos: 2)
        let expected = [exactB, exactA, dateOnly]
        for input in [[dateOnly, exactA, exactB], [exactB, dateOnly, exactA], [exactA, exactB, dateOnly]] {
            XCTAssertEqual(CodeEvidencePresentation.sorted(input), expected)
        }
        var orphan = record("orphan", time: 99)
        orphan.verifiedVersion = "1000000001:0"
        XCTAssertEqual(CodeEvidencePresentation.newestPublic(in: [orphan, dateOnly]), dateOnly)
    }
    func testReportedFallbackUsesPerRecordCanonicalKeyForTotalOrdering() {
        let dateOnly = record("z", time: 1_000_000_000, rawVersion: "invalid")
        let exactA = record("a", time: 1_000_000_000, nanos: 1)
        let exactB = record("b", time: 1_000_000_000, nanos: 2)
        for input in [[dateOnly, exactA, exactB], [exactB, dateOnly, exactA], [exactA, exactB, dateOnly]] {
            XCTAssertEqual(CodeEvidencePresentation.sorted(input), [exactB, exactA, dateOnly])
        }
    }
    func testLegacyAndFeedbackVerificationUsesExactMaximumWithoutInventingOne() {
        XCTAssertEqual(CodeEvidencePresentation.latestVerificationVersion(legacy: "10:9", feedback: "10:8"), "10:9")
        XCTAssertEqual(CodeEvidencePresentation.latestVerificationVersion(legacy: "10:9", feedback: "11:0"), "11:0")
        XCTAssertEqual(CodeEvidencePresentation.latestVerificationVersion(legacy: nil, feedback: "11:1"), "11:1")
        XCTAssertNil(CodeEvidencePresentation.latestVerificationVersion(legacy: nil, feedback: nil))
        XCTAssertNil(CodeEvidencePresentation.latestVerificationVersion(legacy: "invalid", feedback: nil))
    }
    func testNewPendingReportRemainsReviewableDespiteOlderVerifiedConsensus() {
        let old = record("old", time: 1, used: 4, verified: 10)
        let pending = record("new", time: 20, used: 0)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [pending, old]), [old, pending])
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [old, record("new", time: 20, used: 3)]).count, 2)
    }
    func testNewestReportedConsensusKeepsPreferredMainAndNeverDropsItFromDetails() {
        let new = record("new", time: 20, used: 4, verified: 30)
        let old = record("old", time: 1, used: 1, verified: 10)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [old, new]), [new])
        let oldFreshCheck = record("old", time: 1, used: 1, verified: 40)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [oldFreshCheck, new]), [oldFreshCheck, new])
    }
    func testNewestPublicExcludesPrivateAndTiesAreDeterministic() {
        let legacy = record("same", source: .legacy), report = record("same")
        let own = record("private", time: 99, visibility: "private", ownership: .own)
        XCTAssertEqual(CodeEvidencePresentation.newestPublic(in: [legacy, own, report])?.id, "report:same")
        XCTAssertEqual(CodeEvidencePresentation.sorted([report, legacy]), CodeEvidencePresentation.sorted([legacy, report]))
        XCTAssertEqual(CodeEvidencePresentation.owned(in: [legacy, own]), [own])
    }
    func testHistoryRemainsThroughThreeAndIsOnlyHiddenAtFourCurrentPositiveVotes() {
        let older = record("old", time: 1, used: 9)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [older, record("new", time: 2, used: 3)]).count, 2)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [older, record("new", time: 2, used: 4)]).map(\.reportID), ["new"])
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [older, record("new", time: 2, used: 4)], feedsReady: false).count, 2)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [older, record("new", time: 2, used: 3, invalid: 1)]).count, 2)
    }
    func testUnknownOrInvalidEvidenceCannotRetireHistoryAndSameValuesStayDistinct() {
        let older = record("old"), newest = record("new", time: 2, used: nil, invalid: 100)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [older, newest]).count, 2)
        XCTAssertEqual(CodeEvidencePresentation.newestPublic(in: [older, newest]), newest)
        XCTAssertNotEqual(record("same", source: .legacy).id, record("same").id)
        XCTAssertEqual(CodeEvidenceSource.report.wireKind, "v2")
    }
    func testPositiveConsensusSurvivesUnknownLastUseDateAfterVoterDeletion() {
        let remaining = record("new", time: 2, used: 4)
        XCTAssertNil(remaining.verifiedAt)
        XCTAssertEqual(CodeEvidencePresentation.visiblePublic(in: [record("old"), remaining]), [remaining])
    }
    func testFeedbackRequiresPublicNonownerAndCompletedRead() {
        XCTAssertTrue(record("a").canGiveFeedback)
        XCTAssertTrue(record("a", used: nil, invalid: nil).canGiveFeedback) // stale version can receive a fresh vote
        XCTAssertFalse(record("a", ownership: .own).canGiveFeedback)
        XCTAssertFalse(record("a", ownership: .unknown).canGiveFeedback)
        XCTAssertFalse(record("a", loaded: false).canGiveFeedback)
        XCTAssertFalse(record("a", visibility: "private").canGiveFeedback)
    }
    func testExclusiveVoteTransitionsCountDistinctAccountsWithoutRepeatInflation() throws {
        let first = try CodeFeedbackCounts(used: 0, invalid: 0).applying(previous: nil, next: .used)
        XCTAssertEqual(first, try CodeFeedbackCounts(used: 1, invalid: 0))
        XCTAssertEqual(try first.applying(previous: .used, next: .used), first)
        let switched = try first.applying(previous: .used, next: .invalid)
        XCTAssertEqual(switched, try CodeFeedbackCounts(used: 0, invalid: 1))
        XCTAssertEqual(try switched.applying(previous: .invalid, next: .used), first)
        XCTAssertThrowsError(try CodeFeedbackCounts(used: 0, invalid: 0).applying(previous: .used, next: .invalid))
        XCTAssertThrowsError(try CodeFeedbackCounts(used: 1_000_001, invalid: 0))
    }
    func testCodesPreserveLeadingZerosSymbolsAndOnlyTrimBoundarySpaces() throws {
        XCTAssertEqual(try CodeReportFields(code: " 0012 # ", visibility: "private").code, "0012 #")
        for code in ["", "   ", "12\n", "é", String(repeating: "x", count: 41)] {
            XCTAssertThrowsError(try CodeReportFields(code: code, visibility: "public"))
        }
        XCTAssertThrowsError(try CodeReportFields(code: "1234", visibility: "all"))
    }
}
