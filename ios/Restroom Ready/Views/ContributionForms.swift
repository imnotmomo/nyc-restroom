import SwiftUI

struct PublicNoteForm: View {
    @Environment(\.dismiss) private var dismiss
    let store: NativeStore
    let place: Place
    @State private var draft = PublicNoteDraft()
    @State private var attempt: PublicNoteDraft?
    @State private var dateChanged = false

    private var isDirty: Bool {
        dateChanged || !draft.body.isEmpty ||
        [draft.condition, draft.soap, draft.toiletPaper, draft.stairs].contains { $0 != "not-reported" }
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                Section {
                    Text(place.name).font(.headline)
                    DatePicker("Visited", selection: $draft.observedAt, in: Date(timeIntervalSince1970: 946_684_800)...Date(), displayedComponents: [.date, .hourAndMinute])
                } footer: {
                    Text("Your note, answers and visit time are public under Anonymous. Your account identity stays private. Share only what you observed; leave out personal information and passcodes.")
                }
                .disabled(attempt != nil)

                Section("What you noticed") {
                    Picker("Condition", selection: $draft.condition) {
                        Text("Not reported").tag("not-reported")
                        Text("Usable").tag("usable")
                        Text("Needs attention").tag("needs-attention")
                    }.pickerStyle(.navigationLink)
                    AnswerPicker(title: "Soap present", selection: $draft.soap)
                    AnswerPicker(title: "Toilet paper present", selection: $draft.toiletPaper)
                    AnswerPicker(title: "Stairs after entry", selection: $draft.stairs)
                }
                .disabled(attempt != nil)

                Section {
                    RRField("Public visit note") {
                        TextField("What did you notice?", text: $draft.body, axis: .vertical)
                            .lineLimit(3...8)
                            .textInputAutocapitalization(.sentences)
                            .accessibilityIdentifier("public-note-body")
                    }
                    if draft.body.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 1_000 {
                        RRIssue(message: "Keep your public note within 1,000 characters.")
                    }
                    if !PublicTextSafety.allows(draft.body) {
                        RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                    }
                } footer: {
                    Text("Write a note or choose at least one observed detail. Leave unknown details as Not reported. Public notes can contain up to 1,000 characters.")
                }
                .disabled(attempt != nil)

                if let error = store.error { Section { RRIssue(message: error) } }
                if attempt != nil {
                    Section { RRInfo(message: "Your exact public note is kept for a safe retry. A failed response does not prove sharing failed.") }
                }
            }
            .disabled(store.busy || store.authBusy || store.user == nil)
            .navigationTitle("Public visit note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Sharing…" : attempt == nil ? "Share" : "Retry") { save() }
                        .fontWeight(.semibold)
                        .disabled(store.busy || store.authBusy || store.user == nil || (attempt == nil && (try? draft.fields()) == nil))
                        .accessibilityIdentifier("share-public-note")
                }
            }
            .rrFormDismissal(isDirty: isDirty, busy: store.busy, hasAttempt: attempt != nil, onCancel: { NativeAnalytics.track(.formCancel(.visitNote)) })
            .rrFormAnalytics(.visitNote, screen: .visitNote)
            .onChange(of: draft.observedAt) { _, _ in dateChanged = true }
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
        }
    }

    private func save() {
        if attempt == nil { attempt = draft }
        guard let attempt else { return }
        Task { if await store.savePublicNote(placeID: place.id, draft: attempt) { dismiss() } }
    }
}

struct PublicVisitForm: View {
    @Environment(\.dismiss) private var dismiss
    let store: NativeStore
    let place: Place
    private let reportingProblem: Bool
    #if DEBUG
    private let previewOnly: Bool
    init(store: NativeStore, place: Place, reportingProblem: Bool = false, previewOnly: Bool = false) {
        self.store = store; self.place = place; self.reportingProblem = reportingProblem; self.previewOnly = previewOnly
    }
    #else
    private let previewOnly = false
    init(store: NativeStore, place: Place, reportingProblem: Bool = false) {
        self.store = store; self.place = place; self.reportingProblem = reportingProblem
    }
    #endif
    @State private var draft = VisitDraft()
    @State private var attempt: VisitDraft?
    @State private var dateChanged = false
    @State private var code = ""
    @State private var codeVisibility = "private"
    @State private var codeReportID = NativeIDs.make()

    private var accountName: String? {
        #if DEBUG
        if previewOnly { return "Review Tester" }
        #endif
        guard let name = store.user?.displayName, UnifiedVisitFields.validAuthorName(name), PublicTextSafety.allows(name) else { return nil }
        return name
    }

