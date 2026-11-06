import AuthenticationServices
import UIKit

struct NativeAppleAuthorization {
    let identityToken: String
    let rawNonce: String
    let fullName: PersonNameComponents?
    let authorizationCode: String?
}

/// NativeStore retains this coordinator because AuthenticationServices delegates are weak.
@MainActor
final class NativeAppleSignIn: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private let anchor: UIWindow
    private let currentSessionGeneration: @MainActor () -> Int
    private var attempt: AppleSignInAttempt
    private var controller: ASAuthorizationController?
    private var continuation: CheckedContinuation<NativeAppleAuthorization, Error>?
    private var started = false

    init(anchor: UIWindow, sessionGeneration: Int, currentSessionGeneration: @escaping @MainActor () -> Int) throws {
        self.anchor = anchor
        self.currentSessionGeneration = currentSessionGeneration
        attempt = try AppleSignInAttempt(challenge: .create(), sessionGeneration: sessionGeneration)
        super.init()
    }

    func signIn() async throws -> NativeAppleAuthorization {
        guard !started else { throw AppleSignInError.alreadyStarted }
        started = true
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                guard !Task.isCancelled, !attempt.isCompleted else {
                    continuation.resume(throwing: CancellationError())
                    return
                }
                self.continuation = continuation
                let request = ASAuthorizationAppleIDProvider().createRequest()
                request.requestedScopes = [.fullName, .email]
                request.nonce = attempt.challenge.hashedNonce
                request.state = attempt.challenge.state
                let controller = ASAuthorizationController(authorizationRequests: [request])
                self.controller = controller
                controller.delegate = self
                controller.presentationContextProvider = self
                controller.performRequests()
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.cancel() }
        }
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { anchor }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard !attempt.isCompleted else { return }
        do {
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                _ = attempt.cancel()
                throw AppleSignInError.invalidResponse
            }
            try attempt.accept(returnedState: credential.state, currentSessionGeneration: currentSessionGeneration())
            guard let data = credential.identityToken, let token = String(data: data, encoding: .utf8), !token.isEmpty else {
                throw AppleSignInError.invalidResponse
            }
            let authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
            finish(.success(NativeAppleAuthorization(identityToken: token, rawNonce: attempt.challenge.rawNonce,
                                                     fullName: credential.fullName, authorizationCode: authorizationCode)))
        } catch { finish(.failure(error)) }
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard attempt.cancel() else { return }
        let failure = error as NSError
        if failure.domain == ASAuthorizationError.errorDomain && failure.code == ASAuthorizationError.canceled.rawValue {
            finish(.failure(CancellationError()))
        } else {
            finish(.failure(AppleSignInError.invalidResponse))
        }
    }

    private func cancel() {
        guard attempt.cancel() else { return }
        controller?.cancel()
        finish(.failure(CancellationError()))
    }

    private func finish(_ result: Result<NativeAppleAuthorization, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        controller?.delegate = nil
        controller?.presentationContextProvider = nil
        controller = nil
        continuation.resume(with: result)
    }
}
