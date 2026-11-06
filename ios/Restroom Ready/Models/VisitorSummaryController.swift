import Foundation
import Observation

@MainActor
protocol VisitorSummaryEngine {
    var isAvailable: Bool { get }
    func chooseTopics(for input: VisitorSummaryInput) async throws -> [VisitorSummaryTopic]
}

/// The injectable engine keeps availability, cancellation and publication guards
/// testable without a device model. The shipped app always uses Apple's engine.
@MainActor @Observable
final class VisitorSummaryController {
    private(set) var available = false
    private(set) var input: VisitorSummaryInput?
    private(set) var text: String?
    private(set) var loading = false
    private(set) var failed = false
    private let engine: any VisitorSummaryEngine
    private var generation = UUID()

    init(engine: any VisitorSummaryEngine) { self.engine = engine }

    func refreshAvailability() {
        let current = engine.isAvailable
        if current != available { cancel(); available = current }
    }

    func cancel() {
        generation = UUID()
        input = nil; text = nil; loading = false; failed = false
    }

    func update(input newInput: VisitorSummaryInput, feedReady: Bool, active: Bool) async {
        guard !Task.isCancelled else { return }
        cancel()
        refreshAvailability()
        guard active, available, feedReady, !newInput.observations.isEmpty else { return }
        input = newInput
        guard !newInput.eligibleTopics.isEmpty else { return }
        let request = generation
        loading = true
        do {
            let topics = try await engine.chooseTopics(for: newInput)
            guard generation == request, input == newInput else { return }
            guard !Task.isCancelled else { cancel(); return }
            refreshAvailability()
            guard available, generation == request else { return }
            guard let grounded = newInput.summary(selecting: topics) else {
                loading = false; failed = true
                return
            }
            text = grounded; loading = false
        } catch {
            guard generation == request, input == newInput else { return }
            guard !Task.isCancelled else { cancel(); return }
            refreshAvailability()
            if generation == request { loading = false; failed = available }
        }
    }
}
