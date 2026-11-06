import SwiftUI

struct NativeAccountView: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.dynamicTypeSize) private var textSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let store: NativeStore
    var onShowSaved: () -> Void = {}
    var onOpenPlace: (String) -> Bool = { _ in false }
    var onOpenRequestPlace: (String) -> Bool = { _ in false }
    @State private var showsDeleteConfirmation = false
    @State private var showsOwnContributions = false
    @State private var showsOwnRequests = false
    @State private var deletionAccountID: String?
    @State private var deletingAccount = false
    @State private var signedOutContentHeight: CGFloat = 320
    @AppStorage(NativeAnalytics.consentKey) private var sharesUsageAnalytics = false
    #if DEBUG
    @State private var reviewSignedOut = false
    private var isTransitionReview: Bool { ProcessInfo.processInfo.arguments.contains("-review-account-transition") }
    private var isRequestStatusReview: Bool { ProcessInfo.processInfo.arguments.contains("-review-submission-requests") }
    #else
    private let isTransitionReview = false
    #endif

    private var showsSignedOutState: Bool {
        #if DEBUG
        if isTransitionReview { return reviewSignedOut }
        #endif
        return store.user == nil && !deletingAccount
    }

    @ViewBuilder private var signedInStateContent: some View {
        #if DEBUG
        if isTransitionReview {
            // Presentation-only fixture. No synthetic Firebase user/session and
            // no sign-out service call, mutation event or production write.
            Form {
                Section {
                    Text("Presentation-only account preview")
                    Button("Preview sign out", role: .destructive) { reviewSignedOut = true }
                        .accessibilityIdentifier("review-signout-transition")
                    if isRequestStatusReview {
                        Button("Preview restroom requests") { showsOwnRequests = true }
                            .accessibilityIdentifier("review-restroom-requests")
                    }
                }
            }
            .scrollContentBackground(.hidden)
        } else { accountForm }
        #else
        accountForm
        #endif
    }

    private var accountTransitionAnimation: Animation? {
        var disabled = reduceMotion
        #if DEBUG
        disabled = disabled || ProcessInfo.processInfo.arguments.contains("-review-account-reduce-motion")
        #endif
        return disabled ? nil : .easeInOut(duration: 0.22)
    }

    private var accountActionsDisabled: Bool { store.authBusy || store.busy || deletingAccount }

    var body: some View {
        ZStack(alignment: .top) {
            if showsSignedOutState { signedOutContent.transition(.opacity).zIndex(1) }
            else { signedInStateContent.transition(.opacity).zIndex(0) }
        }
        .animation(accountTransitionAnimation, value: showsSignedOutState)
        .font(.body)
        .foregroundStyle(RRStyle.ink)
        .background(RRStyle.background)
        .tint(RRStyle.ink)
        .presentationDetents(showsSignedOutState && !textSize.isAccessibilitySize
            ? [.height(max(340, signedOutContentHeight + 64))] : [.large])
        .presentationDragIndicator(.visible)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(isPresented: $showsOwnContributions) {
            OwnPublicContributionsView(store: store, onOpenPlace: onOpenPlace)
        }
        .navigationDestination(isPresented: $showsOwnRequests) {
            #if DEBUG
            OwnRestroomRequestsView(store: store, onOpenPlace: onOpenRequestPlace,
                previewRequests: isRequestStatusReview ? OwnRestroomRequestsView.reviewExamples : nil)
            #else
            OwnRestroomRequestsView(store: store, onOpenPlace: onOpenRequestPlace)
            #endif
        }
        .alert("Delete your account?", isPresented: $showsDeleteConfirmation, presenting: deletionAccountID) { uid in
            Button("Delete account", role: .destructive) { deleteAccount(expectedUID: uid) }
                .accessibilityIdentifier("account-delete-confirm")
            Button("Cancel", role: .cancel) {
                NativeAnalytics.track(.formCancel(.accountDeletion))
                deletionAccountID = nil
            }
                .accessibilityIdentifier("account-delete-cancel")
        } message: { _ in
            Text("This permanently deletes your account, saved data, public visit notes and reports. Restrooms you submitted and your ratings remain public without your account identity. You’ll sign in again to confirm it’s you.")
        }
        .onAppear { NativeAnalytics.track(.screen(.account)) }
        .onChange(of: showsOwnContributions) { _, shown in
            if !shown { NativeAnalytics.track(.screen(.account)) }
        }
        .onChange(of: showsOwnRequests) { _, shown in
            if !shown { NativeAnalytics.track(.screen(.account)) }
        }
        .onChange(of: store.user?.uid) { _, _ in
            showsDeleteConfirmation = false
            showsOwnContributions = false
            showsOwnRequests = false
            deletionAccountID = nil
        }
        .onChange(of: showsDeleteConfirmation) { _, isPresented in
            if !isPresented {
                deletionAccountID = nil
                NativeAnalytics.track(.screen(.account))
            }
        }
    }

    private var signedOutContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Sign in to save places, keep private codes, or share public notes and reports.")
                        .font(.subheadline).foregroundStyle(RRStyle.faint)
                    NativeSignInOptions(store: store)
                    if let error = store.error { RRIssue(message: error) }
                }
                .padding(20)
                .background(.white, in: RoundedRectangle(cornerRadius: 24))
                analyticsPreference
                    .padding(16)
                    .background(.white, in: RoundedRectangle(cornerRadius: 20))
                accountFooter
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 12)
            .onGeometryChange(for: CGFloat.self) { proxy in proxy.size.height } action: { height in
                if height.isFinite && height > 0 { signedOutContentHeight = height }
            }
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    private var accountForm: some View {
        Form {
            Section {
                if let user = store.user {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(user.displayName.flatMap { $0.isEmpty ? nil : $0 } ?? "Signed in").font(.headline)
                        if let email = user.email {
                            Text(email).font(.subheadline).foregroundStyle(RRStyle.faint).textSelection(.enabled)
                        }
                    }
                    Button(role: .destructive) { store.signOut() } label: {
                        Text("Sign out")
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                        .disabled(accountActionsDisabled)
                        .accessibilityIdentifier("account-sign-out")
                    if !user.isAnonymous {
                        Button(role: .destructive) {
                            guard !accountActionsDisabled else { return }
                            deletionAccountID = user.uid
                            showsDeleteConfirmation = true
                            NativeAnalytics.track(.screen(.accountDeletion))
                            NativeAnalytics.track(.formOpen(.accountDeletion))
                        } label: {
                            HStack {
                                Text(deletingAccount ? "Deleting account…" : "Delete account")
                                Spacer(minLength: 8)
                                if deletingAccount { ProgressView().tint(RRStyle.faint) }
                            }
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                        .disabled(accountActionsDisabled)
                        .accessibilityIdentifier("account-delete")
                    }
                } else if deletingAccount {
                    ProgressView("Deleting account…")
                        .accessibilityIdentifier("account-deletion-progress")
                } else {
                    Text("Sign in to save places, keep private codes, or share public notes and reports.")
                        .font(.subheadline).foregroundStyle(RRStyle.faint)
                    NativeSignInOptions(store: store)
                }
                if let error = store.error { RRIssue(message: error) }
            }

            if store.user?.isAnonymous == false {
                Section {
                    Button("Saved places", systemImage: "bookmark") { onShowSaved() }
                        .frame(minHeight: 44)
                        .disabled(accountActionsDisabled)
                        .accessibilityIdentifier("account-saved")
                }
                Section {
                    Button {
                        showsOwnContributions = true
                    } label: {
                        HStack {
                            Label("Comments by you", systemImage: "text.bubble")
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(RRStyle.faint)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .disabled(accountActionsDisabled)
                    .accessibilityIdentifier("account-comments")
                    Button {
                        showsOwnRequests = true
                    } label: {
                        HStack {
                            Label("Restroom requests", systemImage: "clock.arrow.circlepath")
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold)).foregroundStyle(RRStyle.faint)
                        }
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .disabled(accountActionsDisabled)
                    .accessibilityIdentifier("account-restroom-requests")
                }
            }
            Section { analyticsPreference }
            if textSize.isAccessibilitySize {
                Section { } footer: { accountFooter }
            }
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !textSize.isAccessibilitySize { accountFooter }
        }
    }

    private var analyticsPreference: some View {
        VStack(alignment: .leading, spacing: 6) {
            Toggle("Share app usage", isOn: Binding(
                get: { sharesUsageAnalytics },
                set: { enabled in
                    NativeAnalytics.setConsentAllowed(enabled)
                    sharesUsageAnalytics = enabled
                    if enabled { NativeAnalytics.track(.screen(.account)) }
                }
            ))
            .accessibilityIdentifier("account-analytics-consent")
            Text("Optional. Share app interactions with Google Analytics to help improve the app. You can turn this off at any time.")
                .font(.caption)
                .foregroundStyle(RRStyle.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var accountFooter: some View {
        VStack(alignment: .leading, spacing: 4) {
            Link("Support", destination: URL(string: "https://nyc.imfinethanku.me/support/")!)
                .font(.footnote)
                .underline()
                .foregroundStyle(RRStyle.faint)
                .frame(minHeight: 44, alignment: .leading)
                .accessibilityIdentifier("account-support")
            Link(destination: URL(string: "https://nyc.imfinethanku.me/privacy/")!) {
                Text("Privacy and data use")
                    .font(.footnote)
                    .underline()
                    .foregroundStyle(RRStyle.faint)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(minHeight: 48, alignment: .leading)
            }
            .accessibilityIdentifier("account-privacy")
            .environment(\.openURL, OpenURLAction { url in
                openURL(url) { accepted in
                    if accepted { Task { @MainActor in NativeAnalytics.track(.privacyOpen) } }
                }
                return .handled
            })
            Text("Listings and visitor reports are dated information. Entry, codes and conditions can change.")
                .font(.caption)
                .foregroundStyle(RRStyle.faint)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("account-dated-information")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, store.user == nil || textSize.isAccessibilitySize ? 0 : 20)
        .padding(.bottom, 12)
        .background(RRStyle.background)
    }

    private func deleteAccount(expectedUID: String) {
        guard !accountActionsDisabled, store.user?.uid == expectedUID,
              store.user?.isAnonymous == false else { return }
        deletingAccount = true
        Task {
            defer { deletingAccount = false }
            await store.deleteAccount(expectedUID: expectedUID)
        }
    }
}

private struct OwnPublicContributionsView: View {
    let store: NativeStore
    let onOpenPlace: (String) -> Bool
    @State private var showsUnavailablePlace = false

    private var signedIn: Bool { store.user?.isAnonymous == false }

    var body: some View {
        List {
            if !signedIn {
                Text("Sign in to view your comments.")
                    .foregroundStyle(RRStyle.faint)
            } else if store.ownContributionsLoading && store.ownContributions.isEmpty {
                ProgressView("Loading your comments…")
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("own-comments-loading")
            } else {
                if let error = store.ownContributionsError {
                    Section {
                        RRIssue(message: error)
                        Button("Retry") { reload() }
                            .frame(minHeight: 44)
                            .accessibilityIdentifier("own-comments-retry")
                    }
                }
                if store.ownContributions.isEmpty && store.ownContributionsError == nil {
                    Text("You haven’t added a public note yet.")
                        .foregroundStyle(RRStyle.faint)
                        .accessibilityIdentifier("own-comments-empty")
                } else {
                    ForEach(store.ownContributions) { contribution in
                        Button {
                            guard signedIn, !store.authBusy, !store.busy else { return }
                            if !onOpenPlace(contribution.placeID) { showsUnavailablePlace = true }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text(contribution.placeName)
                                        .font(.headline)
                                        .fixedSize(horizontal: false, vertical: true)
                                    Spacer(minLength: 0)
                                    Image(systemName: "chevron.right")
                                        .font(.footnote.weight(.semibold))
                                        .foregroundStyle(RRStyle.faint)
                                }
                                Text(contribution.body)
                                    .font(.body)
                                    .fixedSize(horizontal: false, vertical: true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Visited \(contribution.observedAt.formatted(date: .abbreviated, time: .shortened))")
                                    Text("Posted \(contribution.submittedAt.formatted(date: .abbreviated, time: .shortened))")
                                }
                                .font(.caption)
                                .foregroundStyle(RRStyle.faint)
                            }
                            .foregroundStyle(RRStyle.ink)
                            .padding(.vertical, 4)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(store.authBusy || store.busy)
                        .accessibilityHint("Open this restroom")
                        .accessibilityIdentifier("own-comment-" + contribution.id)
                    }
                }
                if store.ownContributionsLoading {
                    ProgressView("Refreshing your comments…")
                        .frame(minHeight: 44)
                }
                if store.ownContributionsTruncated {
                    Text("Showing your most recent notes.")
                        .font(.footnote)
                        .foregroundStyle(RRStyle.faint)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(RRStyle.background)
        .foregroundStyle(RRStyle.ink)
        .tint(RRStyle.ink)
        .navigationTitle("Comments by you")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("own-comments")
        .onAppear { NativeAnalytics.track(.screen(.comments)) }
        .alert("Restroom unavailable", isPresented: $showsUnavailablePlace) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("This restroom is not available in the current map. Refresh the map and try again.")
        }
        .onChange(of: store.user?.uid) { _, _ in showsUnavailablePlace = false }
        .task(id: store.user?.uid) {
            guard signedIn else { return }
            await store.loadOwnContributions()
        }
        .refreshable {
            guard signedIn else { return }
            await store.loadOwnContributions()
        }
    }

    private func reload() {
        Task {
            guard signedIn else { return }
            await store.loadOwnContributions()
        }
    }
}
