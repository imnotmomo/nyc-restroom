import SwiftUI
import MapKit

private enum DetailForm: String, Identifiable {
    case visit, amenityProblem, code
    var id: String { rawValue }
}

private enum DetailDestination: Hashable {
    case passcodes, rateComment, sources
}

private enum PendingDetailAction {
    case contribution(DetailForm)
    case save
    case rating(Double)
    case verify(PasscodeReport)
    case feedback(CodeEvidence, CodeFeedback)
    case reportContent(ContentReportTarget)
}

private struct VisitorSummaryRequest: Hashable {
    let input: VisitorSummaryInput
    let feedReady: Bool
    let active: Bool
    let refresh: Int
}

private enum VisitorEntry: Identifiable {
    case note(PublicNote)
    case report(VisitReport)

    var id: String {
        switch self {
        case .note(let note): "note:" + note.id
        case .report(let report): "visit:" + report.id
        }
    }
    var submittedAt: Date {
        switch self {
        case .note(let note): note.submittedAt
        case .report(let report): report.submittedAt
        }
    }
}

struct PlaceDetailSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.scenePhase) private var scenePhase
    let store: NativeStore
    let place: Place
    let citySource: CitySnapshot.Source?
    let research: ResearchRegistry?
    @State private var form: DetailForm?
    @State private var pendingAction: PendingDetailAction?
    @State private var pendingPlaceID: String?
    @State private var pendingUID: String?
    @State private var pendingToken = UUID()
    @State private var showSignIn = false
    @State private var signInAwaitingDismissal = false
    @State private var signInPresentationToken: UUID?
    @State private var isVisible = false
    @State private var ratingDraft: Double?
    @State private var ratingChanged = false
    @State private var ratingSaved = false
    @State private var deleteNote: PublicNote?
    @State private var deleteVisit: VisitReport?
    @State private var contentReportTarget: ContentReportTarget?
    @State private var confirmCodeDelete = false
    @State private var verifyPublic: PasscodeReport?
    @State private var confirmOwnVerification = false
    @State private var feedbackReport: CodeEvidence?
    @State private var feedbackVote: CodeFeedback = .used
    @State private var editReportedCode: OwnCodeReport?
    @State private var deleteReportedCode: OwnCodeReport?
    @State private var editLegacyCode = false
    @State private var detailPath: [DetailDestination] = []
    @State private var visitorSummary = VisitorSummaryController(engine: AppleVisitorSummaryEngine())
    @State private var visitorSummaryRefresh = 0
    @State private var hoursRefreshAnchor = Date()
    @State private var expandedAnalyticsSections: Set<String> = []

    private var ownCode: OwnPasscode? { store.ownCode?.placeID == place.id ? store.ownCode : nil }
    private var cardResearch: CardResearchProfile? { store.researchProfile?.placeID == place.id ? store.researchProfile : nil }
    private var coveredSourceCommentIDs: Set<String> {
        !store.researchProfileLoading && store.researchProfileError == nil ? cardResearch?.coveredCommentIDs ?? [] : []
    }
    private var researchCodeClaims: [CardResearchFact] { cardResearch?.codeClaims ?? [] }
    private var publicCodes: [PasscodeReport] { store.publicCodes.filter { $0.placeID == place.id && $0.reportID != ownCode?.reportID } }
    private var publicNotes: [PublicNote] { store.publicNotes.filter { $0.placeID == place.id } }
    private var visitorEntries: [VisitorEntry] {
        let notes = publicNotes.map(VisitorEntry.note)
        let reports = store.visitReports.filter { $0.placeID == place.id }.map(VisitorEntry.report)
        return (notes + reports).sorted {
            $0.submittedAt == $1.submittedAt ? $0.id < $1.id : $0.submittedAt > $1.submittedAt
        }
    }
    private var summaryInput: VisitorSummaryInput {
        let visits = store.visitReports.map {
            VisitorSummaryObservation(id: "visit:" + $0.id, placeID: $0.placeID, observedAt: $0.observedAt, submittedAt: $0.submittedAt,
                condition: $0.condition, soap: $0.soap, toiletPaper: $0.toiletPaper, entryRule: $0.entryRule,
                purchaseRequired: $0.purchaseRequired, codeRequired: $0.codeRequired, stairs: $0.stairs, floor: $0.floor)
        }
        let notes = publicNotes.map {
            VisitorSummaryObservation(id: "note:" + $0.id, placeID: $0.placeID, observedAt: $0.observedAt, submittedAt: $0.submittedAt,
                condition: $0.condition, soap: $0.soap, toiletPaper: $0.toiletPaper, entryRule: "not-reported",
                purchaseRequired: "not-reported", codeRequired: "not-reported", stairs: $0.stairs, floor: "not-reported")
        }
        return VisitorSummaryInput(placeID: place.id, observations: visits + notes)
    }
    private var summaryRequest: VisitorSummaryRequest {
        VisitorSummaryRequest(input: summaryInput, feedReady: !store.detailsLoading && store.visitFeedError == nil
            && !store.publicNotesLoading && store.publicNotesFeedError == nil,
            active: scenePhase == .active, refresh: visitorSummaryRefresh)
    }
    private var purchaseRequirementReport: VisitReport? {
        store.visitReports.filter {
            $0.placeID == place.id && ["yes", "no"].contains($0.purchaseRequired)
        }.max {
            $0.observedAt == $1.observedAt ? $0.submittedAt < $1.submittedAt : $0.observedAt < $1.observedAt
        }
    }

    var body: some View {
        codeConfirmations
                .task(id: summaryRequest) {
                    let request = summaryRequest
                    await visitorSummary.update(input: request.input, feedReady: request.feedReady, active: request.active)
                }
                .onChange(of: scenePhase) { _, current in
                    if current == .active {
                        hoursRefreshAnchor = Date()
                        visitorSummary.refreshAvailability(); visitorSummaryRefresh += 1
                    }
                    else { visitorSummary.cancel() }
                }
                .onChange(of: store.user?.uid) { previous, current in
                    visitorSummary.cancel(); visitorSummaryRefresh += 1
                    let continuingRating: Double?
                    if previous == nil, current != nil, pendingPlaceID == place.id,
                       signInPresentationToken == pendingToken,
                       case .rating(let stars)? = pendingAction {
                        continuingRating = stars
                    } else { continuingRating = nil }
                    form = nil
                    deleteNote = nil; deleteVisit = nil; verifyPublic = nil; contentReportTarget = nil
                    confirmCodeDelete = false; confirmOwnVerification = false
                    feedbackReport = nil; editReportedCode = nil; deleteReportedCode = nil; editLegacyCode = false
                    ratingDraft = continuingRating
                    ratingChanged = continuingRating != nil
                    ratingSaved = false
                    if previous != nil || current == nil { clearPendingAction() }
                    else if let current, pendingAction != nil,
                            signInPresentationToken == pendingToken { pendingUID = current }
                    resumePendingAction()
                }
                .onChange(of: pendingReady) { _, ready in
                    if ready { resumePendingAction() }
                }
                .onChange(of: place.id) { _, _ in
                    visitorSummary.cancel(); detailPath = []
                    clearPendingAction()
                    showSignIn = false
                    form = nil
                    contentReportTarget = nil
                    feedbackReport = nil; editReportedCode = nil; deleteReportedCode = nil; editLegacyCode = false
                    confirmCodeDelete = false; confirmOwnVerification = false; verifyPublic = nil
                    ratingDraft = nil; ratingChanged = false; ratingSaved = false
                }
                .onChange(of: detailPath) { _, _ in NativeAnalytics.track(.screen(currentAnalyticsScreen)) }
                .onAppear {
                    NativeAnalytics.track(.screen(currentAnalyticsScreen))
                    hoursRefreshAnchor = Date(); isVisible = true; resumePendingAction()
                }
                .onDisappear { isVisible = false; clearPendingAction(); showSignIn = false; visitorSummary.cancel() }
    }

    private var currentAnalyticsScreen: NativeAnalyticsScreen {
        switch detailPath.last {
        case .passcodes: .passcodes
        case .rateComment: .rateComment
        case .sources: .sources
        case nil: .restroom
        }
    }

    private func analyticsExpansion(_ section: NativeAnalyticsSection, key: String = "") -> Binding<Bool> {
        // The local key preserves independent disclosure state. It is never
        // included in the typed Analytics event or the DEBUG trace.
        let identity = currentAnalyticsScreen.rawValue + ":" + section.rawValue + ":" + key
        return Binding(get: { expandedAnalyticsSections.contains(identity) }, set: { expanded in
            guard expanded != expandedAnalyticsSections.contains(identity) else { return }
            if expanded { expandedAnalyticsSections.insert(identity) }
            else { expandedAnalyticsSections.remove(identity) }
            NativeAnalytics.track(.sectionExpansion(section, expanded: expanded))
        })
    }

    private var analyticsSourceAction: OpenURLAction {
        OpenURLAction { url in
            openURL(url) { accepted in
                if accepted { Task { @MainActor in NativeAnalytics.track(.sourceOpen) } }
            }
            return .handled
        }
    }

    private var detailContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                heading
                    .padding(.bottom, 12)
                if let error = store.error {
                    RRIssue(message: error).padding(.bottom, 16)
                }
                quickOverview
                conditionOverview
                passcodeSummary
                if let error = store.researchProfileError {
                    Text(error).font(.caption).foregroundStyle(RRStyle.faint).padding(.vertical, 8)
                    Button("Retry additional details") { store.reloadSelectedPlace() }.frame(minHeight: 44)
                }
                if visitorSummary.available { visitorSummaryOverview }
                expandableDetails
            }
            .padding(.horizontal, 24)
            .padding(.top, 8)
            .padding(.bottom, 8)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        .background(RRStyle.surface)
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { closeToolbar }
    }

    private var expandableDetails: some View {
        VStack(spacing: 0) {
            Divider()
            NavigationLink(value: DetailDestination.rateComment) {
                HStack(spacing: 12) {
                    Text("Rate and Comment")
                    Spacer(minLength: 12)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(RRStyle.faint)
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("place-rate-comment")
            NavigationLink(value: DetailDestination.sources) {
                HStack(spacing: 12) {
                    Text("Sources & dates")
                    Spacer(minLength: 12)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(RRStyle.faint)
                }
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("place-sources-dates")
            Divider()
        }
    }

    private var rateCommentContent: some View {
        detailsList("Rate and Comment") {
            ratings
            if let profile = cardResearch, !profile.facts(in: "ratings").isEmpty {
                Section {
                    ForEach(profile.facts(in: "ratings")) { fact in researchFactRow(fact) }
                } header: { Text("Published scores") } footer: {
                    Text("These source scores are separate from the app's cleanliness ratings.")
                }
            }
            publicNoteCard
        }
    }

    private var sourcesContent: some View {
        detailsList("Sources & dates") {
            accessDetailsSource
            sourceReports
            researchSources
            if let facts = cardResearch?.facts(in: "hours"), !facts.isEmpty {
                Section("Hours evidence") { researchFactRows(facts) }
            }
            if let facts = cardResearch?.facts(in: "amenities"), !facts.isEmpty {
                Section("Amenities evidence") { researchFactRows(facts) }
            }
            Section {
                DisclosureGroup("Reported details", isExpanded: analyticsExpansion(.inspectionDetails, key: "reported")) {
                    if hasEntryFacts || hasRouteFacts {
                        entry
                        route
                    }
                    if let state = accessDetailsState {
                        if store.accessDetailsLoading { ProgressView(state) }
                        else {
                            RRIssue(message: state)
                            Button("Retry reported details") { store.reloadPublic() }.frame(minHeight: 44)
                        }
                    }
                    if let profile = cardResearch {
                        ForEach(profile.facts(in: "entryRoute")) { fact in researchFactRow(fact) }
                    }
                    provenance
                    conditions
                }
                if let summary = store.ratings[place.id], summary.ratingCount > 0 {
                    RRTime(label: "Rating totals updated", date: summary.updatedAt)
                }
            }
        }
    }

    private func detailsList<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        List {
            if let error = store.error { Section { RRIssue(message: error) } }
            content()
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        .background(RRStyle.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { closeToolbar }
    }

    private var passcodesContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) { codeCard }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) { actionBar }
        .background(RRStyle.background)
        .navigationTitle("Passcodes")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { closeToolbar }
    }

    @ToolbarContentBuilder private var closeToolbar: some ToolbarContent {
        if dynamicTypeSize.isAccessibilitySize {
            ToolbarItem(placement: .topBarLeading) { saveButton }
        }
        ToolbarItem(placement: .confirmationAction) {
            Button { dismiss() } label: {
                Image(systemName: "xmark").font(.system(size: 17, weight: .semibold))
                    .frame(minWidth: 32, minHeight: 32)
            }
            .accessibilityLabel("Close place")
            .accessibilityIdentifier("close-place")
        }
    }

    private var contributionSheet: some View {
        NavigationStack(path: $detailPath) {
            detailContent
                .navigationDestination(for: DetailDestination.self) { destination in
                    switch destination {
                    case .passcodes: passcodesContent
                    case .rateComment: rateCommentContent
                    case .sources: sourcesContent
                    }
                }
        }
        .font(RRStyle.body())
        .foregroundStyle(RRStyle.ink)
        .tint(RRStyle.ink)
        .toolbarBackground(RRStyle.surface, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .sheet(item: $form, onDismiss: { NativeAnalytics.track(.screen(currentAnalyticsScreen)) }) { value in
            switch value {
            case .visit: PublicVisitForm(store: store, place: place)
            case .amenityProblem: PublicVisitForm(store: store, place: place, reportingProblem: true)
            case .code: CodeReportForm(store: store, place: place)
            }
        }
        .sheet(item: $editReportedCode, onDismiss: { NativeAnalytics.track(.screen(currentAnalyticsScreen)) }) { report in
            CodeReportVisibilityForm(store: store, place: place, report: report)
        }
        .sheet(item: $contentReportTarget, onDismiss: { NativeAnalytics.track(.screen(currentAnalyticsScreen)) }) { target in
            ContentReportForm(store: store, place: place, target: target)
        }
        .sheet(isPresented: $editLegacyCode, onDismiss: { NativeAnalytics.track(.screen(currentAnalyticsScreen)) }) {
            PasscodeForm(store: store, place: place, existing: ownCode)
        }
        .sheet(isPresented: $showSignIn, onDismiss: signInSheetDismissed) {
            NativeSignInSheet(store: store, onCancel: {
                NativeAnalytics.track(.formCancel(.signIn))
                clearPendingAction()
            })
                .rrFormAnalytics(.signIn, screen: .signIn)
        }
    }

    private var visitConfirmations: some View {
        contributionSheet
        .confirmationDialog("Remove your public visit note?", isPresented: Binding(get: { deleteNote != nil }, set: { if !$0 { deleteNote = nil } })) {
            if let note = deleteNote {
                Button("Remove note", role: .destructive) { Task { _ = await store.removePublicNote(note) } }
            }
            Button("Keep note", role: .cancel) { deleteNote = nil }
        } message: { Text("This removes the note for everyone.") }
        .confirmationDialog("Remove your public note?", isPresented: Binding(get: { deleteVisit != nil }, set: { if !$0 { deleteVisit = nil } })) {
            if let report = deleteVisit {
                Button("Remove note", role: .destructive) { Task { _ = await store.removeVisit(report) } }
            }
            Button("Keep note", role: .cancel) { deleteVisit = nil }
        } message: { Text("This removes your note and observations for everyone. Any code you reported keeps its separate visibility and removal controls.") }
    }

    private var codeConfirmations: some View {
        visitConfirmations
        .confirmationDialog(feedbackVote == .used ? "Did this code work?" : "Did this code fail?",
                            isPresented: Binding(get: { feedbackReport != nil }, set: { if !$0 { feedbackReport = nil } })) {
            if let report = feedbackReport {
                Button(feedbackVote == .used ? "Yes, it worked" : "Yes, it didn’t work") {
                    let vote = feedbackVote
                    Task { _ = await store.setCodeFeedback(report, vote: vote) }
                }
            }
            Button("Cancel", role: .cancel) { feedbackReport = nil }
        } message: { Text("Report only an attempt you personally made with this exact code.") }
        .confirmationDialog("Delete your code report?", isPresented: Binding(get: { deleteReportedCode != nil }, set: { if !$0 { deleteReportedCode = nil } })) {
            if let report = deleteReportedCode {
                Button("Delete report", role: .destructive) { Task { _ = await store.removeCodeReport(report) } }
            }
            Button("Keep report", role: .cancel) { deleteReportedCode = nil }
        } message: { Text("This removes your report from everyone’s view. Other reports and your Saved place stay unchanged.") }
        .confirmationDialog("Delete your code?", isPresented: $confirmCodeDelete) {
            Button("Delete my code", role: .destructive) { Task { _ = await store.deleteOwnCode(placeID: place.id) } }
            Button("Keep code", role: .cancel) { }
        } message: {
            Text("Your public projection is removed too if this code was shared. The place stays in Saved.")
        }
        .confirmationDialog("Did you use this exact code successfully?", isPresented: Binding(get: { verifyPublic != nil }, set: { if !$0 { verifyPublic = nil } })) {
            if let report = verifyPublic {
                Button("Yes, I used it") { Task { _ = await store.verifyCode(report) } }
            }
            Button("Cancel", role: .cancel) { verifyPublic = nil }
        } message: { Text("Only record a successful use you personally checked. Reading the code does not verify it.") }
        .confirmationDialog("Did you use your code successfully?", isPresented: $confirmOwnVerification) {
            Button("Yes, I used it") { Task { _ = await store.verifyOwnCode() } }
            Button("Cancel", role: .cancel) { }
        } message: { Text("This records a check for the current version. A later code edit clears the earlier verification.") }
    }

    private var heading: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                if dynamicTypeSize.isAccessibilitySize {
                    placeName
                    currentRating
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        placeName
                        currentRating
                    }
                }
                Text(place.subtitle).font(.subheadline).foregroundStyle(RRStyle.faint).textSelection(.enabled)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if !dynamicTypeSize.isAccessibilitySize { saveButton }
        }
    }

    private var placeName: some View {
        Text(place.name)
            .font(.title2.weight(.bold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
    }

    private var currentRating: some View {
        Group {
            if let summary = store.ratings[place.id], summary.ratingCount > 0 {
                Label(summary.average.formatted(.number.precision(.fractionLength(1))), systemImage: "star.fill")
                    .accessibilityLabel("Cleanliness: \(summary.average.formatted(.number.precision(.fractionLength(1)))) out of 5, \(summary.ratingCount) ratings")
            } else if store.ratingsFeedError != nil {
                Text("Ratings unavailable")
            } else if store.ratingsLoading {
                Text("Loading ratings…")
            } else {
                Text("No ratings")
            }
        }
        .font(.subheadline.weight(.medium))
        .foregroundStyle(RRStyle.ink)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityIdentifier("place-current-rating")
    }

    private var quickOverview: some View {
        VStack(alignment: .leading, spacing: 0) {
            hoursOverview
            amenitiesOverview
        }
    }

    private var amenitiesOverview: some View {
        let labels = place.amenityLabels(
            reviewedElevatorPlaceIDs: research?.reportedElevatorPlaceIDs ?? [],
            accessDetailsLoading: store.accessDetailsLoading,
            accessDetailsFailed: store.accessDetailsFeedError != nil,
            researchProfile: cardResearch)
        let fallback = place.overviewAmenities(
            reviewedElevatorPlaceIDs: research?.reportedElevatorPlaceIDs ?? [],
            accessDetailsLoading: store.accessDetailsLoading,
            accessDetailsFailed: store.accessDetailsFeedError != nil)
        return DisclosureGroup(isExpanded: analyticsExpansion(.amenities)) {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(labels.count > 1 ? labels : [], id: \.self) { label in
                    Text(label).font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                Button { openContribution(.amenityProblem) } label: {
                    Text("Report a problem")
                        .font(.footnote).underline()
                        .foregroundStyle(RRStyle.faint)
                        .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                        .contentShape(Rectangle())
                }
                    .buttonStyle(.plain)
                    .disabled(store.busy || store.authBusy)
                    .accessibilityIdentifier("report-amenity-problem")
            }
            .padding(.leading, 32)
        } label: {
            summaryFact("Amenities", symbol: "list.bullet",
                value: labels.isEmpty ? fallback : labels.joined(separator: " · "), maximumLines: 3)
        }
        .tint(RRStyle.ink)
    }

    private var hoursOverview: some View {
        // Minute-aligned updates include New York midnight even when the card
        // stays open. A foreground refresh also catches suspended app time.
        let firstMinute = Date(timeIntervalSince1970: (hoursRefreshAnchor.timeIntervalSince1970 / 60).rounded(.down) * 60)
        return TimelineView(.periodic(from: firstMinute, by: 60)) { timeline in
            let reported = place.resolvedHours(researchProfile: cardResearch)
            let facts = cardResearch?.facts(in: "hours") ?? []
            let repeated = facts.filter { reported?.repeatsSchedule($0) == true }
            DisclosureGroup(isExpanded: analyticsExpansion(.hours)) {
                VStack(alignment: .leading, spacing: 12) {
                    if let reported {
                        Text(reported.scope == .venue ? "Venue hours · restroom hours not confirmed" : "Full reported hours")
                            .font(.caption).foregroundStyle(RRStyle.faint)
                        if let weekly = reported.weeklySchedule {
                            ForEach(HoursSchedule.Day.allCases, id: \.rawValue) { day in
                                Text(day.name + ": " + weekly.hours(on: day))
                                    .font(.subheadline)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("hours-day-" + String(day.rawValue))
                            }
                        } else {
                            Text(reported.fullScheduleText)
                                .font(.subheadline)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("hours-full-schedule")
                        }
                    } else if facts.isEmpty {
                        Text(place.overviewHours(accessDetailsLoading: store.accessDetailsLoading,
                            accessDetailsFailed: store.accessDetailsFeedError != nil, now: timeline.date))
                            .font(.subheadline).foregroundStyle(RRStyle.faint)
                    }
                    ForEach(repeated) { fact in hoursSourceReference(fact) }
                    researchFactRows(facts.filter { reported?.repeatsSchedule($0) != true })
                }
                .padding(.leading, 32)
            } label: {
                summaryFact("Hours", symbol: "clock", value: place.overviewHours(
                    accessDetailsLoading: store.accessDetailsLoading,
                    accessDetailsFailed: store.accessDetailsFeedError != nil,
                    researchProfile: cardResearch, now: max(timeline.date, hoursRefreshAnchor)),
                    detail: reported == nil && store.researchProfileLoading ? "Loading additional details…" : nil,
                    maximumLines: 3)
            }
            .tint(RRStyle.ink)
        }
    }

    @ViewBuilder private func hoursSourceReference(_ fact: CardResearchFact) -> some View {
        if let source = cardResearch?.source(for: fact) {
            DisclosureGroup(isExpanded: analyticsExpansion(.sourceReference, key: "hours-" + fact.id)) {
                researchSourceDetails(source)
            } label: {
                Text(source.caption).font(.caption).foregroundStyle(RRStyle.faint)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .tint(RRStyle.ink)
            .accessibilityIdentifier("hours-source-" + fact.id)
        }
    }

    private var conditionOverview: some View {
        let input = summaryInput
        let reported = input.observations.filter { $0.condition != "not-reported" }
        let value: String
        let detail: String?
        if store.detailsLoading || store.publicNotesLoading {
            value = "Loading reports…"; detail = nil
        } else if store.visitFeedError != nil || store.publicNotesFeedError != nil {
            value = "Reports unavailable"; detail = nil
        } else if let latest = reported.first {
            let sameVisitTime = reported.filter { $0.observedAt == latest.observedAt }
            value = Set(sameVisitTime.map(\.condition)).count > 1
                ? "Conflicting reports" : RRLabels.condition(latest.condition)
            detail = "Visited " + listingDate(latest.observedAt, calendarOnly: false)
        } else {
            value = "Not reported"; detail = nil
        }
        let facts = cardResearch?.facts(in: "conditions") ?? []
        let latestVisitor = reported.first.map { CardResearchProfile.calendarDay($0.observedAt) }
        let researched = cardResearch?.conditionSummary(visitorDay: latestVisitor)
        if !facts.isEmpty {
            return AnyView(DisclosureGroup(isExpanded: analyticsExpansion(.condition)) {
                researchFactRows(facts)
            } label: {
                summaryFact("Condition", symbol: "checkmark.circle",
                    value: researched?.value ?? value,
                    detail: researched.flatMap { cardResearch?.source(id: $0.sourceID)?.caption } ?? detail,
                    maximumLines: 3)
            }.tint(RRStyle.ink))
        }
        return AnyView(summaryFact("Condition", symbol: "checkmark.circle", value: value, detail: detail))
    }

    private var visitorSummaryOverview: some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            Text("Visitor reports").font(.subheadline.weight(.semibold)).padding(.top, 12)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("visitor-reports-title")
            if store.detailsLoading || store.publicNotesLoading { ProgressView("Loading reports…") }
            else if store.visitFeedError != nil || store.publicNotesFeedError != nil { Text("Reports unavailable").font(.subheadline).foregroundStyle(RRStyle.faint) }
            else if summaryInput.observations.isEmpty { Text("No visitor reports yet").font(.subheadline).foregroundStyle(RRStyle.faint) }
            else if summaryInput.eligibleTopics.isEmpty { Text("Read the visitor notes in Rate and Comment.").font(.subheadline).foregroundStyle(RRStyle.faint) }
            else if visitorSummary.input == summaryInput, let text = visitorSummary.text {
                Text(text).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("visitor-report-summary")
                Text(summaryObservationCaption).font(.caption).foregroundStyle(RRStyle.faint)
                Text("On-device AI summary · Past visits")
                    .font(.caption).foregroundStyle(RRStyle.faint)
            } else if visitorSummary.input == summaryInput, visitorSummary.failed {
                Text("Summary unavailable").font(.subheadline).foregroundStyle(RRStyle.faint)
                Button("Retry summary") { visitorSummaryRefresh += 1 }.frame(minHeight: 44)
            } else { ProgressView("Summarizing on device…") }
        }
        .padding(.bottom, 12)
    }

    private var summaryObservationCaption: String {
        let input = summaryInput
        guard let first = input.earliestObservation, let last = input.latestObservation else { return "" }
        let start = listingDate(first, calendarOnly: false), end = listingDate(last, calendarOnly: false)
        let dates = first == last ? start : "\(start) – \(end)"
        return "\(input.observations.count) dated report\(input.observations.count == 1 ? "" : "s") · \(dates)"
    }

    private var accessDetailsState: String? {
        if place.accessDetails != nil { return nil }
        if store.accessDetailsLoading { return "Loading entrance and route details…" }
        if store.accessDetailsFeedError != nil { return "Entrance and route details unavailable" }
        return nil
    }

    private var knownAccessDetails: RestroomAccessDetails? {
        accessDetailsState == nil ? place.accessDetails : nil
    }

    private func summaryFact(_ title: String, symbol: String, value: String, detail: String? = nil, maximumLines: Int? = nil) -> some View {
        VStack(spacing: 0) {
            Divider()
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: symbol).font(.system(size: 18)).frame(width: 20)
                    .foregroundStyle(RRStyle.faint)
                    .padding(.top, 3).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.caption).foregroundStyle(RRStyle.faint)
                        .multilineTextAlignment(.leading)
                    Text(value).font(.body.weight(.semibold)).lineLimit(maximumLines)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if let detail {
                        Text(detail).font(.caption).foregroundStyle(RRStyle.faint)
                            .multilineTextAlignment(.leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 16)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("place-summary-" + title.lowercased().replacingOccurrences(of: " ", with: "-"))
    }

    private var passcodeSummary: some View {
        NavigationLink(value: DetailDestination.passcodes) {
            VStack(spacing: 0) {
                Divider()
                HStack(spacing: 12) {
                    Image(systemName: "key").font(.system(size: 18)).frame(width: 20)
                        .foregroundStyle(RRStyle.faint).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        if let report = CodeEvidencePresentation.newestPublic(in: store.codeEvidence.filter { $0.placeID == place.id }) {
                            Text("Passcode").font(.caption).foregroundStyle(RRStyle.faint)
                            Text(report.code).font(.title3.weight(.semibold)).monospacedDigit()
                            Text(report.verifiedAt.map { "Verified \(listingDate($0, calendarOnly: false))" }
                                ?? "Reported \(listingDate(report.updatedAt, calendarOnly: false))")
                                .font(.caption).foregroundStyle(RRStyle.faint)
                        } else if let own = ownCode, own.visibility == "private" {
                            Text("Your private code").font(.caption).foregroundStyle(RRStyle.faint)
                            Text(own.code).font(.title3.weight(.semibold)).monospacedDigit()
                        } else if let own = store.ownCodeReports.first(where: { $0.placeID == place.id && $0.visibility == "private" }) {
                            Text("Your private code").font(.caption).foregroundStyle(RRStyle.faint)
                            Text(own.code).font(.title3.weight(.semibold)).monospacedDigit()
                        } else if let claim = researchCodeClaims.first {
                            Text("Published code claim").font(.caption).foregroundStyle(RRStyle.faint)
                            Text(claim.value).font(.title3.weight(.semibold)).monospacedDigit()
                            Text((cardResearch?.source(for: claim)?.caption ?? "Date not shown") + " · Unverified")
                                .font(.caption).foregroundStyle(RRStyle.faint)
                        } else if store.codeEvidenceError != nil || store.codeFeedError != nil
                                    || (store.user != nil && (store.ownCodeError != nil || store.ownCodeReportsError != nil)) {
                            Text("Passcodes unavailable")
                        } else if store.codeEvidenceLoading || store.detailsLoading || store.researchProfileLoading
                                    || (store.user != nil && (store.ownCodeLoading || store.ownCodeReportsLoading)) {
                            Text("Loading passcodes…")
                        } else if store.researchProfileError != nil {
                            Text("Additional code details unavailable")
                        } else { Text("No known passcode") }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundStyle(RRStyle.faint)
                }
                .padding(.vertical, 12)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
                Divider()
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("place-passcodes")
    }

    private var actionBar: some View {
        RRGlassContainer(spacing: 12) {
            directionsButton
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(RRStyle.surface)
    }

    private func listingDate(_ date: Date?, calendarOnly: Bool) -> String {
        guard let date else { return "Not reported" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = calendarOnly ? TimeZone(secondsFromGMT: 0) : TimeZone(identifier: "America/New_York")
        formatter.dateStyle = .medium
        formatter.timeStyle = calendarOnly ? .none : .short
        return formatter.string(from: date)
    }

    private var cityDirectoryUpdatedDate: Date? {
        guard let value = citySource?.dataUpdatedAt else { return nil }
        return ISO8601DateFormatter().date(from: value)
    }

    private var directionsButton: some View {
        Button {
            let destination = MKMapItem(placemark: MKPlacemark(coordinate: place.coordinate))
            destination.name = place.name
            if destination.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking]) {
                NativeAnalytics.track(.directionsOpen)
            }
        } label: {
            Label("Directions", systemImage: "figure.walk")
                .frame(maxWidth: .infinity, minHeight: 32)
                .foregroundStyle(.white)
        }
        .tint(RRStyle.ink)
        .rrGlassButton(prominent: true)
        .controlSize(.large)
        .accessibilityIdentifier("place-directions")
    }

    private var saveButton: some View {
        Button {
            if store.user == nil { requestAction(.save) }
            else {
                let expectedUID = store.user?.uid
                Task {
                    guard isVisible, store.user?.uid == expectedUID else { return }
                    _ = await store.toggleSaved(place)
                }
            }
        } label: {
            Image(systemName: store.savedIDs.contains(place.id) ? "bookmark.fill" : "bookmark")
                .font(.system(size: 20, weight: .medium))
                .frame(minWidth: 32, minHeight: 32)
                .foregroundStyle(RRStyle.ink)
        }
        .tint(RRStyle.ink)
        .rrGlassButton()
        .buttonBorderShape(.circle)
        .controlSize(.regular)
        .disabled(store.busy || store.authBusy || store.privateLoading || (store.user != nil && store.libraryError != nil))
        .accessibilityLabel(store.savedIDs.contains(place.id) ? "Unsave restroom" : "Save restroom")
        .accessibilityValue(store.savedIDs.contains(place.id) ? "Saved" : "Not saved")
        .accessibilityIdentifier("place-save")
    }

    private var pendingReady: Bool {
        guard isVisible, pendingPlaceID == place.id, let action = pendingAction,
              !showSignIn, !signInAwaitingDismissal,
              !store.authBusy, !store.busy, let user = store.user, !user.isAnonymous,
              let expectedUID = pendingUID, expectedUID == user.uid else { return false }
        switch action {
        case .contribution(.code):
            return true
        case .save:
            return !store.privateLoading && store.libraryError == nil
        case .feedback(let report, _):
            guard !store.codeEvidenceLoading, !store.ownCodeLoading, !store.ownCodeReportsLoading else { return false }
            guard let current = store.codeEvidence.first(where: { $0.id == report.id && $0.placeID == place.id }),
                  current.version == report.version else { return true }
            return current.ownership != .unknown && (current.isOwn || current.feedbackLoaded)
        default:
            return true
        }
    }

    private func clearPendingAction() {
        pendingAction = nil
        pendingPlaceID = nil
        pendingUID = nil
        pendingToken = UUID()
        signInPresentationToken = nil
    }

    private func requestAction(_ action: PendingDetailAction) {
        guard !showSignIn, !signInAwaitingDismissal, !store.authBusy, !store.busy else { return }
        pendingAction = action
        pendingPlaceID = place.id
        pendingUID = store.user?.uid
        pendingToken = UUID()
        if store.user == nil {
            signInPresentationToken = pendingToken
            signInAwaitingDismissal = true
            showSignIn = true
        } else { resumePendingAction() }
    }

    private func signInSheetDismissed() {
        NativeAnalytics.track(.screen(currentAnalyticsScreen))
        let token = signInPresentationToken
        signInPresentationToken = nil
        signInAwaitingDismissal = false
        guard isVisible, token == pendingToken, pendingPlaceID == place.id,
              let user = store.user, !user.isAnonymous, !store.authBusy,
              pendingUID == user.uid else {
            clearPendingAction()
            return
        }
        resumePendingAction()
    }

    private func resumePendingAction() {
        guard pendingReady, let action = pendingAction, let uid = store.user?.uid else { return }
        let expectedPlace = place.id
        clearPendingAction()
        switch action {
        case .contribution(let destination):
            form = destination
        case .rating(let stars):
            // Restore the explicitly chosen draft. Provider selection never submits a vote.
            ratingDraft = stars
            ratingChanged = true
            ratingSaved = false
        case .save:
            // A sign-in continuation means Save, never toggle an existing save off.
            guard !store.savedIDs.contains(expectedPlace) else { return }
            Task {
                guard isVisible, place.id == expectedPlace, store.user?.uid == uid,
                      !store.privateLoading, store.libraryError == nil,
                      !store.savedIDs.contains(expectedPlace) else { return }
                _ = await store.toggleSaved(place)
            }
        case .verify(let report):
            // Preserve the exact version chosen before sign-in; this opens consent only.
            guard report.placeID == expectedPlace else { return }
            verifyPublic = report
        case .feedback(let report, let vote):
            guard report.placeID == expectedPlace,
                  let current = store.codeEvidence.first(where: { $0.id == report.id && $0.placeID == expectedPlace }),
                  current.version == report.version, current.code == report.code, current.canGiveFeedback else { return }
            feedbackVote = vote
            feedbackReport = current
        case .reportContent(let target):
            guard target.placeID == expectedPlace else { return }
            store.error = nil
            contentReportTarget = target
        }
    }

    private func openContribution(_ destination: DetailForm) {
        requestAction(.contribution(destination))
    }

    private func knownText(_ value: String?) -> String? {
        guard let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return value
    }

    private func knownAnswer(_ value: String?) -> String? {
        guard let value, ["yes", "no"].contains(value) else { return nil }
        return RRLabels.answer(value)
    }

    private var hasEntryFacts: Bool {
        ["public", "customers"].contains(place.entryRule ?? "")
            || purchaseRequirementReport != nil
            || knownText(place.reportedRestroomHours) != nil
            || knownAnswer(place.passcodeRequired) != nil
            || knownText(place.publishedStatus) != nil
            || knownText(place.seasonality) != nil
            || knownText(place.communityNotes ?? place.accessNotes) != nil
    }

    private var hasRouteFacts: Bool {
        let details = knownAccessDetails
        return knownText(details?.entranceLocation) != nil
            || knownAnswer(details?.entranceStepFree) != nil
            || (accessDetailsState == nil && knownAnswer(place.stairFreeRouteAnswer) != nil)
            || knownText(details?.restroomFloor) != nil || details?.stairsAfterEntry != nil
            || knownAnswer(details?.elevatorToRestroom) != nil || knownText(details?.elevatorNote) != nil
            || place.isReportedAccessible
            || (accessDetailsState == nil && place.hasReportedElevator(reviewedPlaceIDs: research?.reportedElevatorPlaceIDs ?? []))
    }

    @ViewBuilder private var entry: some View {
        if let rule = place.entryRule, ["public", "customers"].contains(rule) {
            RRFact(label: "Entry permission", value: RRLabels.entry(rule))
        }
        if let report = purchaseRequirementReport {
            VStack(alignment: .leading, spacing: 4) {
                RRFact(label: "Purchase required", value: RRLabels.answer(report.purchaseRequired))
                Text("Visitor observed \(listingDate(report.observedAt, calendarOnly: false))")
                    .font(.caption).foregroundStyle(RRStyle.faint)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("access-purchase-required")
        }
        if let hours = knownText(place.reportedRestroomHours) {
            RRFact(label: "Restroom hours", value: hours).accessibilityIdentifier("access-restroom-hours")
        }
        if let answer = knownAnswer(place.passcodeRequired) { RRFact(label: "Code required", value: answer) }
        if let status = knownText(place.publishedStatus) { RRFact(label: "Listed status", value: status) }
        if let seasonality = knownText(place.seasonality) { RRFact(label: "Seasonality", value: seasonality) }
        if let notes = knownText(place.communityNotes ?? place.accessNotes) {
            RRFact(label: "Access notes", value: notes)
        }
    }

    @ViewBuilder private var route: some View {
        if let entrance = knownText(knownAccessDetails?.entranceLocation) {
            RRFact(label: "Entrance", value: entrance).accessibilityIdentifier("access-entrance-location")
        }
        if let answer = knownAnswer(knownAccessDetails?.entranceStepFree) { RRFact(label: "Step-free entrance", value: answer) }
        if accessDetailsState == nil, let answer = knownAnswer(place.stairFreeRouteAnswer) { RRFact(label: "Stair-free route", value: answer) }
        if let floor = knownText(knownAccessDetails?.restroomFloor) {
            RRFact(label: "Restroom floor", value: floor).accessibilityIdentifier("access-restroom-floor")
        }
        if let stairs = knownAccessDetails?.stairsAfterEntry {
            RRFact(label: "Stairs after entry", value: String(stairs)).accessibilityIdentifier("access-stairs-after-entry")
        }
        if let answer = knownAnswer(knownAccessDetails?.elevatorToRestroom) {
            RRFact(label: "Elevator to restroom", value: answer)
        } else if accessDetailsState == nil, place.hasReportedElevator(reviewedPlaceIDs: research?.reportedElevatorPlaceIDs ?? []) {
            RRFact(label: "Elevator to restroom", value: "Reported")
        }
        if let note = knownText(knownAccessDetails?.elevatorNote) {
            RRFact(label: "Elevator route", value: note).accessibilityIdentifier("access-elevator-route")
        }
        if place.isReportedAccessible { RRFact(label: "Accessible", value: "Reported") }
    }

    @ViewBuilder private var accessDetailsSource: some View {
        if let state = accessDetailsState {
            Section("Entrance and route source") {
                if store.accessDetailsLoading { ProgressView(state) }
                else {
                    RRIssue(message: store.accessDetailsFeedError ?? state)
                    Button("Retry entrance and route details") { store.reloadPublic() }
                        .frame(minHeight: 44, alignment: .leading).buttonStyle(.borderless)
                }
            }
        } else if let details = knownAccessDetails {
            Section("Entrance and route source") {
                RRFact(label: "Source", value: details.sourceTitle)
                RRTime(label: "Reported on", date: details.reportedAt)
                    .accessibilityIdentifier("access-reported-date")
                RRTime(label: "Observed on", date: details.observedOn)
                    .accessibilityIdentifier("access-observed-date")
                RRTime(label: "Record updated", date: details.updatedAt)
                    .accessibilityIdentifier("access-updated-date")
                Text("The record update is not an inspection time. \(details.limitations)")
                    .font(RRStyle.body(14)).foregroundStyle(RRStyle.faint)
            }
        }
    }

    private var conditions: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let type = knownText(place.restroomType) { RRFact(label: "Restroom type", value: type) }
            if let stations = knownText(place.changingStations) { RRFact(label: "Changing stations", value: stations) }
            Text("Accessibility reports do not confirm stall features, entry permission or current availability.")
                .font(.footnote).foregroundStyle(RRStyle.faint)
        }
    }

    private var codeCard: some View {
        Group {
            let visible = CodeEvidencePresentation.visiblePublic(in: store.codeEvidence.filter { $0.placeID == place.id },
                feedsReady: !store.codeEvidenceLoading && store.codeEvidenceError == nil)
            if store.codeEvidenceLoading { ProgressView("Loading passcodes…") }
            ForEach(Array(visible.enumerated()), id: \.element.id) { index, report in
                publicCodeCard(report, newest: index == 0)
            }
            ForEach(researchCodeClaims.filter { claim in !visible.contains { $0.code == claim.value } }) { claim in
                VStack(alignment: .leading, spacing: 8) {
                    Text("Published code claim").font(.caption).foregroundStyle(RRStyle.faint)
                    codeText(claim.value)
                    researchFactRow(claim)
                    Text("Unverified source claim; not a successful-use report.").font(.caption).foregroundStyle(RRStyle.faint)
                }.padding(16).background(RRStyle.surface, in: RoundedRectangle(cornerRadius: 18))
            }
            if let profile = cardResearch {
                ForEach(profile.facts(in: "passcodes").filter { $0.field != "passcode" }) { fact in researchFactRow(fact) }
            }
            if !store.codeEvidenceLoading && !store.researchProfileLoading && store.researchProfileError == nil && store.codeEvidenceError == nil && store.codeFeedError == nil && visible.isEmpty && researchCodeClaims.isEmpty {
                Text("No known public passcode").font(.subheadline).foregroundStyle(RRStyle.faint)
            }
            if let error = store.codeEvidenceError ?? store.codeFeedError {
                RRIssue(message: error)
                Button("Retry loading codes") { store.reloadSelectedPlace() }.frame(minHeight: 44).buttonStyle(.bordered)
            }
            if let own = ownCode, own.visibility == "private" { legacyPrivateCodeCard(own) }
            ForEach(store.ownCodeReports.filter { $0.placeID == place.id && $0.visibility == "private" }) { report in
                privateCodeCard(report)
            }
            if let error = store.ownCodeReportsError ?? store.ownCodeError { RRIssue(message: error) }
            Button { openContribution(.code) } label: {
                Label("Report a new code", systemImage: "plus")
                    .frame(maxWidth: .infinity, minHeight: 24)
                    .foregroundStyle(.white)
            }
            .buttonStyle(.borderedProminent).controlSize(.large).tint(RRStyle.ink)
            .accessibilityIdentifier("report-new-code")
            if visible.count > 1 {
                Text("4 confirmations on the newest report hide older codes; the latest verified code stays.")
                    .font(.caption).foregroundStyle(RRStyle.faint)
            }
            if hasHiddenOwnCode(visible: visible) {
                DisclosureGroup("Manage your earlier reports", isExpanded: analyticsExpansion(.codeOwnerHistory)) {
                    if let own = ownCode, own.visibility == "public", !visible.contains(where: { $0.source == .legacy && $0.reportID == own.reportID }) {
                        VStack(alignment: .leading, spacing: 10) { codeText(own.code); legacyOwnerActions(own) }.padding(.vertical, 8)
                    }
                    ForEach(store.ownCodeReports.filter { report in
                        report.placeID == place.id && report.visibility == "public" && !visible.contains(where: { $0.source == .report && $0.reportID == report.id })
                    }) { report in
                        VStack(alignment: .leading, spacing: 10) { codeText(report.code); codeOwnerActions(report) }.padding(.vertical, 8)
                    }
                }
                .font(.subheadline)
                .padding(16).background(RRStyle.surface, in: RoundedRectangle(cornerRadius: 18))
            }
            Text("Codes are visitor reports and can change.").font(.caption).foregroundStyle(RRStyle.faint)
        }
        .disabled(store.busy || store.authBusy)
    }

    private func hasHiddenOwnCode(visible: [CodeEvidence]) -> Bool {
        if let own = ownCode, own.visibility == "public", !visible.contains(where: { $0.source == .legacy && $0.reportID == own.reportID }) { return true }
        return store.ownCodeReports.contains { report in
            report.placeID == place.id && report.visibility == "public" && !visible.contains(where: { $0.source == .report && $0.reportID == report.id })
        }
    }

    private func publicCodeCard(_ report: CodeEvidence, newest: Bool) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(newest ? (report.verifiedAt == nil ? "Latest reported" : "Latest verified") : "Code report")
                    .font(.caption.weight(.medium)).foregroundStyle(RRStyle.faint)
                Spacer(minLength: 8)
                if report.isOwn { Text("Your report").font(.caption).foregroundStyle(RRStyle.faint) }
            }
            codeText(report.code)
            VStack(alignment: .leading, spacing: 4) {
                Text("Reported \(listingDate(report.updatedAt, calendarOnly: false))")
                Text(report.verifiedAt.map { "Last verified \(listingDate($0, calendarOnly: false))" }
                    ?? ((report.positiveCount ?? 0) > 0 ? "Verification date unknown" : "Not yet verified"))
            }.font(.caption).foregroundStyle(RRStyle.faint)
            if let worked = report.positiveCount, let invalid = report.invalidCount {
                HStack(spacing: 16) {
                    Label("\(worked) worked", systemImage: "checkmark.circle")
                    Label("\(invalid) didn’t work", systemImage: "xmark.circle")
                }.font(.caption).foregroundStyle(RRStyle.faint)
            }
            if !report.isOwn {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 8) { codeFeedbackButtons(report) }
                    VStack(alignment: .leading, spacing: 8) { codeFeedbackButtons(report) }
                }
                if let vote = report.currentFeedback {
                    Label(vote == .used ? "You reported it worked" : "You reported it didn’t work", systemImage: "checkmark")
                        .font(.caption).foregroundStyle(RRStyle.faint)
                }
            }
            if report.isOwn {
                if report.source == .legacy, let own = ownCode, own.reportID == report.reportID { legacyOwnerActions(own) }
                else if let own = store.ownCodeReports.first(where: { $0.id == report.reportID }) { codeOwnerActions(own) }
            }
            if report.visibility == "public" {
                contentReportButton(try? ContentReportTarget(kind: report.source == .legacy ? .legacyCode : .codeReport,
                    placeID: report.placeID, recordID: report.reportID, postedAt: report.version))
            }
            ForEach(researchCodeClaims.filter { $0.value == report.code }) { fact in
                researchFactRow(fact)
                Text("Published source claim; the verification above belongs only to this in-app code report.")
                    .font(.caption).foregroundStyle(RRStyle.faint)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16).background(RRStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }

    @ViewBuilder private func codeFeedbackButtons(_ report: CodeEvidence) -> some View {
        Button { requestAction(.feedback(report, .used)) } label: {
            Label("I used this code", systemImage: "checkmark.circle")
        }
        .buttonStyle(.bordered).controlSize(.large).tint(RRStyle.ink)
        .disabled(store.user != nil && !report.canGiveFeedback)
        .accessibilityIdentifier("code-used-" + report.id)
        Button { requestAction(.feedback(report, .invalid)) } label: {
            Label("Code didn’t work", systemImage: "xmark.circle")
        }
        .buttonStyle(.bordered).controlSize(.large).tint(RRStyle.ink)
        .disabled(store.user != nil && !report.canGiveFeedback)
        .accessibilityIdentifier("code-invalid-" + report.id)
    }

    private func legacyPrivateCodeCard(_ own: OwnPasscode) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Only me", systemImage: "lock").font(.caption).foregroundStyle(RRStyle.faint)
            codeText(own.code)
            Text(own.lastVerifiedAt.map { "Last verified \(listingDate($0, calendarOnly: false))" } ?? "Not yet verified")
                .font(.caption).foregroundStyle(RRStyle.faint)
            Button("I used this code", systemImage: "checkmark.circle") { confirmOwnVerification = true }
                .buttonStyle(.bordered).controlSize(.large)
            legacyOwnerActions(own)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(RRStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }

    private func privateCodeCard(_ report: OwnCodeReport) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Only me", systemImage: "lock").font(.caption).foregroundStyle(RRStyle.faint)
            codeText(report.code)
            Text(report.lastVerifiedAt.map { "Last verified \(listingDate($0, calendarOnly: false))" } ?? "Not yet verified")
                .font(.caption).foregroundStyle(RRStyle.faint)
            Button("I used this code", systemImage: "checkmark.circle") { Task { _ = await store.verifyOwnCodeReport(report) } }
                .buttonStyle(.bordered).controlSize(.large)
            codeOwnerActions(report)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(16)
            .background(RRStyle.surface, in: RoundedRectangle(cornerRadius: 18))
    }

    @ViewBuilder private func legacyOwnerActions(_ own: OwnPasscode) -> some View {
        Button("Change visibility", systemImage: "eye") { editLegacyCode = true }
            .buttonStyle(.bordered).controlSize(.large)
            .disabled(store.ownCodeLoading || store.ownCodeError != nil)
        Button("Delete my code", role: .destructive) { confirmCodeDelete = true }
            .buttonStyle(.bordered).controlSize(.large)
            .disabled(store.ownCodeLoading || store.ownCodeError != nil)
    }

    @ViewBuilder private func codeOwnerActions(_ report: OwnCodeReport) -> some View {
        Button("Change visibility", systemImage: "eye") { editReportedCode = report }
            .buttonStyle(.bordered).controlSize(.large)
            .disabled(store.ownCodeReportsLoading || store.ownCodeReportsError != nil)
        Button("Delete my report", role: .destructive) { deleteReportedCode = report }
            .buttonStyle(.bordered).controlSize(.large)
            .disabled(store.ownCodeReportsLoading || store.ownCodeReportsError != nil)
    }

    private func codeText(_ code: String) -> some View {
        Text(code).font(RRStyle.mono(24, weight: .semibold, relativeTo: .title2))
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .accessibilityLabel("Restroom code: \(code.map(String.init).joined(separator: " "))")
    }

    private var ratingEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your rating").font(.subheadline.weight(.semibold))
            HalfStarRating(value: Binding(get: { ratingDraft }, set: {
                ratingDraft = $0; ratingChanged = $0 != nil; ratingSaved = false
            }))
            if store.user != nil {
                if store.ownRatingLoading { ProgressView("Loading your rating…") }
                if let error = store.ownRatingError {
                    RRIssue(message: error)
                    Button("Retry loading rating") { store.reloadSelectedPlace() }
                        .frame(minHeight: 44).buttonStyle(.borderless)
                }
            }
            if ratingChanged, ratingDraft != nil {
                Button(action: submitRating) {
                    RRProminentButtonLabel(title: store.busy ? "Saving…" : "Submit rating")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(store.user != nil && (store.privateLoading || store.ownRatingLoading || store.ownRatingError != nil))
                .accessibilityIdentifier("save-rating")
            }
            if ratingSaved { Text("Rating saved").font(.caption).foregroundStyle(RRStyle.faint) }
        }
        .padding(.bottom, 12)
        .disabled(store.busy || store.authBusy)
    }

    private func submitRating() {
        guard let stars = ratingDraft, ratingChanged, !store.busy, !store.authBusy else { return }
        guard let uid = store.user?.uid else { requestAction(.rating(stars)); return }
        guard !store.privateLoading, !store.ownRatingLoading, store.ownRatingError == nil else { return }
        let placeID = place.id
        Task {
            guard isVisible, place.id == placeID, store.user?.uid == uid, ratingDraft == stars else { return }
            let saved = await store.rate(placeID: placeID, stars: stars)
            guard saved, isVisible, place.id == placeID, store.user?.uid == uid, ratingDraft == stars else { return }
            ratingDraft = nil; ratingChanged = false; ratingSaved = true
        }
    }

    private var ratings: some View {
        Section("Cleanliness rating") {
            Group {
                if let summary = store.ratings[place.id], summary.ratingCount > 0 {
                    HStack {
                        Label("\(summary.average.formatted(.number.precision(.fractionLength(1)))) of 5", systemImage: "star.fill")
                            .font(.body.weight(.semibold))
                        Spacer(minLength: 8)
                        Text("\(summary.ratingCount) rating\(summary.ratingCount == 1 ? "" : "s")")
                            .font(.subheadline).foregroundStyle(RRStyle.faint)
                    }
                    .accessibilityElement(children: .combine)
                } else if store.ratingsLoading { ProgressView("Loading public ratings…") }
                else if store.ratingsFeedError == nil { Text("No ratings yet").foregroundStyle(RRStyle.faint) }
                if let error = store.ratingsFeedError {
                    RRIssue(message: error)
                    Button("Retry public ratings") { store.reloadPublic() }.frame(minHeight: 44, alignment: .leading).buttonStyle(.borderless)
                }
                if store.user != nil {
                    if store.ownRatingLoading { ProgressView("Loading your rating…") }
                    if let error = store.ownRatingError {
                        RRIssue(message: error)
                        Button("Retry loading rating") { store.reloadSelectedPlace() }.frame(minHeight: 44, alignment: .leading).buttonStyle(.borderless)
                    } else if !store.ownRatingLoading {
                        if let ownStars = store.ownStars {
                            RRFact(label: "Your saved rating", value: "\(ownStars.formatted(.number.precision(.fractionLength(0...1)))) of 5")
                            Button("Remove my rating", role: .destructive) {
                                Task { if await store.rate(placeID: place.id, stars: nil) { ratingChanged = false; ratingDraft = nil; ratingSaved = false } }
                            }.frame(minHeight: 44, alignment: .leading).buttonStyle(.borderless)
                        }
                    }
                }
            }
            .disabled(store.busy || store.authBusy || (store.user != nil && store.privateLoading))
            ratingEditor
        }
    }

    private func visitReportRow(_ report: VisitReport) -> some View {
        DisclosureGroup(isExpanded: analyticsExpansion(.visitorNote, key: "visit-" + report.id)) {
            VStack(alignment: .leading, spacing: 12) {
                RRTime(label: "Observed on", date: report.observedAt)
                RRTime(label: "Submitted on", date: report.submittedAt)
                if !report.comment.isEmpty { Text(report.comment).textSelection(.enabled) }
                if report.entryRule != "not-reported" { RRFact(label: "Entry permission", value: RRLabels.entry(report.entryRule)) }
                if report.purchaseRequired != "not-reported" { RRFact(label: "Purchase required", value: RRLabels.answer(report.purchaseRequired)) }
                if report.codeRequired != "not-reported" { RRFact(label: "Code required", value: RRLabels.answer(report.codeRequired)) }
                if report.floor != "not-reported" { RRFact(label: "Restroom floor", value: RRLabels.floor(report.floor)) }
                if report.stairs != "not-reported" { RRFact(label: "Stairs after entry", value: RRLabels.answer(report.stairs)) }
                if report.elevatorPresent != "not-reported" { RRFact(label: "Elevator present", value: RRLabels.answer(report.elevatorPresent)) }
                if report.automaticDoorPresent != "not-reported" { RRFact(label: "Automatic door present", value: RRLabels.answer(report.automaticDoorPresent)) }
                if report.soap != "not-reported" { RRFact(label: "Soap present", value: RRLabels.answer(report.soap)) }
                if report.toiletPaper != "not-reported" { RRFact(label: "Toilet paper present", value: RRLabels.answer(report.toiletPaper)) }
                if report.condition != "not-reported" { RRFact(label: "Condition", value: RRLabels.condition(report.condition)) }
                if store.user != nil && store.ownVisitIDs.contains(report.id) {
                    Button("Remove my public note", role: .destructive) { deleteVisit = report }.frame(minHeight: 44, alignment: .leading).buttonStyle(.borderless).disabled(store.busy)
                }
                if report.source == .unified {
                    contentReportButton(try? ContentReportTarget(kind: .unifiedVisit, placeID: report.placeID,
                        recordID: report.reportID,
                        postedAt: "\(report.submissionTimestamp.seconds):\(report.submissionTimestamp.nanoseconds)"))
                }
            }.padding(.vertical, 12)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text(report.anonymous ? "Anonymous" : (report.authorName ?? "Anonymous")).font(.subheadline.weight(.semibold))
                Text("Visited \(report.observedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(RRStyle.faint)
            }
        }
    }

    @ViewBuilder private var sourceReports: some View {
        if let research, !research.reports(for: place.id).isEmpty {
            Section("Published source reports") {
                Text("Attributed source information, separate from visitor observations.").font(RRStyle.body(15)).foregroundStyle(RRStyle.faint)
                ForEach(research.reports(for: place.id)) { report in
                    DisclosureGroup(report.venueLabel, isExpanded: analyticsExpansion(.sourceReference, key: "report-" + report.id)) {
                        if let source = research.source(for: report) {
                            Text(source.title).font(RRStyle.body(15, weight: .semibold))
                            RRFact(label: RRLabels.sourceDate(source.dateKind), value: source.publishedOn)
                            ForEach(report.facts, id: \.self) { RRFact(label: RRLabels.sourceFact($0.field), value: $0.value) }
                            RRFact(label: "Source report date", value: report.reportedOn)
                            RRFact(label: "Observation date", value: nil)
                            Text(report.limitations.hasPrefix("Preserve venueLabel.")
                                 ? "These details apply only to the named restroom. Other restrooms in this listing may have separate hours."
                                 : report.limitations).font(RRStyle.body(14)).foregroundStyle(RRStyle.faint)
                            Text(source.limitations).font(RRStyle.body(14)).foregroundStyle(RRStyle.faint)
                            if let url = URL(string: source.url), ["https", "http"].contains(url.scheme?.lowercased() ?? "") {
                                Link("Read source", destination: url).frame(minHeight: 44, alignment: .leading)
                                    .environment(\.openURL, analyticsSourceAction)
                            }
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func researchFactRows(_ facts: [CardResearchFact]) -> some View {
        let issues = facts.filter { $0.field == "inspectionIssue" }
        let details = facts.filter { ["conditionDetail", "inspectionFeatureRating"].contains($0.field) }
        let fixtures = facts.filter { $0.field == "inspectionFixtureCount" }
        let primary = facts.filter { !["inspectionIssue", "conditionDetail", "inspectionFeatureRating", "inspectionFixtureCount"].contains($0.field) }
        if !issues.isEmpty {
            DisclosureGroup(isExpanded: analyticsExpansion(.reportedIssues, key: facts.first?.id ?? "")) {
                ForEach(issues) { fact in researchFactRow(fact) }
            } label: {
                Text("Reported issues (\(issues.count))").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        }
        ForEach(primary) { fact in researchFactRow(fact) }
        if !fixtures.isEmpty {
            DisclosureGroup(isExpanded: analyticsExpansion(.fixtureInventory, key: facts.first?.id ?? "")) {
                ForEach(fixtures) { fact in researchFactRow(fact) }
            } label: {
                Text("Fixture inventory (\(fixtures.count))").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        }
        if !details.isEmpty {
            DisclosureGroup(isExpanded: analyticsExpansion(.inspectionDetails, key: facts.first?.id ?? "")) {
                ForEach(details) { fact in researchFactRow(fact) }
            } label: {
                Text("Inspection details (\(details.count))").frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        }
    }

    @ViewBuilder private func researchFactRow(_ fact: CardResearchFact) -> some View {
        if let source = cardResearch?.source(for: fact) {
            DisclosureGroup(isExpanded: analyticsExpansion(.sourceReference, key: "fact-" + fact.id)) {
                researchSourceDetails(source)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Text(fact.field == "facilityAccessibility" ? "Building accessibility — directory" : fact.label).font(.caption).foregroundStyle(RRStyle.faint)
                    Text(fact.displayValue).font(.subheadline).fixedSize(horizontal: false, vertical: true)
                    Text(source.caption).font(.caption).foregroundStyle(RRStyle.faint)
                    if fact.scope == "venue" { Text("Venue information; restroom access may differ.").font(.caption).foregroundStyle(RRStyle.faint) }
                    else if fact.scope == "building" || fact.field == "facilityAccessibility" { Text("Building information; the restroom route is not confirmed by this fact.").font(.caption).foregroundStyle(RRStyle.faint) }
                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
            .tint(RRStyle.ink)
            .padding(.vertical, 6)
            .accessibilityIdentifier("research-fact-" + fact.id)
        }
    }

    private func researchSourceDetails(_ source: CardResearchSource) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(source.title).font(.subheadline.weight(.medium))
            if let date = source.observedOn { RRFact(label: source.kind == "inspection" ? "Inspection date" : "Observation date", value: CardResearchProfile.displayDay(date)) }
            RRFact(label: "Publication date", value: source.publishedOn.map(CardResearchProfile.displayDay) ?? "Not shown")
            if !source.displayedDate.isEmpty { RRFact(label: "Date shown by source", value: source.displayedDate) }
            RRFact(label: "Retrieved", value: source.retrievedAt)
            Text(source.limitations).font(.caption).foregroundStyle(RRStyle.faint).fixedSize(horizontal: false, vertical: true)
            if let url = URL(string: source.url) { Link("Open source", destination: url).frame(minHeight: 44, alignment: .leading).environment(\.openURL, analyticsSourceAction) }
        }.padding(.vertical, 8)
    }

    @ViewBuilder private var researchSources: some View {
        if let profile = cardResearch, !profile.sources.isEmpty {
            Section("Sources for reported details") {
                ForEach(profile.sources) { source in
                    DisclosureGroup(source.title, isExpanded: analyticsExpansion(.sourceReference, key: "source-" + source.id)) { researchSourceDetails(source) }
                }
            }
        }
    }

    @ViewBuilder private var sourcedCommentRows: some View {
        if let profile = cardResearch {
            ForEach(profile.comments) { comment in
                if let source = profile.source(id: comment.sourceID) {
                    DisclosureGroup(isExpanded: analyticsExpansion(.sourceComments, key: "research-" + comment.id)) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(comment.text).textSelection(.enabled)
                            researchSourceDetails(source)
                            contentReportButton(try? ContentReportTarget.imported(kind: .researchComment,
                                placeID: place.id, recordID: comment.id, text: comment.text))
                        }.padding(.vertical, 8)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Anonymous").font(.subheadline.weight(.semibold))
                            Text(source.caption).font(.caption).foregroundStyle(RRStyle.faint)
                            Text(comment.text).font(.subheadline).lineLimit(3)
                        }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("research-comment-" + comment.id)
                    }
                }
            }
        }
        ForEach(store.sourceComments.filter { $0.placeID == place.id && !coveredSourceCommentIDs.contains($0.id) }) { comment in
            DisclosureGroup(isExpanded: analyticsExpansion(.sourceComments, key: "published-" + comment.id)) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(comment.text).textSelection(.enabled)
                    RRFact(label: "Source", value: comment.sourceTitle)
                    RRFact(label: "Date shown by source", value: comment.displayedDate)
                    RRFact(label: "Publication date", value: comment.publishedOn ?? "Not shown")
                    Text(comment.limitations).font(.caption).foregroundStyle(RRStyle.faint)
                    if let url = comment.sourceURL { Link("Open source", destination: url).frame(minHeight: 44, alignment: .leading).environment(\.openURL, analyticsSourceAction) }
                    contentReportButton(try? ContentReportTarget.imported(kind: .sourceComment,
                        placeID: comment.placeID, recordID: comment.id, text: comment.text))
                }.padding(.vertical, 8)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Anonymous").font(.subheadline.weight(.semibold))
                    Text("From \(comment.sourceTitle) · \(comment.publishedOn.map(CardResearchProfile.displayDay) ?? "Publication date not shown")")
                        .font(.caption).foregroundStyle(RRStyle.faint)
                    Text(comment.text).font(.subheadline).lineLimit(3)
                }.frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            }
        }
    }

    private var publicNoteCard: some View {
        Section {
            Button("Add a public note", systemImage: "square.and.pencil") { openContribution(.visit) }
                .frame(minHeight: 44).disabled(store.busy || store.authBusy)
                .accessibilityIdentifier("add-public-note")
            if store.publicNotesLoading { ProgressView("Loading visitor notes…") }
            if store.detailsLoading && !store.publicNotesLoading { ProgressView("Loading visitor notes…") }
            ForEach(visitorEntries) { entry in
                switch entry {
                case .note(let note): publicNoteRow(note)
                case .report(let report): visitReportRow(report)
                }
            }
            sourcedCommentRows
            if !store.publicNotesLoading && !store.detailsLoading && !store.researchProfileLoading && visitorEntries.isEmpty && (cardResearch?.comments.isEmpty ?? true) && store.sourceComments.filter({ $0.placeID == place.id && !coveredSourceCommentIDs.contains($0.id) }).isEmpty && store.publicNotesFeedError == nil && store.visitFeedError == nil && store.sourceFeedError == nil && store.researchProfileError == nil {
                Text("No visitor notes yet.").foregroundStyle(RRStyle.faint)
            }
            if let error = store.publicNotesFeedError {
                RRIssue(message: error)
                Button("Retry loading notes") { store.reloadSelectedPlace() }.frame(minHeight: 44)
            }
            if let error = store.visitFeedError {
                RRIssue(message: error)
                Button("Retry loading notes") { store.reloadSelectedPlace() }.frame(minHeight: 44)
            }
            if let error = store.ownPublicNotesError, store.user != nil {
                RRIssue(message: error)
                Button("Refresh note ownership") { store.reloadSelectedPlace() }.frame(minHeight: 44)
            }
            if let error = store.sourceFeedError ?? store.researchProfileError {
                RRIssue(message: error)
                Button("Retry published comments") { store.reloadSelectedPlace() }.frame(minHeight: 44)
            }
        } header: {
            Text("Visitor notes")
        } footer: {
            Text("Notes and observations are public. Names appear only when Anonymous is off. Published comments retain their source dates and are not new visits.")
        }
    }

    private func publicNoteRow(_ note: PublicNote) -> some View {
        DisclosureGroup(isExpanded: analyticsExpansion(.visitorNote, key: "note-" + note.id)) {
            VStack(alignment: .leading, spacing: 12) {
                RRTime(label: "Observed on", date: note.observedAt)
                RRTime(label: "Posted on", date: note.submittedAt)
                if !note.body.isEmpty { Text(note.body).textSelection(.enabled) }
                if note.condition != "not-reported" { RRFact(label: "Condition", value: RRLabels.condition(note.condition)) }
                if note.soap != "not-reported" { RRFact(label: "Soap", value: RRLabels.answer(note.soap)) }
                if note.toiletPaper != "not-reported" { RRFact(label: "Toilet paper", value: RRLabels.answer(note.toiletPaper)) }
                if note.stairs != "not-reported" { RRFact(label: "Stairs after entry", value: RRLabels.answer(note.stairs)) }
                if store.user != nil && store.ownPublicNoteIDs.contains(note.id) {
                    Button("Remove my note", role: .destructive) { deleteNote = note }
                        .frame(minHeight: 44).disabled(store.busy || store.authBusy || store.ownPublicNotesLoading || store.ownPublicNotesError != nil)
                }
                contentReportButton(try? ContentReportTarget(kind: .publicNote, placeID: note.placeID,
                    recordID: note.id, postedAt: "\(note.submissionTimestamp.seconds):\(note.submissionTimestamp.nanoseconds)"))
            }.padding(.vertical, 12)
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                Text("Anonymous").font(.subheadline.weight(.semibold))
                Text("Visited \(note.observedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption).foregroundStyle(RRStyle.faint)
            }
        }
    }

    @ViewBuilder private func contentReportButton(_ target: ContentReportTarget?) -> some View {
        if let target {
            Button { requestAction(.reportContent(target)) } label: {
                Label("Report inappropriate content", systemImage: "flag")
                    .font(.subheadline)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
                .buttonStyle(.borderless)
                .disabled(store.busy || store.authBusy)
                .accessibilityIdentifier("report-content-" + target.kind.rawValue + "-" + target.recordID)
        }
    }

    private var provenance: some View {
        VStack(alignment: .leading, spacing: 12) {
            if place.isCommunity {
                RRFact(label: "Source", value: "Community location report — see access notes for attribution")
                RRDate(label: "Observed on", date: place.observedOn)
                RRTime(label: "Submitted on", date: place.submittedAt)
                Text("Submission time is not an inspection date. Contributor account identities are private.").font(RRStyle.body(14)).foregroundStyle(RRStyle.faint)
            } else {
                RRFact(label: "Source", value: citySource?.title ?? "NYC Open Data public restroom directory")
                RRFact(label: "Directory updated", value: citySource?.dataUpdatedAt)
                RRFact(label: "Collection retrieved", value: citySource?.retrievedAt)
                RRFact(label: "Source record", value: place.sourceRecordId)
                if let raw = place.sourceUrl ?? citySource?.url, let url = URL(string: raw) { Link("View NYC source", destination: url).frame(minHeight: 44, alignment: .leading).environment(\.openURL, analyticsSourceAction) }
                Text("Retrieval is not an inspection date. Earlier published details may have changed.").font(RRStyle.body(14)).foregroundStyle(RRStyle.faint)
            }
        }
    }

}