    private var hasObservation: Bool {
        [draft.entryRule, draft.purchaseRequired, draft.codeRequired, draft.floor, draft.stairs,
         draft.elevatorPresent, draft.automaticDoorPresent, draft.soap, draft.toiletPaper, draft.condition]
            .contains { $0 != "not-reported" }
    }
    private var hasComment: Bool { !draft.comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var hasCode: Bool { draft.codeRequired == "yes" && !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var validCode: Bool {
        !hasCode || ((try? CodeReportFields(code: code, visibility: codeVisibility)) != nil
            && PublicTextSafety.allowsCodeSharing(code, visibility: codeVisibility))
    }
    private var validComment: Bool {
        draft.comment.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= 1_000 && PublicTextSafety.allows(draft.comment)
    }
    private var validatedFields: UnifiedVisitFields? {
        guard validComment else { return nil }
        return try? UnifiedVisitFields(observedAt: draft.observedAt, entryRule: draft.entryRule,
            purchaseRequired: draft.purchaseRequired, codeRequired: draft.codeRequired, stairs: draft.stairs,
            soap: draft.soap, toiletPaper: draft.toiletPaper, floor: draft.floor, condition: draft.condition,
            elevatorPresent: draft.elevatorPresent, automaticDoorPresent: draft.automaticDoorPresent,
            comment: draft.comment, anonymous: draft.anonymous, authorName: draft.anonymous ? nil : accountName)
    }
    private var valid: Bool { validatedFields != nil && validCode }
    private var isDirty: Bool {
        hasObservation || !draft.comment.isEmpty || !code.isEmpty || !draft.anonymous || dateChanged
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                Section {
                    Text(place.name).font(.headline)
                    DatePicker("Visited", selection: $draft.observedAt, in: Date(timeIntervalSince1970: 946_684_800)...Date(), displayedComponents: [.date, .hourAndMinute])
                        .accessibilityIdentifier("visit-observed-at")
                    Toggle("Anonymous", isOn: $draft.anonymous)
                        .disabled(accountName == nil)
                        .accessibilityIdentifier("visit-anonymous")
                    if !draft.anonymous, let accountName {
                        Text("Posting as \(accountName)").font(.footnote).foregroundStyle(RRStyle.faint)
                    }
                } footer: {
                    Text(draft.anonymous
                         ? "Your note and observations will be public under Anonymous."
                         : "Your note, observations and account display name will be public.")
                }
                .disabled(attempt != nil)

                Section {
                    RRField(reportingProblem ? "Problem or correction (optional)" : "Public note (optional)") {
                        TextField(reportingProblem ? "What is incorrect or missing?" : "What did you notice?", text: $draft.comment, axis: .vertical)
                            .lineLimit(3...6)
                            .textInputAutocapitalization(.sentences)
                            .accessibilityIdentifier("visit-comment")
                    }
                    if draft.comment.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count > 1_000 {
                        RRIssue(message: "Keep your note within 1,000 characters.")
                    }
                    if !PublicTextSafety.allows(draft.comment) {
                        RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                    }
                } footer: {
                    if reportingProblem { Text("Your report appears in the visitor notes; it does not change the listing automatically.") }
                    Text("Leave personal information and entry codes out of your public note.")
                }
                .disabled(attempt != nil)

                Section {
                    Picker("Entry permission", selection: $draft.entryRule) {
                        Text("Not reported").tag("not-reported")
                        Text("Public entry").tag("public")
                        Text("Customers only").tag("customers")
                    }.pickerStyle(.navigationLink)
                    AnswerPicker(title: "Purchase required", selection: $draft.purchaseRequired)
                    AnswerPicker(title: "Code required", selection: $draft.codeRequired)
                        .accessibilityIdentifier("visit-code-required")
                    if draft.codeRequired == "yes" {
                        RRField("Restroom code (optional)") {
                            TextField("Enter the code", text: $code)
                                .font(.body.monospaced())
                                .keyboardType(.asciiCapable)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .accessibilityIdentifier("visit-optional-code")
                        }
                        if hasCode { CodeVisibilityPicker(visibility: $codeVisibility) }
                        if !validCode {
                            RRIssue(message: PublicTextSafety.allowsCodeSharing(code, visibility: codeVisibility)
                                ? "Use up to 40 letters, digits or keypad symbols."
                                : PublicTextSafetyError.objectionable.localizedDescription)
                        }
                    }
                } header: {
                    Text("Entry")
                } footer: {
                    if hasCode {
                        Text(codeVisibility == "private"
                             ? "Only you can read this code; the restroom is also added to Saved. Reporting it does not verify successful use."
                             : "This code will be public. Reporting it does not verify successful use.")
                    }
                }
                .disabled(attempt != nil)

                Section("What you noticed") {
                    AnswerPicker(title: "Elevator present", selection: $draft.elevatorPresent)
                        .accessibilityIdentifier("visit-elevator-present")
                    AnswerPicker(title: "Automatic door present", selection: $draft.automaticDoorPresent)
                        .accessibilityIdentifier("visit-automatic-door-present")
                    Picker("Restroom floor", selection: $draft.floor) {
                        Text("Not reported").tag("not-reported")
                        Text("Entrance level").tag("entrance")
                        Text("Below entrance level").tag("below")
                        Text("Above entrance level").tag("above")
                    }.pickerStyle(.navigationLink)
                    AnswerPicker(title: "Stairs after entry", selection: $draft.stairs)
                    AnswerPicker(title: "Soap present", selection: $draft.soap)
                    AnswerPicker(title: "Toilet paper present", selection: $draft.toiletPaper)
                    Picker("Condition", selection: $draft.condition) {
                        Text("Not reported").tag("not-reported")
                        Text("Usable").tag("usable")
                        Text("Needs attention").tag("needs-attention")
                    }.pickerStyle(.navigationLink)
                }
                .disabled(attempt != nil)

                if let error = store.error { Section { RRIssue(message: error) } }
                if attempt != nil {
                    Section { RRInfo(message: "Your exact note is kept for a safe retry. A failed response does not prove sharing failed.") }
                }
            }
            .disabled(store.busy || store.authBusy || (store.user == nil && !previewOnly))
            .navigationTitle(reportingProblem ? "Report a problem" : "Add a public note")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Sharing…" : attempt == nil ? "Share" : "Retry") { save() }
                        .fontWeight(.semibold)
                        .disabled(previewOnly || store.busy || store.authBusy || store.user == nil || (attempt == nil && !valid))
                        .accessibilityIdentifier("share-public-note")
                }
            }
            .rrFormDismissal(isDirty: isDirty, busy: store.busy, hasAttempt: attempt != nil, onCancel: { NativeAnalytics.track(.formCancel(reportingProblem ? .amenityProblem : .visitNote)) })
            .rrFormAnalytics(reportingProblem ? .amenityProblem : .visitNote, screen: reportingProblem ? .amenityProblem : .visitNote)
            .onChange(of: draft.observedAt) { _, _ in dateChanged = true }
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
        }
    }

    private func save() {
        guard !previewOnly else { return }
        if attempt == nil {
            guard let fields = validatedFields, validCode else { return }
            var submission = draft
            submission.comment = fields.comment
            submission.authorName = submission.anonymous ? nil : accountName
            if hasCode {
                var report = CodeReportDraft()
                report.id = codeReportID
                report.code = code
                report.visibility = codeVisibility
                submission.optionalCode = report
            } else { submission.optionalCode = nil }
            attempt = submission
        }
        guard let attempt else { return }
        Task { if await store.submitUnifiedVisit(placeID: place.id, draft: attempt, reportingProblem: reportingProblem) { dismiss() } }
    }
}

