import Foundation

// Only bounded, predefined values cross the Analytics boundary. No identifiers,
// content, URLs, coordinates, search terms, passcodes or observation dates.
enum NativeAnalyticsProvider: String, CaseIterable, Sendable { case google, apple }
enum NativeAnalyticsScreen: String, CaseIterable, Sendable {
    case finder, list, account, filters, restroom, passcodes, sources
    case directoryUnavailable = "directory_unavailable"
    case savedPlaces = "saved_places", comments = "own_comments", rateComment = "rate_comment", signIn = "sign_in"
    case restroomRequests = "own_restroom_requests"
    case contentReport = "content_report"
    case newRestroom = "new_restroom", visitNote = "visit_note", amenityProblem = "amenity_problem"
    case codeReport = "code_report", codeVisibility = "code_visibility", accountDeletion = "account_deletion"

    var screenClass: String {
        switch self {
        case .directoryUnavailable: "Restroom_ReadyApp"
        case .finder, .list, .savedPlaces, .filters: "NativeRootView"
        case .account, .comments, .restroomRequests, .accountDeletion: "NativeAccountView"
        case .signIn: "NativeSignInSheet"
        case .restroom, .passcodes, .rateComment, .sources: "PlaceDetailSheet"
        case .newRestroom: "NewRestroomForm"
        case .visitNote, .amenityProblem: "PublicVisitForm"
        case .codeReport: "CodeForm"
        case .codeVisibility: "CodeVisibilityForm"
        case .contentReport: "ContentReportForm"
        }
    }
}
enum NativeAnalyticsSource: String, CaseIterable, Sendable {
    case map, search, list, comments, account, other
    case savedPlaces = "saved_places", newRestroom = "new_restroom"
    case requests = "own_requests"
}
enum NativeAnalyticsCardHeight: String, CaseIterable, Sendable { case medium, large }
enum NativeAnalyticsSection: String, CaseIterable, Sendable {
    case hours, amenities, condition
    case visitorReports = "visitor_reports", sourceReference = "source_reference", codeHistory = "code_history"
    case visitorNote = "visitor_note", sourceComments = "source_comments", inspectionDetails = "inspection_details"
    case fixtureInventory = "fixture_inventory", reportedIssues = "reported_issues", restroomType = "restroom_type"
    case codeOwnerHistory = "code_owner_history"
}
enum NativeAnalyticsFilter: String, CaseIterable, Sendable {
    case clean, accessible
    case stairFree = "stair_free", publicAccess = "public_access", elevatorAccess = "elevator_access"
}
enum NativeAnalyticsBrowseMode: String, CaseIterable, Sendable { case map, list }
enum NativeAnalyticsSearchContext: String, CaseIterable, Sendable { case restrooms, address }
enum NativeAnalyticsLocationOutcome: String, CaseIterable, Sendable {
    case success, unavailable
    case permissionDenied = "permission_denied", outsideNYC = "outside_nyc"
}
enum NativeAnalyticsForm: String, CaseIterable, Sendable {
    case contentReport = "content_report"
    case signIn = "sign_in"
    case visitNote = "visit_note", amenityProblem = "amenity_problem", newRestroom = "new_restroom"
    case codeReport = "code_report", codeVisibility = "code_visibility", accountDeletion = "account_deletion"
}
enum NativeAnalyticsFailure: String, CaseIterable, Sendable {
    case authenticationRequired = "authentication_required", permissionDenied = "permission_denied"
    case network, unavailable, validation, unknown
}
enum NativeAnalyticsMutation: String, CaseIterable, Sendable {
    case reportContent = "content_report_submit"
    case savePlace = "place_save", unsavePlace = "place_unsave"
    case submitRating = "rating_submit", removeRating = "rating_remove"
    case submitVisitNote = "visit_note_submit", removeVisitNote = "visit_note_remove"
    case submitAmenityProblem = "amenity_problem_submit", submitRestroom = "restroom_submit"
    case submitRestroomRequest = "restroom_request_submit"
    case submitCodeReport = "code_report_submit", changeCodeVisibility = "code_visibility_change"
    case removeCodeReport = "code_report_remove", verifyCode = "code_verify"
    case codeWorked = "code_feedback_used", codeInvalid = "code_feedback_invalid"
    case signOut = "sign_out", deleteAccount = "account_delete"
}
enum NativeAnalyticsCountBucket: String, CaseIterable, Sendable {
    case unknown, zero, one
    case twoToFive = "2_to_5", sixToTwenty = "6_to_20"
    case twentyOneToHundred = "21_to_100", overHundred = "over_100"
    static func from(_ count: Int) -> Self {
        switch count {
        case ..<0: .unknown
        case 0: .zero
        case 1: .one
        case 2...5: .twoToFive
        case 6...20: .sixToTwenty
        case 21...100: .twentyOneToHundred
        default: .overHundred
        }
    }
}
struct NativeAnalyticsFilters: Equatable, Sendable {
    var clean = false, accessible = false, stairFree = false, publicAccess = false, elevatorAccess = false
    var parameters: [String: String] {
        ["clean": String(clean), "accessible": String(accessible), "stair_free": String(stairFree),
         "public_access": String(publicAccess), "elevator_access": String(elevatorAccess),
         "filter_count": String([clean, accessible, stairFree, publicAccess, elevatorAccess].filter { $0 }.count)]
    }
}
struct NativeAnalyticsPayload: Equatable, Codable, Sendable {
    let name: String
    let parameters: [String: String]
}
enum NativeAnalyticsEvent: Equatable, Sendable {
    case screen(NativeAnalyticsScreen), cardOpen(NativeAnalyticsSource), cardHeight(NativeAnalyticsCardHeight)
    case sectionExpansion(NativeAnalyticsSection, expanded: Bool)
    case searchSubmit(results: NativeAnalyticsCountBucket, context: NativeAnalyticsSearchContext = .restrooms)
    case filterToggle(NativeAnalyticsFilter, enabled: Bool), filtersApply(NativeAnalyticsFilters), filtersClear
    case browseMode(NativeAnalyticsBrowseMode), locateRequest, locateResult(NativeAnalyticsLocationOutcome)
    case directionsOpen, sourceOpen, privacyOpen, venueSelect, mapClusterOpen(size: NativeAnalyticsCountBucket)
    case formOpen(NativeAnalyticsForm), formCancel(NativeAnalyticsForm)
    case authStart(NativeAnalyticsProvider), authCancel(NativeAnalyticsProvider)
    case authFailure(NativeAnalyticsProvider, NativeAnalyticsFailure)
    case signUp(NativeAnalyticsProvider), login(NativeAnalyticsProvider)
    case mutationSucceeded(NativeAnalyticsMutation), mutationFailed(NativeAnalyticsMutation, NativeAnalyticsFailure)

