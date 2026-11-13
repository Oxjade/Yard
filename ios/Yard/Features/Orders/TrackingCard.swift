import SwiftUI

/// Everything the tracking card shows, as plain values. The Live Activity uses the same design
/// (reference 03: big ETA, from → to route line with a moving marker, Details / Track).
struct OrderTrackingSnapshot: Hashable, Sendable {
    /// "On its way", "Out for delivery", "Delivered".
    var statusLabel: String
    var brandName: String
    /// Big ETA: "11–16 Nov", "Today", "12 Nov".
    var etaTitle: String
    /// Above the ETA: "Estimated arrival", "Running late, now", "Delivered".
    var etaCaption: String
    /// Origin (brand) city, else the brand's name.
    var originLabel: String
    /// Destination (shopper) city.
    var destinationLabel: String
    /// Under each end of the route: "Shipped 9 Nov", "Est. 16 Nov".
    var originDetail: String?
    var destinationDetail: String?
    /// Under the arc: "Standard shipping".
    var serviceLabel: String
    /// 0…1 along the route.
    var progress: Double
    var isLate: Bool
    var trackingURL: URL?

    init(statusLabel: String, brandName: String, etaTitle: String, etaCaption: String, originLabel: String, destinationLabel: String, originDetail: String? = nil, destinationDetail: String? = nil, serviceLabel: String, progress: Double, isLate: Bool = false, trackingURL: URL? = nil) {
        self.statusLabel = statusLabel
        self.brandName = brandName
        self.etaTitle = etaTitle
        self.etaCaption = etaCaption
        self.originLabel = originLabel
        self.destinationLabel = destinationLabel
        self.originDetail = originDetail
        self.destinationDetail = destinationDetail
        self.serviceLabel = serviceLabel
        self.progress = progress
        self.isLate = isLate
        self.trackingURL = trackingURL
    }

    /// Builds the snapshot from an order (nil until the order has shipped).
    static func from(order: OrderDetail, brandCity: String?) -> OrderTrackingSnapshot? {
        let states = order.summary.states
        let delivery = order.delivery
        let shippedStates: Set<String> = ["shipped", "delivered"]
        let isShipped = order.status == .shipped || order.status == .delivered || shippedStates.contains(states.fulfilment)
        guard isShipped else { return nil }

        let out = delivery?.lastEvent("out_for_delivery") != nil
        let deliveredOn: String? = delivery?.estimate?.deliveredOn
        let delivered = states.fulfilment == "delivered" || order.status == .delivered || deliveredOn != nil
        let estimate = delivery?.estimate
        let range = OrderText.range(estimate?.arrivalFrom, estimate?.arrivalTo)

        let statusLabel: String
        let etaTitle: String
        let etaCaption: String
        let progress: Double
        if delivered {
            statusLabel = "Delivered"
            etaCaption = "Delivered"
            etaTitle = OrderText.day(deliveredOn) ?? YardDate.parse(order.deliveredAt).map { Formatters.shortDate($0) } ?? "Delivered"
            progress = 1
        } else if out {
            statusLabel = "Out for delivery"
            etaCaption = "Arriving"
            etaTitle = "Today"
            progress = 0.85
        } else {
            statusLabel = "On its way"
            etaCaption = estimate?.late == true ? "Running late, now" : "Estimated arrival"
            etaTitle = range ?? "Soon"
            progress = Self.timeProgress(shippedOn: delivery?.shippedOn, arrivalTo: estimate?.arrivalTo)
        }

        let destinationCity = OrderText.nonEmpty(delivery?.shipTo?.city) ?? OrderText.nonEmpty(order.shipTo?.city) ?? OrderText.nonEmpty(order.summary.shipToPreview.city)
        let destination = destinationCity ?? OrderText.countryName(order.summary.shipToPreview.country) ?? "You"
        let shipped = OrderText.day(delivery?.shippedOn).map { "Shipped \($0)" }
        let destinationDetail: String? = delivered
            ? (OrderText.day(deliveredOn) ?? YardDate.parse(order.deliveredAt).map { Formatters.shortDate($0) }).map { "Delivered \($0)" }
            : OrderText.day(estimate?.arrivalTo).map { "Est. \($0)" }
        let tracking = order.tracking

        return OrderTrackingSnapshot(
            statusLabel: statusLabel,
            brandName: order.summary.brand.name,
            etaTitle: etaTitle,
            etaCaption: etaCaption,
            originLabel: OrderText.nonEmpty(brandCity) ?? order.summary.brand.name,
            destinationLabel: destination,
            originDetail: shipped,
            destinationDetail: destinationDetail,
            serviceLabel: "\(OrderText.serviceLabel(delivery?.service ?? order.summary.service)) shipping",
            progress: progress,
            isLate: estimate?.late == true && !delivered,
            trackingURL: tracking.flatMap { OrderText.trackingURL(number: $0.number, carrier: $0.carrier) }
        )
    }

