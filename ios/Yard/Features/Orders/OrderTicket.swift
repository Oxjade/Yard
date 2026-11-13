import SwiftUI

// MARK: - Ticket shape (reference 06)

/// A card with two semicircle notches cut into its sides at `notchY` (points from the top):
/// the "tear here" line of a ticket.
struct OrderTicketShape: Shape {
    var cornerRadius: CGFloat = Radius.card
    var notchRadius: CGFloat = 12
    var notchY: CGFloat

    init(notchY: CGFloat, cornerRadius: CGFloat = Radius.card, notchRadius: CGFloat = 12) {
        self.notchY = notchY
        self.cornerRadius = cornerRadius
        self.notchRadius = notchRadius
    }

    var animatableData: CGFloat {
        get { notchY }
        set { notchY = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let r: CGFloat = max(0, min(cornerRadius, rect.width / 2, rect.height / 2))
        let n: CGFloat = max(0, min(notchRadius, rect.height / 4))
        let lowest: CGFloat = r + n
        let highest: CGFloat = max(lowest, rect.height - r - n)
        let y: CGFloat = rect.minY + min(max(notchY, lowest), highest)

        var p = Path()
        p.move(to: CGPoint(x: rect.minX + r, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX - r, y: rect.minY))
        p.addArc(center: CGPoint(x: rect.maxX - r, y: rect.minY + r), radius: r, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        p.addLine(to: CGPoint(x: rect.maxX, y: y - n))
        p.addArc(center: CGPoint(x: rect.maxX, y: y), radius: n, startAngle: .degrees(-90), endAngle: .degrees(90), clockwise: true)
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - r))
        p.addArc(center: CGPoint(x: rect.maxX - r, y: rect.maxY - r), radius: r, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        p.addLine(to: CGPoint(x: rect.minX + r, y: rect.maxY))
        p.addArc(center: CGPoint(x: rect.minX + r, y: rect.maxY - r), radius: r, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        p.addLine(to: CGPoint(x: rect.minX, y: y + n))
        p.addArc(center: CGPoint(x: rect.minX, y: y), radius: n, startAngle: .degrees(90), endAngle: .degrees(-90), clockwise: true)
        p.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
        p.addArc(center: CGPoint(x: rect.minX + r, y: rect.minY + r), radius: r, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        p.closeSubpath()
        return p
    }
}

/// The dashed perforation drawn between the notches.
struct OrderPerforation: View {
    init() {}

    var body: some View {
        GeometryReader { geo in
            Path { p in
                p.move(to: CGPoint(x: 0, y: geo.size.height / 2))
                p.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height / 2))
            }
            .stroke(Color.yard.ink3.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [5, 6]))
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}

private struct OrderTicketHeaderHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// A ticket card: `header`, a perforated tear line with side notches, then `content`.
///
///   OrderTicket { Text("Checkout YRD-1234") } content: { detailsGrid }
struct OrderTicket<Header: View, Content: View>: View {
    var background: Color
    @ViewBuilder let header: () -> Header
    @ViewBuilder let content: () -> Content
    @State private var headerHeight: CGFloat = 96

    private let notchRadius: CGFloat = 12

    init(background: Color = Color.yard.surface, @ViewBuilder header: @escaping () -> Header, @ViewBuilder content: @escaping () -> Content) {
        self.background = background
        self.header = header
        self.content = content
    }

    var body: some View {
        let shape = OrderTicketShape(notchY: headerHeight + Spacing.m, notchRadius: notchRadius)
        VStack(spacing: 0) {
            header()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    GeometryReader { geo in
                        Color.clear.preference(key: OrderTicketHeaderHeightKey.self, value: geo.size.height)
                    }
                )
            OrderPerforation()
                .padding(.horizontal, notchRadius + Spacing.s)
                .padding(.vertical, Spacing.m - 1)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onPreferenceChange(OrderTicketHeaderHeightKey.self) { value in
            headerHeight = value
        }
        .background(shape.fill(background))
        .overlay(shape.stroke(Color.yard.line, lineWidth: 1))
        .contentShape(shape)
    }
}

// MARK: - Success badge

/// The glowing success seal at the top of the confirmation: an acid glow in dark mode, a soft
/// halo in light mode. `tone` switches it for pending / failed states.
struct OrderSuccessBadge: View {
    enum Tone: Sendable {
        case success
        case pending
        case failed
    }

    var tone: Tone = .success
    @Environment(\.colorScheme) private var scheme

    init(tone: Tone = .success) {
        self.tone = tone
    }

    private var fill: Color {
        switch tone {
        case .success: return Color.yard.acid
        case .pending: return Color.yard.violet
        case .failed: return Color.yard.danger
        }
    }

    private var iconColor: Color {
        switch tone {
        case .success: return Color.yard.onAcid
        case .pending, .failed: return Color.yard.onPhoto
        }
    }

    private var symbol: String {
        switch tone {
        case .success: return "checkmark.seal.fill"
        case .pending: return "clock.fill"
        case .failed: return "exclamationmark.triangle.fill"
        }
    }

    private var glowOpacity: Double { scheme == .dark ? 0.55 : 0.28 }

    var body: some View {
        ZStack {
            // Halo
            Circle()
                .fill(
                    RadialGradient(
                        colors: [fill.opacity(glowOpacity), fill.opacity(0)],
                        center: .center,
                        startRadius: 30,
                        endRadius: 130
                    )
                )
                .frame(width: 260, height: 260)

            // Sunburst rays (reference 06)
            ForEach(0..<36, id: \.self) { (i: Int) in
                Capsule()
                    .fill(fill.opacity(scheme == .dark ? 0.22 : 0.35))
                    .frame(width: 1, height: i.isMultiple(of: 2) ? 26 : 16)
                    .offset(y: -86)
                    .rotationEffect(.degrees(Double(i) * 10))
            }

            PhaseAnimator([false, true]) { (on: Bool) in
                Circle()
                    .fill(fill)
                    .frame(width: 92, height: 92)
                    .shadow(color: fill.opacity(on ? glowOpacity + 0.15 : glowOpacity), radius: on ? 34 : 22)
                    .scaleEffect(on ? 1.03 : 1)
            } animation: { _ in
                .easeInOut(duration: 1.6)
            }

            Image(systemName: symbol)
                .font(.system(size: 38, weight: .bold))
                .foregroundStyle(iconColor)
        }
        .frame(height: 220)
        .accessibilityHidden(true)
    }
}

// MARK: - Details grid

/// A two-column label/value grid for tickets ("Order number", "Date"…).
struct OrderDetailsGrid: View {
    struct Item: Identifiable, Hashable {
        let label: String
        let value: String
        var id: String { label }
    }

    let items: [Item]

    init(items: [Item]) {
        self.items = items
    }

    var body: some View {
        let columns: [GridItem] = [
            GridItem(.flexible(), spacing: Spacing.l, alignment: .topLeading),
            GridItem(.flexible(), spacing: Spacing.l, alignment: .topLeading),
        ]
        LazyVGrid(columns: columns, alignment: .leading, spacing: Spacing.l) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(item.label)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                    Text(item.value)
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

#Preview("Ticket — dark") {
    OrderTicketPreview().preferredColorScheme(.dark)
}

#Preview("Ticket — light") {
    OrderTicketPreview().preferredColorScheme(.light)
}

private struct OrderTicketPreview: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.l) {
                OrderSuccessBadge()
                OrderTicket {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Checkout YRD-48213").font(.yardTitle).foregroundStyle(Color.yard.ink)
                        Text("2 brands, shipping separately").font(.yardCaption).foregroundStyle(Color.yard.ink2)
                    }
                    .padding(Spacing.l)
                } content: {
                    OrderDetailsGrid(items: [
                        .init(label: "Order number", value: "YRD-48213"),
                        .init(label: "Date", value: "13 Nov 2026"),
                        .init(label: "Items", value: "3"),
                        .init(label: "Total", value: "$165"),
                    ])
                    .padding(Spacing.l)
                }
            }
            .padding(Spacing.gutter)
        }
        .yardScreenBackground()
    }
}
