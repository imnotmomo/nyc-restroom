import SwiftUI
import UIKit

struct RRIcon: View {
    let systemName: String
    @ScaledMetric(relativeTo: .body) private var size = 20.0
    // Labels retain full Dynamic Type scaling. A supporting icon must still fit a 44pt control.
    private var iconSize: CGFloat { min(size, 28) }

    private var asset: String {
        switch systemName {
        case "magnifyingglass": "search"
        case "map": "map"
        case "list.bullet": "list"
        case "bookmark", "bookmark.fill": "bookmark"
        case "plus": "plus"
        case "person.crop.circle": "user"
        case "location", "location.fill": "navigation"
        case "xmark": "x"
        case "chevron.right": "chevron-right"
        case "info.circle": "info"
        case "lock", "lock.doc": "lock"
        case "globe": "globe"
        case "key": "key"
        case "star", "star.fill": "star"
        case "door.left.hand.open": "door-open"
        case "figure.walk": "route"
        case "checklist": "list-checks"
        case "person.text.rectangle", "newspaper": "file-text"
        case "quote.bubble": "message-square"
        case "calendar", "calendar.badge.clock": "calendar"
        case "exclamationmark.circle": "circle-alert"
        case "mappin.and.ellipse", "mappin.circle": "map-pin"
        case "building.2": "building"
        case "checkmark.circle.fill", "largecircle.fill.circle", "circle": "circle"
        default: "info"
        }
    }

    var body: some View {
        Image("Icon-" + asset)
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: iconSize, height: iconSize)
            .overlay {
                if ["largecircle.fill.circle", "checkmark.circle.fill"].contains(systemName) {
                    Circle().frame(width: iconSize * 0.4, height: iconSize * 0.4)
                }
            }
            .accessibilityHidden(true)
    }
}

struct RRLabel: View {
    let title: String
    let systemImage: String
    init(_ title: String, systemImage: String) { self.title = title; self.systemImage = systemImage }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            RRIcon(systemName: systemImage).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 3 }
            Text(title).fixedSize(horizontal: false, vertical: true)
        }
    }
}

enum RRStyle {
    static let blue = Color(red: 43 / 255, green: 89 / 255, blue: 195 / 255)
    static let pressedBlue = Color(red: 32 / 255, green: 72 / 255, blue: 159 / 255)
    static let ink = Color(red: 30 / 255, green: 42 / 255, blue: 48 / 255)
    static let faint = Color(red: 86 / 255, green: 102 / 255, blue: 110 / 255)
    static let background = Color(red: 238 / 255, green: 242 / 255, blue: 243 / 255)
    static let surface = Color.white
    static let divider = Color(red: 159 / 255, green: 176 / 255, blue: 184 / 255)
    static let error = Color(red: 184 / 255, green: 53 / 255, blue: 43 / 255)

    static func body(_ size: CGFloat = 16, weight: Font.Weight = .regular) -> Font {
        .system(textStyle(for: size), design: .default).weight(weight)
    }

    static func mono(_ size: CGFloat = 14, weight: Font.Weight = .regular, relativeTo: Font.TextStyle = .caption) -> Font {
        .system(textStyle(for: size), design: .monospaced).weight(weight)
    }

    private static func textStyle(for size: CGFloat) -> Font.TextStyle {
        switch size {
        case ...12: .caption
        case ...14: .footnote
        case ...15: .subheadline
        case ...17: .body
        case ...18: .headline
        case ...22: .title3
        case ...24: .title2
        default: .title
        }
    }

    static func heading(_ size: CGFloat = 24) -> Font { body(size, weight: .semibold) }
    static let button = body(17, weight: .semibold)
}

struct RRCard<Content: View>: View {
    var title: String
    var symbol: String
    var content: Content

    init(title: String, symbol: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.symbol = symbol
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
                RRIcon(systemName: symbol).font(.system(size: 20, weight: .regular)).foregroundStyle(RRStyle.ink)
                Text(title).font(.headline)
            }
                .foregroundStyle(RRStyle.ink)
                .accessibilityAddTraits(.isHeader)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(RRStyle.surface, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .font(RRStyle.body())
        .foregroundStyle(RRStyle.ink)
    }
}

struct RRFact: View {
    let label: String
    let value: String?

    private var resolved: String {
        value.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 } ?? "Not reported"
    }

    private var unknown: Bool { resolved == "Not reported" || resolved == "Not yet verified" || resolved == "Not loaded" }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.subheadline).foregroundStyle(RRStyle.faint)
            Text(resolved)
                .font(.body)
                .foregroundStyle(unknown ? RRStyle.faint : RRStyle.ink)
                .textSelection(.enabled)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 8)
        .overlay(alignment: .bottom) { Rectangle().fill(RRStyle.divider.opacity(0.45)).frame(height: 0.5) }
        .accessibilityElement(children: .combine)
    }
}

