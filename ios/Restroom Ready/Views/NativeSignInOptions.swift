import SwiftUI
import AuthenticationServices

/// The same provider choices are offered from Account and protected place actions.
@MainActor
struct NativeSignInOptions: View {
    let store: NativeStore

    var body: some View {
        VStack(spacing: 12) {
            NativeAppleSignInButton(isEnabled: !store.authBusy && !store.busy) {
                Task { await store.signInWithApple() }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 52)

            Button { Task { await store.signIn() } } label: {
                HStack(spacing: 12) {
                    // Unmodified official Google G; the existing bundled asset is retained.
                    Image("GoogleMark")
                        .renderingMode(.original)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 20, height: 20)
                        .accessibilityHidden(true)
                    Text("Sign in with Google")
                        .font(.body.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, minHeight: 24)
            }
            .buttonStyle(GoogleAccountButtonStyle())
            .disabled(store.authBusy || store.busy)
            .accessibilityIdentifier("google-sign-in")

            if store.authBusy { ProgressView("Signing in…") }
        }
    }
}

@MainActor
struct NativeSignInSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let store: NativeStore
    var onCancel: () -> Void = {}

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Sign in to save places, keep private codes, or share public notes and reports.")
                        .font(.body).foregroundStyle(RRStyle.faint)
                    NativeSignInOptions(store: store)
                    if let error = store.error { RRIssue(message: error) }
                }
            }
            .font(.body)
            .scrollContentBackground(.hidden)
            .background(RRStyle.background)
            .foregroundStyle(RRStyle.ink)
            .tint(RRStyle.ink)
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onCancel(); dismiss() }
                        .disabled(store.authBusy)
                        .accessibilityIdentifier("sign-in-cancel")
                }
            }
        }
        .presentationDetents(dynamicTypeSize.isAccessibilitySize ? [.large] : [.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(store.authBusy)
        .onAppear { dismissAfterSignIn() }
        .onChange(of: store.user?.uid) { _, _ in dismissAfterSignIn() }
        .onChange(of: store.authBusy) { _, _ in dismissAfterSignIn() }
    }

    private func dismissAfterSignIn() {
        guard let user = store.user, !user.isAnonymous, !store.authBusy else { return }
        dismiss()
    }
}

/// Apple's own authorization control supplies its mark, typography and localized title.
@MainActor
private struct NativeAppleSignInButton: UIViewRepresentable {
    let isEnabled: Bool
    let action: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(action: action) }

    func makeUIView(context: Context) -> ASAuthorizationAppleIDButton {
        let button = ASAuthorizationAppleIDButton(type: .signIn, style: .whiteOutline)
        button.cornerRadius = 26
        button.accessibilityIdentifier = "apple-sign-in"
        button.addTarget(context.coordinator, action: #selector(Coordinator.signIn), for: .touchUpInside)
        button.isEnabled = isEnabled
        return button
    }

    func updateUIView(_ button: ASAuthorizationAppleIDButton, context: Context) {
        context.coordinator.action = action
        button.isEnabled = isEnabled
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ASAuthorizationAppleIDButton, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? uiView.intrinsicContentSize.width, height: proposal.height ?? 52)
    }

    @MainActor
    final class Coordinator: NSObject {
        var action: () -> Void
        init(action: @escaping () -> Void) { self.action = action }
        @objc func signIn() { action() }
    }
}

private struct GoogleAccountButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 52)
            .foregroundStyle(Color(red: 31 / 255, green: 31 / 255, blue: 31 / 255))
            .background(configuration.isPressed ? Color(white: 0.95) : .white, in: Capsule())
            .overlay(Capsule().strokeBorder(Color(red: 116 / 255, green: 119 / 255, blue: 117 / 255), lineWidth: 1))
    }
}
