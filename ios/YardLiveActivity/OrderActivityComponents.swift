import SwiftUI
import WidgetKit

// MARK: - Building blocks shared by the Lock Screen and Dynamic Island presentations
//
// Colours come from the app's theme tokens (Theme.swift is compiled into this extension too):
// the island is always black (`scrim`) with `onPhoto` (white) text and `acid` accents; the route
// card is acid with `onAcid` ink in both modes; the Lock Screen follows light / dark with `bg` / `ink`.

typealias OrderActivityState = YardOrderActivityAttributes.ContentState

// MARK: Route line (brand → you, moving marker)

/// An arc from the brand to the shopper: solid up to the marker, dashed after it, with the
/// marker (the step's icon in a disc) sitting at `progress` along the curve.
struct OrderRouteLine: View {
    let progress: Double
    let step: YardOrderActivityAttributes.Step
    /// Line and marker disc colour.
    var ink: Color = Color.yard.onAcid
    /// Icon colour inside the marker disc.
    var markerIcon: Color = Color.yard.acid
    var markerSize: CGFloat = 20

    var body: some View {
        GeometryReader { geo in
            let size = geo.size
            let t = CGFloat(min(max(progress, 0), 1))
            let points = OrderRouteLine.controlPoints(in: size, inset: markerSize / 2)
            let marker = OrderRouteLine.point(at: t, points: points)
            ZStack(alignment: .topLeading) {
                // Remaining part: dashed.
                OrderRouteArc(points: points)
                    .trim(from: t, to: 1)
                    .stroke(ink.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [3, 4]))
                // Travelled part: solid.
                OrderRouteArc(points: points)
                    .trim(from: 0, to: t)
                    .stroke(ink, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                // End dots.
                Circle().fill(ink).frame(width: 6, height: 6)
                    .position(points.0)
                Circle().stroke(ink, lineWidth: 1.5).frame(width: 6, height: 6)
                    .position(points.2)
                // Marker.
                ZStack {
                    Circle().fill(ink)
                    Image(systemName: step.systemImage)
                        .font(.system(size: markerSize * 0.48, weight: .bold))
                        .foregroundStyle(markerIcon)
                }
                .frame(width: markerSize, height: markerSize)
                .position(marker)
            }
            .animation(.spring(response: 0.6, dampingFraction: 0.85), value: progress)
        }
        .accessibilityElement()
        .accessibilityLabel("\(Int((min(max(progress, 0), 1) * 100).rounded())) percent of the way")
    }

    /// Start, control and end of the quadratic arc.
    static func controlPoints(in size: CGSize, inset: CGFloat) -> (CGPoint, CGPoint, CGPoint) {
        let start = CGPoint(x: inset, y: size.height - 3)
        let end = CGPoint(x: max(size.width - inset, inset), y: size.height - 3)
        let control = CGPoint(x: size.width / 2, y: -size.height * 0.55 + inset)
        return (start, control, end)
    }

    /// Point on the quadratic Bézier at `t`.
    static func point(at t: CGFloat, points: (CGPoint, CGPoint, CGPoint)) -> CGPoint {
        let (p0, p1, p2) = points
        let u = 1 - t
        let x = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x
        let y = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
        return CGPoint(x: x, y: y)
    }
}

/// The arc itself as a Shape (so it can be trimmed).
struct OrderRouteArc: Shape {
    let points: (CGPoint, CGPoint, CGPoint)

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: points.0)
        path.addQuadCurve(to: points.2, control: points.1)
        return path
    }
}

// MARK: Route card (acid): BRAND city —— marker —— YOU city