    /// Between 0.2 (just shipped) and 0.8 (due) by elapsed time; 0.5 when the dates are unknown.
    private static func timeProgress(shippedOn: String?, arrivalTo: String?) -> Double {
        guard let start = YardDate.parse(shippedOn), let end = YardDate.parse(arrivalTo) else { return 0.5 }
        let total = end.timeIntervalSince(start)
        guard total > 0 else { return 0.7 }
        let elapsed = Date().timeIntervalSince(start) / total
        return min(0.8, max(0.2, 0.2 + elapsed * 0.6))
    }
}

/// The in-app tracking card (top of Order detail once shipped). Acid card, black ink, in both modes.
struct TrackingCard: View {
    let snapshot: OrderTrackingSnapshot
    var onDetails: (() -> Void)?
    var onTrack: (() -> Void)?

    init(snapshot: OrderTrackingSnapshot, onDetails: (() -> Void)? = nil, onTrack: (() -> Void)? = nil) {
        self.snapshot = snapshot
        self.onDetails = onDetails
        self.onTrack = onTrack
    }

    private var ink: Color { Color.yard.onAcid }
    private var ink2: Color { Color.yard.onAcid.opacity(0.62) }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            // Status line
            HStack(spacing: Spacing.s) {
                Image(systemName: snapshot.progress >= 1 ? "checkmark.circle.fill" : "shippingbox.fill")
                    .font(.system(size: 15, weight: .semibold))
                Text(snapshot.statusLabel)
                    .font(.yardBodyEmphasis)
                Spacer(minLength: Spacing.s)
                Text(snapshot.brandName)
                    .font(.yardCaption)
                    .foregroundStyle(ink2)
                    .lineLimit(1)
            }
            .foregroundStyle(ink)

            // Big ETA
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(snapshot.etaCaption)
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(snapshot.isLate ? Color.yard.purple : ink2)
                Text(snapshot.etaTitle)
                    .yardDisplay(44)
                    .foregroundStyle(ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }

            // Route
            VStack(spacing: Spacing.s) {
                OrderTrackingRouteArc(progress: snapshot.progress, color: ink, faint: ink2)
                    .frame(height: 54)
                HStack(alignment: .top) {
                    routeEnd(snapshot.originLabel, detail: snapshot.originDetail, alignment: .leading)
                    Spacer(minLength: Spacing.s)
                    Text(snapshot.serviceLabel)
                        .font(.yardMicro)
                        .foregroundStyle(ink2)
                        .padding(.top, 2)
                    Spacer(minLength: Spacing.s)
                    routeEnd(snapshot.destinationLabel, detail: snapshot.destinationDetail, alignment: .trailing)
                }
            }

