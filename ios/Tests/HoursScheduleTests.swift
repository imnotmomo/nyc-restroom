import Foundation
import XCTest
@testable import RestroomDirectory

final class HoursScheduleTests: XCTestCase {
    private let raw = "Sunday: Closed \nMonday: 10:00 am - 6:00 pm \nTuesday: 1:00 pm - 8:00 pm\nWednesday: 10:00 am - 6:00 pm\nThursday: 12:00 pm - 8:00 pm\nFriday: 10:00 am - 6:00 pm\nSaturday: 10:00 am - 5:00 pm"
    private let id = "community-ABCDEFGHIJKLMNOPQRST"
    private func date(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }
    private func place() -> Place { Place(id: id, name: "Reported venue", latitude: 40.75, longitude: -73.99, locationType: "Other") }
    private func profile(_ facts: [(String, String, String)], foreign: Bool = false) -> CardResearchProfile {
        CardResearchProfile(placeID: foreign ? "other-place" : id, manifestSHA256: String(repeating: "a", count: 64),
            generatedAt: "2026-11-05T12:00:00Z", sources: [], facts: facts.enumerated().map { offset, fact in
                .init(id: String(format: "%020x", offset), field: fact.0, label: "Reported hours", value: fact.2,
                      scope: fact.1, sourceID: String(repeating: "b", count: 20), section: "hours", context: "")
            }, comments: [], coveredCommentIDs: [])
    }
    private func accessDetails(hours: String?) -> RestroomAccessDetails {
        let stamp = date("2026-11-05T12:00:00Z")
        return .init(placeID: id, restroomHours: hours, entranceLocation: nil, entranceStepFree: "unknown", stairFreeRoute: "unknown",
            elevatorToRestroom: "unknown", elevatorNote: nil, restroomFloor: nil, stairsAfterEntry: nil,
            sourceTitle: "Reported access details", reportedAt: stamp, observedOn: nil, updatedAt: stamp, limitations: "Dated report")
    }

    func testFullScheduleKeepsVerbatimTimeValuesAndShowsOnlyTheNewYorkDay() throws {
        let schedule = try XCTUnwrap(HoursSchedule.parse(raw))
        XCTAssertEqual(schedule.raw, raw)
        XCTAssertEqual(schedule.hours(on: .tuesday), "1:00 pm - 8:00 pm")
        XCTAssertEqual(schedule.overview(at: date("2026-11-06T02:30:00Z")), "Today: 12:00 pm - 8:00 pm")
        XCTAssertEqual(schedule.fullWeeklyText.components(separatedBy: "\n").count, 7)
        XCTAssertTrue(schedule.fullWeeklyText.hasPrefix("Monday: 10:00 am - 6:00 pm"))
        XCTAssertTrue(schedule.fullWeeklyText.hasSuffix("Sunday: Closed"))
        XCTAssertFalse(schedule.overview(at: date("2026-11-06T02:30:00Z")).contains("\n"))
    }

    func testNewYorkMidnightChangesTodayIndependentlyOfUTCDay() throws {
        let schedule = try XCTUnwrap(HoursSchedule.parse(raw))
        XCTAssertEqual(schedule.overview(at: date("2026-11-02T04:59:59Z")), "Today: Closed")
        XCTAssertEqual(schedule.overview(at: date("2026-11-02T05:00:00Z")), "Today: 10:00 am - 6:00 pm")
        XCTAssertEqual(schedule.raw, raw)
    }

    func testSpringAndFallDSTUseTheSameReportedLocalWeekday() throws {
        let schedule = try XCTUnwrap(HoursSchedule.parse(raw))
        for stamp in ["2026-03-08T06:59:59Z", "2026-03-08T07:00:00Z", "2026-11-01T05:30:00Z", "2026-11-01T06:30:00Z"] {
            XCTAssertEqual(schedule.overview(at: date(stamp)), "Today: Closed", stamp)
        }
    }

    func testTabsAbbreviationsRangesAndSemicolonsCoverAnExplicitWeek() throws {
        for text in ["Mon–Fri: 9am–5pm; Sat–Sun: Closed", "Monday through Friday\t9am–5pm\nSaturday to Sunday\tClosed",
                     "Mon.-Fri. 9am–5pm; Sat.-Sun. Closed"] {
            let schedule = try XCTUnwrap(HoursSchedule.parse(text), text)
            XCTAssertEqual(schedule.hours(on: .monday), "9am–5pm")
            XCTAssertEqual(schedule.hours(on: .friday), "9am–5pm")
            XCTAssertEqual(schedule.hours(on: .saturday), "Closed")
            XCTAssertEqual(schedule.hours(on: .sunday), "Closed")
        }
        let tabs = raw.replacingOccurrences(of: ": ", with: "\t").replacingOccurrences(of: "Thursday", with: "Thurs.")
        XCTAssertEqual(HoursSchedule.parse(tabs)?.hours(on: .thursday), "12:00 pm - 8:00 pm")
    }

