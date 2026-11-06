import Foundation

enum PublicTextSafety {
    // Same whole-token first-pass filter as the server/rules. Human reporting
    // and moderation remain necessary; this is not a guarantee about content.
    static let forbiddenPattern = #"(?:^|[^a-z0-9_])(?:fuck(?:ing|er|ers|ed)?|motherfuck(?:er|ers|ing)?|n[i1]gg(?:er|ers|a|as)|f[a4]gg?[o0]t(?:s)?|k[i1]ll[ \t]+yourself|go[ \t]+die|child[ \t]+porn|rape[ \t]+you)(?:$|[^a-z0-9_])"#
    static func allows(_ value: String) -> Bool {
        value.range(of: forbiddenPattern, options: [.regularExpression, .caseInsensitive]) == nil
    }
    static func validateForPublication(_ value: String) throws {
        guard allows(value) else { throw PublicTextSafetyError.objectionable }
    }
    static func allowsCodeSharing(_ value: String, visibility: String) -> Bool {
        visibility == "private" || (visibility == "public" && allows(value))
    }
}

enum PublicTextSafetyError: LocalizedError {
    case objectionable
    var errorDescription: String? {
        "Remove abusive, threatening or explicit text before sharing."
    }
}