struct PasscodeForm: View {
    @Environment(\.dismiss) private var dismiss
    let store: NativeStore
    let place: Place
    @State private var draft: CodeDraft
    private let initialCode: String
    private let initialVisibility: String

    init(store: NativeStore, place: Place, existing: OwnPasscode?) {
        self.store = store
        self.place = place
        initialCode = existing?.code ?? ""
        initialVisibility = existing?.visibility ?? "private"
        _draft = State(initialValue: CodeDraft(code: existing?.code ?? "", visibility: existing?.visibility ?? "private", expected: existing))
    }

    private var isDirty: Bool { draft.code != initialCode || draft.visibility != initialVisibility }

    private var validCode: Bool {
        let code = draft.code.trimmingCharacters(in: .whitespacesAndNewlines)
        return !code.isEmpty && code.count <= 40 && code.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value <= 126 }
            && PublicTextSafety.allowsCodeSharing(code, visibility: draft.visibility)
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                Section {
                    Text(place.name).font(.headline)
                    RRField("Restroom code") {
                        TextField("Enter the code", text: $draft.code)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.asciiCapable)
                            .font(.body.monospaced())
                            .disabled(draft.expected != nil)
                    }
                } footer: {
                    Text("Keep leading zeros and keypad symbols. Up to 40 characters. Share only a code you are allowed to share.")
                }

                Section {
                    CodeVisibilityPicker(visibility: $draft.visibility)
                    if !PublicTextSafety.allowsCodeSharing(draft.code, visibility: draft.visibility) {
                        RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                    }
                } footer: {
                    Text(draft.visibility == "private"
                         ? "Only your account can read this code. Saving also adds this place to Saved."
                         : "Everyone can read this code. Only you can edit it or change its visibility.")
                }

                Section {
                    if let error = store.error { RRIssue(message: error) }
                } footer: {
                    Text(draft.expected != nil && draft.expected?.code != draft.code.trimmingCharacters(in: .whitespacesAndNewlines)
                         ? "Changing the code clears its earlier verification. Saving does not verify successful use."
                         : "Saving or changing visibility does not verify successful use.")
                }
            }
            .disabled(store.busy || store.user == nil || store.ownCodeLoading || store.ownCodeError != nil)
            .navigationTitle(draft.expected == nil ? "Save a code" : "Change visibility")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Saving…" : "Save") {
                        Task { if await store.saveCode(placeID: place.id, draft: draft) { dismiss() } }
                    }
                    .fontWeight(.semibold)
                    .disabled(!validCode || store.busy || store.user == nil || store.ownCodeLoading || store.ownCodeError != nil)
                }
            }
            .rrFormDismissal(isDirty: isDirty, busy: store.busy, onCancel: { NativeAnalytics.track(.formCancel(draft.expected == nil ? .codeReport : .codeVisibility)) })
            .rrFormAnalytics(draft.expected == nil ? .codeReport : .codeVisibility, screen: draft.expected == nil ? .codeReport : .codeVisibility)
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
        }
    }
}

