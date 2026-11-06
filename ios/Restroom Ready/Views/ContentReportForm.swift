import SwiftUI

struct ContentReportForm: View {
    @Environment(\.dismiss) private var dismiss
    let store: NativeStore
    let place: Place
    let target: ContentReportTarget
    @State private var reason: ContentReportReason?
    @State private var attempt: ContentReportAttempt?
    @State private var confirmed = false
    @State private var confirmCancel = false
    private let previewOnly: Bool

    init(store: NativeStore, place: Place, target: ContentReportTarget, previewOnly: Bool = false) {
        self.store = store; self.place = place; self.target = target
        #if DEBUG
        self.previewOnly = previewOnly
        #else
        self.previewOnly = false
        #endif
    }

    var body: some View {
        NavigationStack {
            RRFormSurface {
                Section {
                    Text(place.name).font(.headline)
                    Picker("Reason", selection: $reason) {
                        Text("Choose a reason").tag(nil as ContentReportReason?)
                        ForEach(ContentReportReason.allCases) { value in
                            Text(value.title).tag(Optional(value))
                        }
                    }
                    .pickerStyle(.navigationLink)
                    .accessibilityIdentifier("content-report-reason")
                    .disabled(attempt != nil)
                } footer: {
                    Text("Sent privately to moderators. Your report will not appear in visitor notes.")
                }
                if let error = store.error { Section { RRIssue(message: error) } }
                if attempt != nil {
                    Section {
                        RRInfo(message: "Your exact report is kept for a safe retry. A failed response does not confirm whether it was received.")
                    }
                }
                #if DEBUG
                if previewOnly {
                    Section { Text("Presentation-only content report. Sending is disabled.").font(.footnote) }
                }
                #endif
            }
            .disabled(store.busy || store.authBusy || (!previewOnly && store.user == nil) || confirmed)
            .navigationTitle("Report content")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if reason != nil || attempt != nil { confirmCancel = true }
                        else { cancel() }
                    }.disabled(store.busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(store.busy ? "Sending…" : attempt == nil ? "Send report" : "Retry report") { send() }
                        .disabled(reason == nil || store.busy || store.authBusy || store.user == nil || previewOnly || confirmed)
                        .accessibilityIdentifier("content-report-send")
                }
            }
            .interactiveDismissDisabled(store.busy || reason != nil || attempt != nil)
            .confirmationDialog(attempt == nil ? "Discard this report?" : "Leave this report?",
                                isPresented: $confirmCancel, titleVisibility: .visible) {
                Button(attempt == nil ? "Discard changes" : "Leave report", role: .destructive) { cancel() }
                Button("Keep editing", role: .cancel) { }
            } message: {
                Text(attempt == nil ? "Your unsent report will be discarded."
                     : "This report may already have reached a moderator. Staying here keeps the same safe retry.")
            }
            .rrFormAnalytics(.contentReport, screen: .contentReport)
            .onChange(of: store.user?.uid) { _, _ in dismiss() }
            .alert("Report sent", isPresented: $confirmed) {
                Button("Done") { dismiss() }
            } message: {
                Text("A moderator will review this content. Your report is private.")
            }
        }
    }

    private func send() {
        guard !previewOnly, let reason else { return }
        if attempt == nil {
            do { attempt = try ContentReportAttempt(target: target, reason: reason) }
            catch { store.error = ContentReportError.invalidTarget.localizedDescription; return }
        }
        guard let attempt else { return }
        Task { confirmed = await store.reportContent(attempt) }
    }

    private func cancel() {
        NativeAnalytics.track(.formCancel(.contentReport))
        dismiss()
    }
}
