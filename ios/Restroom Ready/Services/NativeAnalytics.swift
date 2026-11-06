import FirebaseAnalytics
import Foundation

@MainActor
enum NativeAnalytics {
    static let consentKey = "rr.analytics.consent.v1"
    private static var accountGate = NativeAnalyticsAccountGate()
    private static var receiptGate = NativeAnalyticsDeduplicationGate()
    private static var currentScreen: NativeAnalyticsScreen?
    private static var configured = false
    private static var consentAllowed = false
    #if DEBUG
    private static var traceEnabled = false
    private static var trace: [NativeAnalyticsPayload] = []
    #endif

    /// Stop a previous build's persisted collection setting before Firebase
    /// starts. The current local choice is applied after Core configuration.
    static func prepareForLaunch() {
        Analytics.setAnalyticsCollectionEnabled(false)
    }

    static func configure() {
        consentAllowed = UserDefaults.standard.bool(forKey: consentKey)
        applyConsent(resetLocalData: !consentAllowed)
        configured = true
        #if DEBUG
        traceEnabled = ProcessInfo.processInfo.arguments.contains("-review-analytics")
        trace = []
        writeTrace()
        #endif
        // Views report their actual appearance. Initializing Firebase does not
        // count a visit, and declining never queues events for a later opt-in.
    }

    static func setConsentAllowed(_ allowed: Bool) {
        UserDefaults.standard.set(allowed, forKey: consentKey)
        let changed = consentAllowed != allowed
        consentAllowed = allowed
        guard configured, changed else { return }
        accountGate = NativeAnalyticsAccountGate()
        receiptGate = NativeAnalyticsDeduplicationGate()
        currentScreen = nil
        applyConsent(resetLocalData: !allowed)
        #if DEBUG
        trace = []
        writeTrace()
        #endif
    }

    private static func applyConsent(resetLocalData: Bool) {
        // Stop collection before withdrawing consent or clearing local state.
        Analytics.setAnalyticsCollectionEnabled(false)
        if resetLocalData { Analytics.resetAnalyticsData() }
        Analytics.setConsent([
            .analyticsStorage: consentAllowed ? .granted : .denied,
            .adStorage: .denied,
            .adUserData: .denied,
            .adPersonalization: .denied,
        ])
        #if targetEnvironment(simulator)
        // Local QA traces never become production traffic or conversions.
        Analytics.setAnalyticsCollectionEnabled(false)
        #else
        Analytics.setAnalyticsCollectionEnabled(consentAllowed)
        #endif
    }

    /// The typed contract has no free-text payload API. Receipt keys are used
    /// only by the bounded in-memory gate and never reach Firebase or QA files.
    static func track(_ event: NativeAnalyticsEvent, deduplicationKey: String? = nil) {
        guard configured, consentAllowed else { return }
        if case .screen(let screen) = event {
            guard currentScreen != screen else { return }
            currentScreen = screen
        }
        guard receiptGate.consume(event, key: deduplicationKey) else { return }
        let base = event.payload
        var parameters = base.parameters
        if let text = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String,
           let build = Int(text), (0...999_999_999).contains(build) {
            parameters["app_build"] = String(build)
        }
        let payload = NativeAnalyticsPayload(name: base.name, parameters: parameters)
        #if DEBUG
        if traceEnabled {
            trace.append(payload)
            if trace.count > 500 { trace.removeFirst(trace.count - 500) }
            writeTrace()
        }
        #endif
        #if !targetEnvironment(simulator)
        Analytics.logEvent(payload.name, parameters: payload.parameters.mapValues { $0 as Any })
        #endif
    }

    static func confirmedAccount(isNewUser: Bool?, providerID: String?, accountID: String,
                                 currentAccountID: String?, credentialProviderID: String) {
        guard configured, consentAllowed else { return }
        guard let event = accountGate.event(isNewUser: isNewUser, providerID: providerID,
                                           accountID: accountID, currentAccountID: currentAccountID,
                                           credentialProviderID: credentialProviderID) else { return }
        track(event)
    }

    #if DEBUG
    private static func writeTrace() {
        guard traceEnabled,
              let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else { return }
        // Only the same allowlisted payload sent by the SDK is recorded. This
        // diagnostic is absent from Release and never contains local receipt keys.
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            try encoder.encode(trace).write(to: directory.appendingPathComponent("rr-analytics-trace.json"), options: .atomic)
        } catch { /* Analytics must never break a user workflow. */ }
    }
    #endif
}
