import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device only. No tools, cloud fallback, persistence, analytics or logging.
@MainActor
struct AppleVisitorSummaryEngine: VisitorSummaryEngine {
    private enum Failure: Error { case unavailable }

    var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            let model = SystemLanguageModel.default
            if case .available = model.availability {
                return model.supportsLocale(Locale(identifier: "en_US"))
            }
        }
        #endif
        return false
    }

    func chooseTopics(for input: VisitorSummaryInput) async throws -> [VisitorSummaryTopic] {
        guard isAvailable, !Task.isCancelled, !input.eligibleTopics.isEmpty else { throw Failure.unavailable }
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macOS 26.0, *) {
            // Constrain decoding to this snapshot's known topics, rather than
            // merely asking a model with a wider static enum to avoid unknowns.
            let choices = DynamicGenerationSchema(name: "VisitorTopic", anyOf: input.eligibleTopics.map(\.rawValue))
            let list = DynamicGenerationSchema(arrayOf: choices, minimumElements: 1,
                maximumElements: min(2, input.eligibleTopics.count))
            let root = DynamicGenerationSchema(name: "VisitorSummaryHighlights", properties: [
                .init(name: "topics", schema: list)
            ])
            let schema = try GenerationSchema(root: root, dependencies: [])
            // A fresh session has no prior place/account context. Enum-only
            // output cannot inject facts, instructions or invented prose.
            let session = LanguageModelSession(model: .default, instructions: """
                Select the most useful reported topics for a concise summary of past public restroom visits.
                Choose only eligible topics supplied in the prompt. Do not choose unknown topics.
                Never infer current conditions, opening hours, access permission or accessibility.
                """
                )
            let response = try await session.respond(to: input.prompt, schema: schema,
                options: GenerationOptions(sampling: .greedy))
            try Task.checkCancellation()
            let names = try response.content.value([String].self, forProperty: "topics")
            let topics = names.compactMap(VisitorSummaryTopic.init(rawValue:))
            guard topics.count == names.count else { throw Failure.unavailable }
            return topics
        }
        #endif
        throw Failure.unavailable
    }
}