struct OrderRouteCard: View {
    let attributes: YardOrderActivityAttributes
    let state: OrderActivityState
    /// Details / Track links (expanded island; Link works there).
    var showsButtons: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .bottom, spacing: Spacing.s) {
                endpoint(title: originTitle, subtitle: attributes.brandName, alignment: .leading)
                VStack(spacing: Spacing.xxs) {
                    OrderRouteLine(progress: state.clampedProgress, step: state.step)
                        .frame(height: 26)
                    Text(state.step.title)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.yard.onAcid.opacity(0.75))
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                endpoint(title: destinationTitle, subtitle: "You", alignment: .trailing)
            }
            if showsButtons {
                HStack(spacing: Spacing.s) {
                    Link(destination: YardOrderActivityLink.details(orderId: attributes.orderId)) {
                        Text("Details")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.yard.onPhotoInk)
                            .padding(.horizontal, Spacing.m)
                            .padding(.vertical, 6)
                            .background(Color.yard.onPhoto, in: Capsule())
                    }
                    Link(destination: YardOrderActivityLink.track(orderId: attributes.orderId)) {
                        Text("Track")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Color.yard.acid)
                            .padding(.horizontal, Spacing.m)
                            .padding(.vertical, 6)
                            .background(Color.yard.onAcid, in: Capsule())
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Spacing.m)
        .background(Color.yard.acid, in: RoundedRectangle(cornerRadius: Radius.image, style: .continuous))
    }

    private var originTitle: String {
        attributes.brandCity.isEmpty ? attributes.brandName : attributes.brandCity
    }

    private var destinationTitle: String {
        attributes.deliveryCity.isEmpty ? "Home" : attributes.deliveryCity
    }

    private func endpoint(title: String, subtitle: String, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(title)
                .font(.yardDisplay(17))
                .textCase(.uppercase)
                .foregroundStyle(Color.yard.onAcid)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(subtitle)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Color.yard.onAcid.opacity(0.7))
                .lineLimit(1)
        }
        .frame(maxWidth: 92, alignment: alignment == .leading ? .leading : .trailing)
    }
}

// MARK: ETA

/// What the ETA slot shows, worked out once per render.
enum OrderETA {
    case delivered
    /// Within 24 hours: a live countdown.
    case countdown(Date)
    /// Further out: whole days plus the date.
    case days(Int, Date)
    case unknown

    static func of(_ state: OrderActivityState, now: Date = Date()) -> OrderETA {
        if state.step == .delivered { return .delivered }
        guard let eta = state.etaDate, eta > now else { return .unknown }
        let remaining = eta.timeIntervalSince(now)
        if remaining <= 24 * 3_600 { return .countdown(eta) }
        let days = Int((remaining / 86_400).rounded(.up))
        return .days(days, eta)
    }

    static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return f
    }()
}

/// The big ETA figure (countdown, days or a word) in `color`.
struct OrderETAFigure: View {
    let state: OrderActivityState
    var size: CGFloat = 28
    var color: Color = Color.yard.onPhoto
    var alignment: TextAlignment = .leading

    var body: some View {
        switch OrderETA.of(state) {
        case .delivered:
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: size * 0.8, weight: .bold))
                .foregroundStyle(color)
        case .countdown(let eta):
            Text(timerInterval: Date()...max(eta, Date()), countsDown: true)
                .font(.yardNumber(size))
                .foregroundStyle(color)
                .multilineTextAlignment(alignment)
        case .days(let days, _):
            Text(days == 1 ? "1 day" : "\(days) days")
                .font(.yardNumber(size))
                .foregroundStyle(color)
                .multilineTextAlignment(alignment)
        case .unknown:
            Text("—")
                .font(.yardNumber(size))
                .foregroundStyle(color)
        }
    }
}

/// The caption under the ETA figure.
func orderETACaption(_ state: OrderActivityState) -> String {
    switch OrderETA.of(state) {
    case .delivered: return "Delivered"
    case .countdown: return "Arrives in"
    case .days(_, let eta): return "Arrives " + OrderETA.dateFormatter.string(from: eta)
    case .unknown: return state.step == .delivered ? "Delivered" : "Estimate pending"
    }
}

// MARK: Logo glyph

/// The Yard logo in acid, sized by height.
struct OrderActivityLogo: View {
    var height: CGFloat = 14
    var color: Color = Color.yard.acid

    var body: some View {
        YardLogo(color: color)
            .frame(width: height * YardLogoShape.aspectRatio, height: height)
    }
}