            if onDetails != nil || (onTrack != nil && snapshot.trackingURL != nil) {
                HStack(spacing: Spacing.s) {
                    if let onDetails {
                        Button(action: onDetails) {
                            Text("Details")
                                .font(.yardCaptionEmphasis)
                                .foregroundStyle(ink)
                                .padding(.horizontal, Spacing.l)
                                .frame(height: 34)
                                .background(Color.yard.onAcid.opacity(0.1), in: Capsule())
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                    if let onTrack, snapshot.trackingURL != nil {
                        Button(action: onTrack) {
                            HStack(spacing: Spacing.xs) {
                                Text("Track")
                                Image(systemName: "arrow.up.right")
                            }
                            .font(.yardCaptionEmphasis)
                            .foregroundStyle(Color.yard.acid)
                            .padding(.horizontal, Spacing.l)
                            .frame(height: 34)
                            .background(Color.yard.onAcid, in: Capsule())
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.acid, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    private func routeEnd(_ title: String, detail: String?, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(title)
                .font(.yardHeadline)
                .foregroundStyle(ink)
                .lineLimit(1)
            if let detail {
                Text(detail)
                    .font(.yardMicro)
                    .foregroundStyle(ink2)
                    .lineLimit(1)
            }
        }
    }
}

/// A dotted arc from origin to destination with a solid travelled part and a marker at `progress`.
struct OrderTrackingRouteArc: View {
    let progress: Double
    let color: Color
    let faint: Color

    init(progress: Double, color: Color, faint: Color) {
        self.progress = progress
        self.color = color
        self.faint = faint
    }

    var body: some View {
        GeometryReader { geo in
            let w: CGFloat = geo.size.width
            let h: CGFloat = geo.size.height
            let inset: CGFloat = 6
            let p0 = CGPoint(x: inset, y: h - inset)
            let p2 = CGPoint(x: w - inset, y: h - inset)
            let p1 = CGPoint(x: w / 2, y: -h * 0.55)
            let t: CGFloat = CGFloat(min(1, max(0, progress)))
            let marker = OrderTrackingRouteArc.point(t: t, p0: p0, p1: p1, p2: p2)

            ZStack {
                OrderArcShape(p0: p0, p1: p1, p2: p2)
                    .stroke(faint, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, dash: [3, 5]))
                OrderArcShape(p0: p0, p1: p1, p2: p2)
                    .trim(from: 0, to: t)
                    .stroke(color, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                    .position(p0)
                Circle()
                    .strokeBorder(color, lineWidth: 2)
                    .frame(width: 10, height: 10)
                    .position(p2)
                Image(systemName: t >= 1 ? "checkmark" : "shippingbox.fill")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(Color.yard.acid)
                    .frame(width: 26, height: 26)
                    .background(color, in: Circle())
                    .position(marker)
            }
            .animation(Motion.spring, value: progress)
        }
        .accessibilityHidden(true)
    }

    static func point(t: CGFloat, p0: CGPoint, p1: CGPoint, p2: CGPoint) -> CGPoint {
        let u: CGFloat = 1 - t
        let x: CGFloat = u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x
        let y: CGFloat = u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
        return CGPoint(x: x, y: y)
    }
}

private struct OrderArcShape: Shape {
    let p0: CGPoint
    let p1: CGPoint
    let p2: CGPoint

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: p0)
        p.addQuadCurve(to: p2, control: p1)
        return p
    }
}

#Preview("TrackingCard — dark") {
    TrackingCardPreview().preferredColorScheme(.dark)
}

#Preview("TrackingCard — light") {
    TrackingCardPreview().preferredColorScheme(.light)
}

private struct TrackingCardPreview: View {
    var body: some View {
        VStack(spacing: Spacing.l) {
            TrackingCard(
                snapshot: OrderTrackingSnapshot(statusLabel: "On its way", brandName: "Acme Studio", etaTitle: "11–16 Nov", etaCaption: "Estimated arrival", originLabel: "Lagos", destinationLabel: "London", originDetail: "Shipped 9 Nov", destinationDetail: "Est. 16 Nov", serviceLabel: "Standard shipping", progress: 0.45, trackingURL: URL(string: "https://parcelsapp.com/en/tracking/1")),
                onDetails: {},
                onTrack: {}
            )
            TrackingCard(snapshot: OrderTrackingSnapshot(statusLabel: "Delivered", brandName: "Acme Studio", etaTitle: "12 Nov", etaCaption: "Delivered", originLabel: "Lagos", destinationLabel: "Abuja", serviceLabel: "Express shipping", progress: 1))
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
    }
}
