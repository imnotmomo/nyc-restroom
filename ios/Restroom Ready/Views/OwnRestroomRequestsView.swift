import SwiftUI

struct OwnRestroomRequestsView: View {
    let store: NativeStore
    let onOpenPlace: (String) -> Bool
    #if DEBUG
    var previewRequests: [OwnRestroomRequest]? = nil
    #endif
    @State private var showsUnavailablePlace = false

    private var isPreview: Bool {
        #if DEBUG
        previewRequests != nil
        #else
        false
        #endif
    }
    private var signedIn: Bool { isPreview || store.user?.isAnonymous == false }
    private var requests: [OwnRestroomRequest] {
        #if DEBUG
        if let previewRequests { return previewRequests }
        #endif
        return store.ownRestroomRequests
    }

    var body: some View {
        List {
            #if DEBUG
            if isPreview {
                Section {
                    Text("No request was submitted; these example statuses are local.")
                        .font(.footnote).foregroundStyle(RRStyle.faint)
                } header: { Text("Presentation-only status preview") }
            }
            #endif
            if !signedIn {
                Text("Sign in to view your restroom requests.").foregroundStyle(RRStyle.faint)
            } else if !isPreview && store.ownRestroomRequestsLoading && requests.isEmpty {
                ProgressView("Loading your requests…").frame(minHeight: 44)
                    .accessibilityIdentifier("own-requests-loading")
            } else {
                if !isPreview, let error = store.ownRestroomRequestsError {
                    Section {
                        RRIssue(message: error)
                        Button("Retry") { Task { await reload() } }.frame(minHeight: 44)
                            .accessibilityIdentifier("own-requests-retry")
                    }
                }
                if requests.isEmpty && (isPreview || store.ownRestroomRequestsError == nil) {
                    Text("You haven’t submitted a restroom request yet.").foregroundStyle(RRStyle.faint)
                        .accessibilityIdentifier("own-requests-empty")
                }
                ForEach(requests) { request in
                    if request.state.status == .approved {
                        Button {
                            guard signedIn, !store.authBusy, !store.busy, !isPreview else { return }
                            if !onOpenPlace(request.id) { showsUnavailablePlace = true }
                        } label: { requestRow(request, opensPlace: true) }
                            .buttonStyle(.plain)
                            .disabled(store.authBusy || store.busy || isPreview)
                            .accessibilityHint("Open approved restroom")
                            .accessibilityIdentifier("approved-request-" + request.id)
                    } else {
                        requestRow(request, opensPlace: false)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("restroom-request-" + request.id)
                    }
                }
                if !isPreview && store.ownRestroomRequestsLoading {
                    ProgressView("Refreshing your requests…").frame(minHeight: 44)
                }
                if !isPreview && store.ownRestroomRequestsTruncated {
                    Text("Showing your 50 most recent requests.").font(.footnote).foregroundStyle(RRStyle.faint)
                }
            }
        }
        .font(.body).foregroundStyle(RRStyle.ink).tint(RRStyle.ink)
        .contentMargins(.bottom, 32, for: .scrollContent)
        .scrollContentBackground(.hidden).background(RRStyle.background)
        .navigationTitle("Restroom requests").navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("own-restroom-requests")
        .onAppear { NativeAnalytics.track(.screen(.restroomRequests)) }
        .alert("Restroom unavailable", isPresented: $showsUnavailablePlace) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("This approved restroom is not available in the current map. Refresh the map and try again.")
        }
        .onChange(of: store.user?.uid) { _, _ in showsUnavailablePlace = false }
        .task(id: store.user?.uid) { await reload() }
        .refreshable { await reload() }
    }

    private func requestRow(_ request: OwnRestroomRequest, opensPlace: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(request.name).font(.headline).fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                if opensPlace {
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(RRStyle.faint)
                }
            }
            Text(request.state.status.title).font(.subheadline.weight(.medium))
            Text(request.address).font(.subheadline).foregroundStyle(RRStyle.faint)
                .fixedSize(horizontal: false, vertical: true)
            if let reason = request.state.reason {
                Text(reason.title).font(.subheadline).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Submitted \(request.submittedAt.formatted(date: .abbreviated, time: .shortened))")
                if let reviewedAt = request.state.reviewedAt {
                    Text("Reviewed \(reviewedAt.formatted(date: .abbreviated, time: .shortened))")
                }
            }
            .font(.caption).foregroundStyle(RRStyle.faint)
            .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(RRStyle.ink).padding(.vertical, 4)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func reload() async {
        guard signedIn, !isPreview else { return }
        await store.loadOwnRestroomRequests()
    }

    #if DEBUG
    /// UI-only examples; never synthesize a Firebase account or write records.
    static var reviewExamples: [OwnRestroomRequest] { NativeStore.reviewSubmissionRequests() }
    #endif
}
