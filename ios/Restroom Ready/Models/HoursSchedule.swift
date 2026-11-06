import Foundation

/// Parses only an explicitly complete seven-day schedule. Reported time strings
/// stay verbatim: this never interprets a closing time or determines open-now.
struct HoursSchedule: Equatable {
    enum Day: Int, CaseIterable {
        case monday, tuesday, wednesday, thursday, friday, saturday, sunday
        var name: String { ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][rawValue] }
    }
    let raw: String
    private let values: [String]

    var fullWeeklyText: String {
        Day.allCases.map { $0.name + ": " + values[$0.rawValue] }.joined(separator: "\n")
    }

    func hours(on day: Day) -> String { values[day.rawValue] }

    func hoursToday(at date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        // Gregorian weekday uses Sunday=1, while the schedule starts on Monday.
        return values[(calendar.component(.weekday, from: date) + 5) % 7]
    }

    func overview(at date: Date) -> String { "Today: " + hoursToday(at: date) }

    static func hasWeekdayReferences(_ text: String) -> Bool {
        // Word boundaries avoid mistaking sunrise, months or similar prose for
        // a weekday, while retaining malformed/incomplete weekly text for expansion.
        let day = "(?:mondays?|mon\\.?|tuesdays?|tues?\\.?|wednesdays?|wed\\.?|thursdays?|thurs?\\.?|thu\\.?|fridays?|fri\\.?|saturdays?|sat\\.?|sundays?|sun\\.?|weekdays?|weekends?)"
        return text.range(of: "(?<![A-Za-z])" + day + "(?![A-Za-z])", options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func parse(_ raw: String) -> Self? {
        guard raw.utf16.count <= 12_000 else { return nil }
        let text = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let day = "(?:monday|mon\\.?|tuesday|tues?\\.?|wednesday|wed\\.?|thursday|thurs?\\.?|thu\\.?|friday|fri\\.?|saturday|sat\\.?|sunday|sun\\.?)"
        let range = day + "(?:\\s*(?:[-–—]|to|through)\\s*" + day + ")?"
        let selector = "(?:daily|every day|" + range + "(?:\\s*(?:,|&|and)\\s*" + range + ")*)"
        guard let entry = try? NSRegularExpression(pattern: "^(" + selector + ")(?::[ \\t]*|\\t+| +)(.+)$", options: .caseInsensitive),
              let rangePattern = try? NSRegularExpression(pattern: "^(" + day + ")\\s*(?:[-–—]|to|through)\\s*(" + day + ")$", options: .caseInsensitive),
              let listSeparator = try? NSRegularExpression(pattern: "\\s*(?:,|&|\\band\\b)\\s*", options: .caseInsensitive) else { return nil }
        func weekday(_ value: String) -> Day? {
            let names: [String: Day] = ["monday": .monday, "mon": .monday, "tuesday": .tuesday, "tue": .tuesday, "tues": .tuesday,
                "wednesday": .wednesday, "wed": .wednesday, "thursday": .thursday, "thu": .thursday, "thur": .thursday,
                "thurs": .thursday, "friday": .friday, "fri": .friday, "saturday": .saturday, "sat": .saturday,
                "sunday": .sunday, "sun": .sunday]
            return names[value.lowercased().replacingOccurrences(of: ".", with: "")]
        }
        func selectedDays(_ label: String) -> [Day]? {
            if ["daily", "every day"].contains(label.lowercased()) { return Day.allCases }
            let separated = listSeparator.stringByReplacingMatches(in: label, range: NSRange(label.startIndex..., in: label), withTemplate: "|")
            var days: [Day] = []
            for group in separated.components(separatedBy: "|") {
                if let match = rangePattern.firstMatch(in: group, range: NSRange(group.startIndex..., in: group)),
                   let fromRange = Range(match.range(at: 1), in: group), let toRange = Range(match.range(at: 2), in: group),
                   let first = weekday(String(group[fromRange])), let last = weekday(String(group[toRange])) {
                    var next = first.rawValue
                    while true {
                        guard let value = Day(rawValue: next) else { return nil }
                        days.append(value)
                        if next == last.rawValue { break }
                        next = (next + 1) % 7
                    }
                } else if let value = weekday(group) { days.append(value) }
                else { return nil }
            }
            return Set(days).count == days.count ? days : nil
        }
        var reported: [Day: String] = [:]
        let rows = text.components(separatedBy: CharacterSet(charactersIn: "\n;"))
        guard !rows.isEmpty, rows.count <= 7 else { return nil }
        for row in rows {
            let value = row.trimmingCharacters(in: .whitespaces)
            guard let match = entry.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)),
                  let selectorRange = Range(match.range(at: 1), in: value), let bodyRange = Range(match.range(at: 2), in: value),
                  let days = selectedDays(String(value[selectorRange])) else { return nil }
            let hours = String(value[bodyRange]).trimmingCharacters(in: .whitespaces)
            guard !hours.isEmpty, hours.rangeOfCharacter(from: .controlCharacters) == nil,
                  !hasWeekdayReferences(hours) else { return nil }
            for selected in days {
                guard reported[selected] == nil else { return nil }
                reported[selected] = hours
            }
        }
        guard reported.count == 7 else { return nil }
        return .init(raw: raw, values: Day.allCases.map { reported[$0]! })
    }
}

/// One resolution shared by the collapsed row and its expanded full schedule.
struct ReportedHoursPresentation: Equatable {
    enum Scope { case restroom, venue }
    let raw: String
    let scope: Scope
    let sourceFactID: String?
    var weeklySchedule: HoursSchedule? { HoursSchedule.parse(raw) }
    var fullScheduleText: String { weeklySchedule?.fullWeeklyText ?? raw }

    /// Only an unqualified schedule with the same scope and reported values is
    /// redundant beside the resolved schedule. Other claims remain full facts.
    func repeatsSchedule(_ fact: CardResearchFact) -> Bool {
        guard fact.section == "hours", ["restroomHours", "venueHours", "hours"].contains(fact.field),
              ["Hours", "Listed hours", "Reported hours", "Restroom hours", "Venue hours"].contains(fact.label),
              fact.scope == (scope == .venue ? "venue" : "restroom"),
              fact.context.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if raw.trimmingCharacters(in: .whitespacesAndNewlines) == fact.value.trimmingCharacters(in: .whitespacesAndNewlines) { return true }
        guard let schedule = weeklySchedule, let factSchedule = HoursSchedule.parse(fact.value) else { return false }
        return schedule.fullWeeklyText == factSchedule.fullWeeklyText
    }

    func overview(at date: Date) -> String {
        let value: String
        if raw == "Open 24 hours a day, 7 days a week" { value = "24 hours daily" }
        else if let weeklySchedule { value = weeklySchedule.overview(at: date) }
        else if HoursSchedule.hasWeekdayReferences(raw) { value = "Schedule varies — see full schedule" }
        else { value = raw }
        return scope == .venue ? "Venue hours: " + value : value
    }
}