struct CodeReportForm: View {
    @Environment(\.dismiss) private var dismiss
    let store: NativeStore
    let place: Place
    @State private var draft = CodeReportDraft()
    @State private var attempted: CodeReportDraft?
    private var valid: Bool {
        (try? CodeReportFields(code: draft.code, visibility: draft.visibility)) != nil
            && PublicTextSafety.allowsCodeSharing(draft.code, visibility: draft.visibility)
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                Section {
                    Text(place.name).font(.headline)
                    RRField("Restroom code") {
                        TextField("Enter the code", text: $draft.code)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .keyboardType(.asciiCapable).font(.body.monospaced())
                            .accessibilityIdentifier("new-code-value")
                    }
                    CodeVisibilityPicker(visibility: $draft.visibility)
                    if !PublicTextSafety.allowsCodeSharing(draft.code, visibility: draft.visibility) {
                        RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                    }
                } footer: {
                    Text(draft.visibility == "private"
                         ? "Only your account can read this code. Saving also adds this place to Saved."
                         : "Everyone can read this code. Only you can change its visibility or remove it.")
                }
                Section {
                    if let error = store.error { RRIssue(message: error) }
                } footer: {
                    Text("Keep leading zeros and keypad symbols. Report only a code you are allowed to share. A new report preserves earlier reports; saving does not verify successful use.")
                }
            }
            .disabled(attempted != nil || store.busy || store.authBusy)
            .navigationTitle("Report a new code").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Saving…" : attempted == nil ? "Save" : "Retry") {
                        let request = attempted ?? draft
                        attempted = request
                        Task { if await store.saveCodeReport(placeID: place.id, draft: request) { dismiss() } }
                    }
                    .fontWeight(.semibold).accessibilityIdentifier("save-code-report")
                    .disabled(!valid || store.busy || store.authBusy || store.user == nil || store.user?.isAnonymous == true)
                }
            }
            .rrFormDismissal(isDirty: !draft.code.isEmpty, busy: store.busy, onCancel: { NativeAnalytics.track(.formCancel(.codeReport)) })
            .rrFormAnalytics(.codeReport, screen: .codeReport)
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
        }
    }
}

struct CodeReportVisibilityForm: View {
    @Environment(\.dismiss) private var dismiss
    let store: NativeStore
    let place: Place
    let report: OwnCodeReport
    @State private var visibility: String

    init(store: NativeStore, place: Place, report: OwnCodeReport) {
        self.store = store; self.place = place; self.report = report
        _visibility = State(initialValue: report.visibility)
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                Section {
                    Text(place.name).font(.headline)
                    Text(report.code).font(.body.monospaced()).textSelection(.enabled)
                    CodeVisibilityPicker(visibility: $visibility)
                    if !PublicTextSafety.allowsCodeSharing(report.code, visibility: visibility) {
                        RRIssue(message: PublicTextSafetyError.objectionable.localizedDescription)
                    }
                } footer: {
                    Text(visibility == "private" ? "Only your account can read this code. This place is added to Saved."
                         : "Everyone can read this code. Changing visibility does not verify successful use.")
                }
                if let error = store.error { Section { RRIssue(message: error) } }
            }
            .disabled(store.busy || store.authBusy)
            .navigationTitle("Change visibility").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Saving…" : "Save") {
                        Task { if await store.setCodeReportVisibility(report: report, visibility: visibility) { dismiss() } }
                    }
                    .fontWeight(.semibold)
                    .disabled(visibility == report.visibility || !PublicTextSafety.allowsCodeSharing(report.code, visibility: visibility)
                              || store.busy || store.authBusy || store.user == nil || store.user?.isAnonymous == true)
                }
            }
            .rrFormDismissal(isDirty: visibility != report.visibility, busy: store.busy, onCancel: { NativeAnalytics.track(.formCancel(.codeVisibility)) })
            .rrFormAnalytics(.codeVisibility, screen: .codeVisibility)
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
        }
    }
}