    var payload: NativeAnalyticsPayload {
        let name: String
        var values: [String: String] = ["event_schema": "1"]
        switch self {
        case .screen(let screen):
            name = "screen_view"; values["screen_name"] = screen.rawValue; values["screen_class"] = screen.screenClass
        case .cardOpen(let source): name = "restroom_open"; values["entry_point"] = source.rawValue
        case .cardHeight(let height): name = height == .large ? "restroom_expand" : "restroom_collapse"
        case .sectionExpansion(let section, let expanded):
            name = expanded ? "detail_section_open" : "detail_section_close"; values["section_name"] = section.rawValue
        case .searchSubmit(let bucket, let context):
            name = "search_submit"; values["result_count_bucket"] = bucket.rawValue; values["search_context"] = context.rawValue
        case .filterToggle(let filter, let enabled):
            name = "filter_toggle"; values["filter_name"] = filter.rawValue; values["enabled"] = String(enabled)
        case .filtersApply(let filters): name = "filters_apply"; values.merge(filters.parameters) { _, new in new }
        case .filtersClear: name = "filters_clear"
        case .browseMode(let mode): name = "browse_mode_change"; values["browse_mode"] = mode.rawValue
        case .locateRequest: name = "locate_request"
        case .locateResult(let result): name = "locate_result"; values["location_result"] = result.rawValue
        case .directionsOpen: name = "directions_open"
        case .sourceOpen: name = "source_open"
        case .privacyOpen: name = "privacy_open"
        case .venueSelect: name = "venue_select"
        case .mapClusterOpen(let bucket): name = "map_cluster_open"; values["cluster_size_bucket"] = bucket.rawValue
        case .formOpen(let form): name = "form_open"; values["form_name"] = form.rawValue
        case .formCancel(let form): name = "form_cancel"; values["form_name"] = form.rawValue
        case .authStart(let provider): name = "auth_start"; values["method"] = provider.rawValue
        case .authCancel(let provider): name = "auth_cancel"; values["method"] = provider.rawValue
        case .authFailure(let provider, let failure):
            name = "auth_error"; values["method"] = provider.rawValue; values["failure_reason"] = failure.rawValue
        case .signUp(let provider): name = "sign_up"; values["method"] = provider.rawValue
        case .login(let provider): name = "login"; values["method"] = provider.rawValue
        case .mutationSucceeded(let action): name = action.rawValue
        case .mutationFailed(let action, let failure):
            name = "action_error"; values["action_name"] = action.rawValue; values["failure_reason"] = failure.rawValue
        }
        return NativeAnalyticsPayload(name: name, parameters: values)
    }
}

/// Keys are private in-memory receipt identities, never event parameters.
/// Bounded storage avoids retaining an unbounded account/action history.
struct NativeAnalyticsDeduplicationGate {
    private struct Key: Hashable { let payload: NativeAnalyticsPayloadKey; let receipt: String }
    private struct NativeAnalyticsPayloadKey: Hashable {
        let name: String; let parameters: [String: String]
    }
    private var seen: Set<Key> = []
    private var order: [Key] = []
    let capacity: Int
    init(capacity: Int = 1024) { self.capacity = max(1, min(capacity, 4096)) }
    mutating func consume(_ event: NativeAnalyticsEvent, key: String?) -> Bool {
        guard let key, !key.isEmpty else { return true }
        let payload = event.payload
        let record = Key(payload: .init(name: payload.name, parameters: payload.parameters), receipt: key)
        guard seen.insert(record).inserted else { return false }
        order.append(record)
        if order.count > capacity { seen.remove(order.removeFirst()) }
        return true
    }
}

/// Classification uses account identities locally, but returns only a static
/// provider value. Existing returning/restored accounts cannot become signups.
struct NativeAnalyticsAccountGate {
    private var signups = NewAccountAnalyticsGate()
    mutating func event(isNewUser: Bool?, providerID: String?, accountID: String,
                        currentAccountID: String?, credentialProviderID: String? = nil) -> NativeAnalyticsEvent? {
        guard let confirmedProviderID = NewAccountAnalyticsGate.confirmedProviderID(
                reported: providerID, credentialProviderID: credentialProviderID),
              let method = NewAccountAnalyticsGate.method(providerID: confirmedProviderID),
              let provider = NativeAnalyticsProvider(rawValue: method),
              !accountID.isEmpty, accountID == currentAccountID else { return nil }
        if isNewUser == true {
            guard signups.consume(isNewUser: isNewUser, providerID: confirmedProviderID,
                                  accountID: accountID, currentAccountID: currentAccountID) else { return nil }
            return .signUp(provider)
        }
        return .login(provider)
    }
}