struct RRTime: View {
    let label: String
    let date: Date?
    var unknown = "Not reported"

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.dateFormat = "MMM d, yyyy, h:mm a z"
        return formatter
    }()

    var body: some View {
        RRFact(label: label, value: date.map(Self.formatter.string(from:)) ?? unknown)
    }
}

/// A calendar-only date is stored at midnight UTC; it must not shift to the previous New York day.
struct RRDate: View {
    let label: String
    let date: Date?

    private static let formatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    var body: some View { RRFact(label: label, value: date.map(Self.formatter.string(from:))) }
}

struct RRIssue: View {
    var message: String

    var body: some View {
        RRLabel(message, systemImage: "exclamationmark.circle")
            .font(RRStyle.body(14))
            .foregroundStyle(RRStyle.error)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
    }
}

struct RRInfo: View {
    var message: String

    var body: some View {
        RRLabel(message, systemImage: "info.circle")
            .font(RRStyle.body(14))
            .foregroundStyle(RRStyle.faint)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityElement(children: .combine)
    }
}

struct RRProminentButtonLabel: View {
    let title: String
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        Text(title).foregroundStyle(isEnabled ? Color.white : RRStyle.ink)
    }
}

struct RRPrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(RRStyle.button)
            .frame(maxWidth: .infinity, minHeight: 48)
            .padding(.horizontal, 16)
            .foregroundStyle(.white)
            .background(RRStyle.ink.opacity(isEnabled ? (configuration.isPressed ? 0.88 : 1) : 0.9), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct RRSecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .frame(minWidth: 44, minHeight: 44)
            .padding(.horizontal, 12)
            .foregroundStyle((configuration.role == .destructive ? RRStyle.error : RRStyle.ink).opacity(isEnabled ? 1 : 0.65))
            .background(configuration.isPressed ? RRStyle.divider.opacity(0.2) : RRStyle.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct RRField<Content: View>: View {
    let title: String
    let content: Content
    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline).foregroundStyle(RRStyle.faint)
            content
                .font(.body)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
        }
        .padding(.vertical, 4)
    }
}

struct RRFormSurface<Content: View>: View {
    let content: Content
    init(@ViewBuilder content: () -> Content) { self.content = content() }
    var body: some View {
        Form { content }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .font(RRStyle.body())
        .foregroundStyle(RRStyle.ink)
        .background(RRStyle.background)
        .tint(RRStyle.ink)
        .preferredColorScheme(.light)
        .toolbarBackground(RRStyle.surface, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") {
                    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                }
            }
        }
    }
}

/// Drafts stay on screen until the user explicitly discards them; a pending write keeps its retry identity.
private struct RRFormDismissal: ViewModifier {
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDiscard = false
    let isDirty: Bool
    let busy: Bool
    let hasAttempt: Bool
    let onCancel: () -> Void

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if isDirty || hasAttempt { confirmDiscard = true }
                        else { onCancel(); dismiss() }
                    }.disabled(busy)
                }
            }
            .interactiveDismissDisabled(busy || isDirty || hasAttempt)
            .confirmationDialog(hasAttempt ? "Leave this submission?" : "Discard your changes?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button(hasAttempt ? "Leave submission" : "Discard changes", role: .destructive) { onCancel(); dismiss() }
                Button("Keep editing", role: .cancel) { }
            } message: {
                Text(hasAttempt
                     ? "The save may already have reached the server. Check your saved content before submitting it again. Staying here keeps the same safe retry."
                     : "Your unsaved changes will be lost.")
            }
    }
}

extension View {
    func rrFormDismissal(isDirty: Bool, busy: Bool, hasAttempt: Bool = false,
                         onCancel: @escaping () -> Void = {}) -> some View {
        modifier(RRFormDismissal(isDirty: isDirty, busy: busy, hasAttempt: hasAttempt, onCancel: onCancel))
    }
}

private struct RRFormAnalytics: ViewModifier {
    let form: NativeAnalyticsForm
    let screen: NativeAnalyticsScreen
    @State private var presentation = UUID().uuidString

    func body(content: Content) -> some View {
        content.onAppear {
            NativeAnalytics.track(.screen(screen))
            NativeAnalytics.track(.formOpen(form), deduplicationKey: presentation)
        }
    }
}

extension View {
    func rrFormAnalytics(_ form: NativeAnalyticsForm, screen: NativeAnalyticsScreen) -> some View {
        modifier(RRFormAnalytics(form: form, screen: screen))
    }
}

/// The web finder's rectangular filters wrap instead of shrinking their labels or touch targets.
struct RRFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 360
        return arrange(subviews: subviews, width: width).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = arrange(subviews: subviews, width: bounds.width)
        for (index, point) in layout.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + point.x, y: bounds.minY + point.y), anchor: .topLeading, proposal: .unspecified)
        }
    }

    private func arrange(subviews: Subviews, width: CGFloat) -> (size: CGSize, origins: [CGPoint]) {
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += rowHeight + spacing; rowHeight = 0 }
            origins.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (CGSize(width: width, height: y + rowHeight), origins)
    }
}

