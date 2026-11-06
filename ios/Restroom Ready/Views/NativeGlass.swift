import SwiftUI

/// Liquid Glass belongs to the floating controls, while venue facts remain solid content.
struct RRGlassContainer<Content: View>: View {
    var spacing: CGFloat = 12
    let content: Content
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    init(spacing: CGFloat = 12, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        if #available(iOS 26, *), !reduceTransparency {
            GlassEffectContainer(spacing: spacing) { content }
        } else { content }
    }
}

private struct RRGlassSurface: ViewModifier {
    let cornerRadius: CGFloat
    let interactive: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        if reduceTransparency {
            content.background(Color(uiColor: .secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: cornerRadius))
        } else if #available(iOS 26, *) {
            content.glassEffect(.regular.interactive(interactive), in: .rect(cornerRadius: cornerRadius))
        } else {
            content.background(.regularMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
        }
    }
}

private struct RRGlassButton: ViewModifier {
    let prominent: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    func body(content: Content) -> some View {
        if #available(iOS 26, *), !reduceTransparency {
            if prominent { content.buttonStyle(.glassProminent) }
            else { content.buttonStyle(.glass) }
        } else {
            if prominent { content.buttonStyle(.borderedProminent) }
            else { content.buttonStyle(.bordered) }
        }
    }
}

extension View {
    func rrGlassSurface(cornerRadius: CGFloat = 20, interactive: Bool = true) -> some View {
        modifier(RRGlassSurface(cornerRadius: cornerRadius, interactive: interactive))
    }

    func rrGlassButton(prominent: Bool = false) -> some View {
        modifier(RRGlassButton(prominent: prominent))
    }
}
