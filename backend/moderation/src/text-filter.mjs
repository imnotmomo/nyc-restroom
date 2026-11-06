// Deterministic first-pass filtering, backed by private reports and human review.
// Whole-token boundaries avoid matching ordinary words such as assistance.
// Keep the rule expression and shared parity fixtures synchronized.
export const FORBIDDEN_PUBLIC_TEXT = '(?:^|[^a-z0-9_])(?:fuck(?:ing|er|ers|ed)?|motherfuck(?:er|ers|ing)?|n[i1]gg(?:er|ers|a|as)|f[a4]gg?[o0]t(?:s)?|k[i1]ll[ \\t]+yourself|go[ \\t]+die|child[ \\t]+porn|rape[ \\t]+you)(?:$|[^a-z0-9_])';
export function allowedPublicText(value) {
  return typeof value === 'string' && !new RegExp(FORBIDDEN_PUBLIC_TEXT, 'iu').test(value);
}