    func testExplicitListsWrappedRangesAndDailyPreserveOnlyReportedCoverage() throws {
        let lists = try XCTUnwrap(HoursSchedule.parse("Mon, Wed, Fri: 9–5; Tue & Thu: 10–8; Sat-Sun: Closed"))
        XCTAssertEqual(lists.hours(on: .wednesday), "9–5")
        XCTAssertEqual(lists.hours(on: .thursday), "10–8")
        let wrapped = try XCTUnwrap(HoursSchedule.parse("Fri–Mon: 10–6; Tue–Thu: Closed"))
        XCTAssertEqual(wrapped.hours(on: .sunday), "10–6")
        XCTAssertEqual(wrapped.hours(on: .monday), "10–6")
        XCTAssertEqual(wrapped.hours(on: .tuesday), "Closed")
        XCTAssertEqual(HoursSchedule.parse("Daily: 8am–8pm")?.hours(on: .sunday), "8am–8pm")
        XCTAssertEqual(HoursSchedule.parse("Every day: Closed")?.hours(on: .tuesday), "Closed")
    }

    func testMissingDuplicateAmbiguousOrAdditionalDaysDoNotInventSchedule() {
        for text in ["Mon–Fri: 9–5", "Mon–Fri: 9–5; Fri–Sun: Closed", "Mon, Mon: 9–5; Tue–Sun: Closed",
                     "Mon–Sat: 9–5; Holiday: Closed", "Mondayish: 9–5; Tue–Sun: Closed", "Mon–Sun:",
                     "Mon–Sun: 9–5;", "Mon–Sun: 9–5;;", "Mon-Sun: 9\t5", "Mon-Sun: 9–5; Holiday hours vary"] {
            XCTAssertNil(HoursSchedule.parse(text), text)
        }
    }