struct AnswerPicker: View {
    let title: String
    @Binding var selection: String
    var unknown = "not-reported"

    var body: some View {
        Picker(title, selection: $selection) {
            Text("Not reported").tag(unknown)
            Text("Yes").tag("yes")
            Text("No").tag("no")
        }.pickerStyle(.navigationLink)
    }
}

struct CodeVisibilityPicker: View {
    @Binding var visibility: String

    var body: some View {
        Picker("Who can see this code?", selection: $visibility) {
            Label("Only me", systemImage: "lock").tag("private")
            Label("Everyone", systemImage: "globe").tag("public")
        }.pickerStyle(.navigationLink)
    }
}

struct HalfStarRating: View {
    @Binding var value: Double?
    var label = "Cleanliness rating"
    @State private var horizontalDrag: Bool?

    private func update(at point: CGFloat, width: CGFloat) {
        guard width > 0 else { return }
        value = min(5, max(1, (Double(point / width) * 10).rounded(.up) / 2))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { geometry in
                HStack(spacing: 0) {
                    ForEach(1...5, id: \.self) { index in
                        Image(systemName: (value ?? 0) >= Double(index) ? "star.fill" : (value ?? 0) >= Double(index) - 0.5 ? "star.leadinghalf.filled" : "star")
                            .font(.system(size: 30))
                            .frame(maxWidth: .infinity, minHeight: 52)
                    }
                }
                .foregroundStyle(RRStyle.ink)
                .contentShape(Rectangle())
                .simultaneousGesture(SpatialTapGesture().onEnded { update(at: $0.location.x, width: geometry.size.width) })
                .simultaneousGesture(DragGesture(minimumDistance: 12)
                    .onChanged { gesture in
                        if horizontalDrag == nil {
                            horizontalDrag = abs(gesture.translation.width) > abs(gesture.translation.height)
                        }
                        guard horizontalDrag == true else { return }
                        update(at: gesture.location.x, width: geometry.size.width)
                    }
                    .onEnded { _ in horizontalDrag = nil })
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label)
                .accessibilityIdentifier("rating-stars")
                .accessibilityValue(value.map { "\($0.formatted(.number.precision(.fractionLength(0...1)))) of 5 stars" } ?? "No rating selected")
                .accessibilityHint("Slide across the stars. Swipe up or down to change by half a star.")
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: value = min(5, (value ?? 0.5) + 0.5)
                    case .decrement: value = max(1, (value ?? 1.5) - 0.5)
                    @unknown default: break
                    }
                }
            }
            .frame(height: 52)
            if let value {
                Text("\(value.formatted(.number.precision(.fractionLength(0...1)))) of 5")
                    .font(.caption).foregroundStyle(RRStyle.faint)
                    .accessibilityHidden(true)
            }
        }
    }
}

enum RRLabels {
    static func sourceFact(_ value: String) -> String {
        let labels = [
            "entryRule": "Entry permission", "passcodeRequired": "Code required", "purchaseRequired": "Purchase required",
            "restroomFloor": "Restroom floor", "stairsToRestroom": "Stairs to restroom", "elevatorAccess": "Elevator — source report",
            "stepFreeAccess": "Step-free route", "staffAssistance": "Staff assistance", "restroomLocation": "Restroom location",
            "buildingAccessibility": "Building access — source description", "restroomAccessibility": "Restroom features — source description",
            "hours": "Restroom hours — source report", "venueHours": "Venue hours — restroom hours unconfirmed", "closure": "Availability report",
            "genderDesignation": "Restroom designation", "restroomType": "Restroom type", "changingStations": "Changing stations",
            "soap": "Soap", "toiletPaper": "Toilet paper", "cleanliness": "Condition report"
        ]
        return labels[value] ?? "Source detail"
    }

    static func sourceDate(_ value: String) -> String {
        switch value {
        case "updated": "Source updated"
        case "post": "Posted on"
        case "comment": "Comment posted"
        case "edition": "Guide edition"
        default: "Published on"
        }
    }

    static func answer(_ value: String) -> String {
        switch value {
        case "yes": "Yes — reported"
        case "no": "No — reported"
        default: "Not reported"
        }
    }

    static func entry(_ value: String) -> String {
        switch value {
        case "public": "Public entry reported"
        case "customers": "Customers only reported"
        default: "Not reported"
        }
    }

    static func floor(_ value: String) -> String {
        switch value {
        case "entrance": "Entrance level"
        case "below": "Below entrance level"
        case "above": "Above entrance level"
        default: "Not reported"
        }
    }

    static func condition(_ value: String) -> String {
        switch value {
        case "usable": "Usable — reported"
        case "needs-attention": "Needs attention — reported"
        default: "Not reported"
        }
    }
}