    func testSeasonalGenericAndUnrecognizedHoursStayVerbatimWithoutOpenNowInference() {
        var place = place()
        for text in ["8am-4pm, Open later seasonally", "Open dawn to dusk", "Bathrooms are open from 7 a.m.-7 p.m., with a one-hour closure for cleaning from 12 noon-1 p.m.",
                     "Year Round", "Open by permit", "8am–5pm daily", "24 Hours"] {
            place.hours = text
            XCTAssertNil(HoursSchedule.parse(text), text)
            XCTAssertEqual(place.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false, now: date("2026-11-06T17:00:00Z")), text)
            XCTAssertEqual(place.resolvedHours()?.fullScheduleText, text)
        }
    }

    func testReportedTimeTyposAndBreaksArePreservedRatherThanInterpreted() throws {
        let schedule = try XCTUnwrap(HoursSchedule.parse("Mon–Fri: 10:00 pm - 7:00 pm; Sat–Sun: 9:30am–12pm, 1pm–6pm"))
        XCTAssertEqual(schedule.hours(on: .monday), "10:00 pm - 7:00 pm")
        XCTAssertEqual(schedule.hours(on: .sunday), "9:30am–12pm, 1pm–6pm")
        XCTAssertFalse(schedule.overview(at: date("2026-11-05T17:00:00Z")).lowercased().contains("open now"))
    }

    func testDirectAccessAndDirectoryHoursPrecedeResearchAndStayExpandableWithoutIt() {
        var place = place(); place.hours = raw
        let research = profile([("restroomHours", "restroom", "Research restroom hours"), ("venueHours", "venue", "Venue hours")])
        XCTAssertEqual(place.resolvedHours(researchProfile: research)?.raw, raw)
        XCTAssertNil(place.resolvedHours(researchProfile: research)?.sourceFactID)
        XCTAssertEqual(place.resolvedHours()?.weeklySchedule?.fullWeeklyText.components(separatedBy: "\n").count, 7)
        place.accessDetails = accessDetails(hours: "Open 24 hours a day, 7 days a week")
        XCTAssertEqual(place.resolvedHours(researchProfile: research)?.raw, "Open 24 hours a day, 7 days a week")
        XCTAssertEqual(place.overviewHours(accessDetailsLoading: true, accessDetailsFailed: true, researchProfile: research), "24 hours daily")
        XCTAssertEqual(place.hours, raw)
        place.accessDetails = accessDetails(hours: nil)
        XCTAssertEqual(place.resolvedHours(researchProfile: research)?.raw, raw)
    }

    func testResearchRestroomPriorityVenueLabelAndForeignProfileIsolation() {
        let place = place()
        let research = profile([("venueHours", "venue", raw), ("restroomHours", "restroom", "Restroom-specific hours")])
        XCTAssertEqual(place.resolvedHours(researchProfile: research)?.raw, "Restroom-specific hours")
        let venue = profile([("venueHours", "venue", raw)])
        XCTAssertEqual(place.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false, researchProfile: venue,
            now: date("2026-11-06T02:30:00Z")), "Venue hours: Today: 12:00 pm - 8:00 pm")
        XCTAssertEqual(place.resolvedHours(researchProfile: venue)?.scope, .venue)
        XCTAssertNil(place.resolvedHours(researchProfile: profile([("restroomHours", "restroom", raw)], foreign: true)))
        XCTAssertNil(place.resolvedHours(researchProfile: profile([("seasonality", "restroom", "Year Round")])))
        XCTAssertNil(place.resolvedHours(researchProfile: profile([("hours", "route", "10–6")])))
    }

    func testRecognizedWeeklyDirectoryRowsAllCollapseToOneNewYorkDay() throws {
        let resources = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Restroom Ready/Resources")
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf: resources.appendingPathComponent("restrooms.json")))
        let weekly = city.places.filter { $0.hours.flatMap(HoursSchedule.parse) != nil }
        XCTAssertGreaterThan(weekly.count, 190)
        let now = date("2026-11-06T02:30:00Z")
        for place in weekly {
            let schedule = try XCTUnwrap(place.hours.flatMap(HoursSchedule.parse))
            let value = place.overviewHours(accessDetailsLoading: true, accessDetailsFailed: true, now: now)
            XCTAssertEqual(value, "Today: " + schedule.hours(on: .thursday), place.id)
            XCTAssertFalse(value.contains("\n"), place.id)
            XCTAssertEqual(place.resolvedHours()?.fullScheduleText.components(separatedBy: "\n").count, 7)
        }
    }

    func testIncompleteOrAmbiguousWeeklyTextStaysOnlyInExpandedSchedule() {
        var place = place()
        for text in ["Mon–Fri: 9–5", "Monday: 10–6; Tuesday: Closed", "Weekdays 9–5; weekends closed",
                     "Mon–Fri: 9–5; Fri–Sun: Closed", raw.replacingOccurrences(of: "Sunday: Closed \n", with: "")] {
            place.hours = text
            XCTAssertNil(HoursSchedule.parse(text), text)
            XCTAssertEqual(place.overviewHours(accessDetailsLoading: false, accessDetailsFailed: false,
                now: date("2026-11-05T17:00:00Z")), "Schedule varies — see full schedule")
            XCTAssertEqual(place.resolvedHours()?.fullScheduleText, text)
            XCTAssertEqual(place.hours, text)
        }
        let venue = profile([("venueHours", "venue", "Mon–Fri: 9–5")])
        XCTAssertEqual(self.place().overviewHours(accessDetailsLoading: false, accessDetailsFailed: false,
            researchProfile: venue), "Venue hours: Schedule varies — see full schedule")
        XCTAssertEqual(self.place().resolvedHours(researchProfile: venue)?.fullScheduleText, "Mon–Fri: 9–5")
    }

    func testMergedWeekdayRowsCannotBecomeTodaysHoursBody() {
        for text in [raw.replacingOccurrences(of: "Monday: 10:00 am - 6:00 pm", with: "Monday: 10:00 am - 6:00 pm Tuesday: Closed"),
                     "Mon–Fri: 9–5 Sat–Sun: Closed; Sat–Sun: Closed", "Daily: 9–5 except Mondays"] {
            XCTAssertNil(HoursSchedule.parse(text), text)
            let presentation = ReportedHoursPresentation(raw: text, scope: .restroom, sourceFactID: nil)
            XCTAssertEqual(presentation.overview(at: date("2026-11-05T17:00:00Z")), "Schedule varies — see full schedule")
            XCTAssertEqual(presentation.fullScheduleText, text)
        }
    }

    func testWeekdayDetectionDoesNotTreatSunriseOrMonthsAsDayTokens() {
        for text in ["8am–5pm daily", "Sunrise to sunset", "Open later during summer months", "Dawn to dusk", "Closed during monsoon weather"] {
            XCTAssertFalse(HoursSchedule.hasWeekdayReferences(text), text)
            XCTAssertEqual(ReportedHoursPresentation(raw: text, scope: .restroom, sourceFactID: nil)
                .overview(at: date("2026-11-05T17:00:00Z")), text)
        }
    }

    private func scheduleFact(_ value: String, label: String = "Listed hours", scope: String = "restroom",
                              context: String = "", field: String = "hours") -> CardResearchFact {
        .init(id: String(repeating: "c", count: 20), field: field, label: label, value: value, scope: scope,
            sourceID: String(repeating: "b", count: 20), section: "hours", context: context)
    }

    func testRepeatedScheduleFactUsesCompactReferenceWithoutChangingItsOriginalEvidence() throws {
        let reported = ReportedHoursPresentation(raw: raw, scope: .restroom, sourceFactID: nil)
        let fact = scheduleFact(raw)
        XCTAssertTrue(reported.repeatsSchedule(fact), "Direct hours also suppress a duplicate original fact")
        XCTAssertEqual(fact.value, raw)
        XCTAssertEqual(fact.label, "Listed hours")
        XCTAssertEqual(fact.sourceID, String(repeating: "b", count: 20))
        let grouped = "Mon–Thu: 10–6; Fri–Sat: 10–5; Sun: Closed"
        let expanded = "Monday: 10–6\nTuesday: 10–6\nWednesday: 10–6\nThursday: 10–6\nFriday: 10–5\nSaturday: 10–5\nSunday: Closed"
        let weekly = ReportedHoursPresentation(raw: grouped, scope: .restroom, sourceFactID: fact.id)
        XCTAssertTrue(weekly.repeatsSchedule(scheduleFact(expanded)))
        XCTAssertEqual(weekly.raw, grouped)
        XCTAssertEqual(weekly.fullScheduleText, expanded)
    }

    func testConflictingScopesTimesAndQualifiersAreNotSuppressedAsDuplicates() {
        let reported = ReportedHoursPresentation(raw: raw, scope: .restroom, sourceFactID: String(repeating: "c", count: 20))
        let conflicts = [scheduleFact(raw.replacingOccurrences(of: "Tuesday: 1:00 pm", with: "Tuesday: 2:00 pm")),
            scheduleFact(raw, label: "Holiday hours"), scheduleFact(raw, context: "May–September"),
            scheduleFact(raw, scope: "venue", field: "venueHours"), scheduleFact(raw, field: "seasonality"),
            scheduleFact(raw.replacingOccurrences(of: "Sunday: Closed", with: "Sunday: Closed except on event days"))]
        for fact in conflicts { XCTAssertFalse(reported.repeatsSchedule(fact), fact.label + ":" + fact.context) }
        let seasonal = ReportedHoursPresentation(raw: "8am-4pm, Open later seasonally", scope: .restroom, sourceFactID: nil)
        XCTAssertTrue(seasonal.repeatsSchedule(scheduleFact("8am-4pm, Open later seasonally")))
        XCTAssertFalse(seasonal.repeatsSchedule(scheduleFact("8am-4pm")))
    }

    func testRealLibraryScheduleDeduplicatesOnlyTheScheduleWhileKeepingSeasonality() throws {
        let repo = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: repo.appendingPathComponent("data/research-map-2026-10-24/public-card-profiles.json"))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let rows = try XCTUnwrap(object["profiles"] as? [[String: Any]])
        let libraryID = "i7jb-7jku:row-ahsi-k4c4-scek"
        let profile = try CardResearchProfile.decode(id: libraryID, data: XCTUnwrap(rows.first { $0["placeID"] as? String == libraryID }))
        let city = try JSONDecoder().decode(CitySnapshot.self, from: Data(contentsOf:
            repo.appendingPathComponent("ios/Restroom Ready/Resources/restrooms.json")))
        let place = try XCTUnwrap(city.places.first { $0.id == libraryID })
        let reported = try XCTUnwrap(place.resolvedHours(researchProfile: profile))
        let facts = profile.facts(in: "hours")
        XCTAssertEqual(facts.filter(reported.repeatsSchedule).map(\.id), ["90efd293145c277e4cad"])
        XCTAssertEqual(facts.filter { !reported.repeatsSchedule($0) }.map(\.field), ["seasonality"])
        XCTAssertEqual(facts.first { $0.id == "90efd293145c277e4cad" }?.value, place.reportedRestroomHours)
    }
}
