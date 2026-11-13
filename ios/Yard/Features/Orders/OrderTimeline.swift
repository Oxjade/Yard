import SwiftUI

/// One step of the order's vertical timeline (reference 07).
struct OrderTimelineStep: Identifiable, Hashable, Sendable {
    enum Progress: Sendable, Hashable {
        /// Done: filled dot, timestamp.
        case done
        /// Where the order is now: pulsing dot.
        case current
        /// Still to come: hollow dot.
        case upcoming
        /// The order stopped here (cancelled, returned to sender).
        case stopped
    }

    let id: String
    let title: String
    let date: Date?
    let detail: String?
    let state: Progress

    init(id: String, title: String, date: Date? = nil, detail: String? = nil, state: Progress) {
        self.id = id
        self.title = title
        self.date = date
        self.detail = detail
        self.state = state
    }
}

/// Builds Paid → Packed → Shipped → Out for delivery → Delivered from the server's payment and
/// fulfilment states, the order timeline and the carrier's shipment events.
enum OrderTimelineBuilder {
    static func steps(for order: OrderDetail) -> [OrderTimelineStep] {
        let states = order.summary.states
        let status = order.status
        let delivery = order.delivery

        let paidDate: Date? = YardDate.parse(order.paidAt) ?? order.eventDate("payment.captured")
        let packedDate: Date? = order.eventDate("fulfilment.processing")
        let shippedDate: Date? = order.eventDate("fulfilment.shipped") ?? delivery?.firstEvent(["shipped", "in_transit"])?.date
        let outDate: Date? = delivery?.lastEvent("out_for_delivery")?.date
        let deliveredDate: Date? = YardDate.parse(order.deliveredAt) ?? order.eventDate("fulfilment.delivered") ?? delivery?.lastEvent("delivered")?.date

        // How far the order got: 0 Paid, 1 Packed, 2 Shipped, 3 Out for delivery, 4 Delivered.
        var reached: Int = -1
        let paidStates: Set<String> = ["paid", "partially_refunded", "refunded"]
        if paidStates.contains(states.payment) || paidDate != nil { reached = 0 }
        switch states.fulfilment {
        case "processing": reached = max(reached, 1)
        case "shipped": reached = max(reached, 2)
        case "delivered": reached = 4
        default: break
        }
        switch status {
        case .processing: reached = max(reached, 1)
        case .shipped: reached = max(reached, 2)
        case .delivered, .refundRequested: reached = max(reached, states.fulfilment == "delivered" || deliveredDate != nil ? 4 : reached)
        default: break
        }
        if reached == 2, outDate != nil { reached = 3 }
        if reached < 4, deliveredDate != nil, states.fulfilment == "delivered" { reached = 4 }

        let stoppedCancelled = status == .cancelled || states.fulfilment == "cancelled"
        let returnedToSender = states.fulfilment == "returned_to_sender"
        let paymentFailed = states.payment == "failed"

        struct Def {
            let id: String
            let title: String
            let date: Date?
            let doneDetail: String?
            let currentDetail: String
        }
        let estimate = delivery?.estimate
        let arrival: String? = OrderText.range(estimate?.arrivalFrom, estimate?.arrivalTo)
        let lastScan: String? = delivery?.events.last.flatMap { OrderText.nonEmpty($0.locationText) }
        let defs: [Def] = [
            Def(id: "paid", title: "Paid", date: paidDate, doneDetail: nil,
                currentDetail: reached >= 0 ? "Payment confirmed. The brand has your order and will start preparing it soon." : "Not charged yet. The brand starts preparing it once the payment provider confirms payment."),
            Def(id: "packed", title: "Packed", date: packedDate, doneDetail: nil,
                currentDetail: "The brand is packing your order. Tracking follows when it ships."),
            Def(id: "shipped", title: "Shipped", date: shippedDate, doneDetail: nil,
                currentDetail: lastScan.map { "Your parcel is with the carrier. Last seen in \($0)." } ?? (arrival.map { "Your parcel is with the carrier. Estimated arrival \($0)." } ?? "Your parcel is with the carrier.")),
            Def(id: "out", title: "Out for delivery", date: outDate, doneDetail: nil,
                currentDetail: "Your parcel is on the last stretch and should arrive today."),
            Def(id: "delivered", title: "Delivered", date: deliveredDate, doneDetail: "Something not right? You can request a return.",
                currentDetail: "Delivered."),
        ]

        // Pending payment: the first step is current, the rest are to come.
        let currentIndex: Int = max(reached, 0)
        let stopped = stoppedCancelled || returnedToSender || paymentFailed

        var result: [OrderTimelineStep] = []
        for (index, def) in defs.enumerated() {
            let state: OrderTimelineStep.Progress
            if index < currentIndex {
                state = .done
            } else if index == currentIndex {
                if stopped {
                    state = reached >= index ? .done : .upcoming
                } else if index == defs.count - 1 {
                    state = .done
                } else {
                    state = .current
                }
            } else {
                state = .upcoming
            }
            if stopped && state == .upcoming { continue }
            let detail: String?
            switch state {
            case .current: detail = def.currentDetail
            case .done: detail = index == defs.count - 1 ? def.doneDetail : nil
            case .upcoming, .stopped: detail = nil
            }
            result.append(OrderTimelineStep(id: def.id, title: index == 0 && reached < 0 && !paymentFailed ? "Awaiting payment" : def.title, date: state == .done || state == .current ? def.date : nil, detail: detail, state: state))
        }

        if paymentFailed {
            result.append(OrderTimelineStep(id: "failed", title: "Payment didn’t go through", date: order.eventDate("payment.failed"), detail: "Nothing was charged, and the order won’t be prepared.", state: .stopped))
        } else if stoppedCancelled {
            result.append(OrderTimelineStep(id: "cancelled", title: "Cancelled", date: YardDate.parse(order.cancelledAt) ?? order.eventDate("order.cancelled"), detail: OrderStatusText.note(status: .cancelled, payment: states.payment), state: .stopped))
        } else if returnedToSender {
            result.append(OrderTimelineStep(id: "returned", title: "Returned to the brand", date: order.eventDate("fulfilment.returned_to_sender") ?? delivery?.lastEvent("returned")?.date, detail: "The carrier sent the parcel back to the brand.", state: .stopped))
        }
        return result
    }
}

/// The vertical timeline: dot column with connecting rails, title, timestamp, note.
struct OrderTimelineView: View {
    let steps: [OrderTimelineStep]

    init(steps: [OrderTimelineStep]) {
        self.steps = steps
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(steps.indices, id: \.self) { (index: Int) in
                OrderTimelineRow(step: steps[index], isFirst: index == 0, isLast: index == steps.count - 1, nextState: index + 1 < steps.count ? steps[index + 1].state : nil)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Order progress")
    }
}

private struct OrderTimelineRow: View {
    let step: OrderTimelineStep
    let isFirst: Bool
    let isLast: Bool
    let nextState: OrderTimelineStep.Progress?

    private var railColor: Color {
        guard let nextState else { return Color.clear }
        switch nextState {
        case .done, .current, .stopped: return Color.yard.ink.opacity(0.5)
        case .upcoming: return Color.yard.line
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: Spacing.l) {
            VStack(spacing: 0) {
                OrderTimelineDot(state: step.state)
                    .frame(width: 22, height: 22)
                    .padding(.top, step.date == nil ? 0 : 18)
                if !isLast {
                    Rectangle()
                        .fill(railColor)
                        .frame(width: 1.5)
                        .frame(minHeight: 22, maxHeight: .infinity)
                        .padding(.vertical, Spacing.xs)
                }
            }
            .frame(width: 22)

            VStack(alignment: .leading, spacing: Spacing.xxs) {
                if let date = step.date {
                    Text(OrderText.stamp(date))
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
                Text(step.title)
                    .font(step.state == .current ? Font.yardHeadline : Font.yardBody)
                    .foregroundStyle(titleColor)
                if let detail = step.detail {
                    Text(detail)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, Spacing.xs)
                }
            }
            .padding(.bottom, isLast ? 0 : Spacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityValue(Text(accessibilityState))
    }

    private var titleColor: Color {
        switch step.state {
        case .done, .current: return Color.yard.ink
        case .upcoming: return Color.yard.ink3
        case .stopped: return Color.yard.danger
        }
    }

    private var accessibilityState: String {
        switch step.state {
        case .done: return "Done"
        case .current: return "Current step"
        case .upcoming: return "To come"
        case .stopped: return ""
        }
    }
}

/// Filled (done), pulsing (current), hollow (upcoming), cross (stopped).
struct OrderTimelineDot: View {
    let state: OrderTimelineStep.Progress
    @State private var pulse = false

    init(state: OrderTimelineStep.Progress) {
        self.state = state
    }

    var body: some View {
        ZStack {
            switch state {
            case .done:
                Circle().fill(Color.yard.ink)
                Image(systemName: "checkmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.yard.bg)
            case .current:
                Circle()
                    .fill(Color.yard.success.opacity(0.35))
                    .scaleEffect(pulse ? 1.9 : 0.8)
                    .opacity(pulse ? 0 : 1)
                Circle()
                    .fill(Color.yard.success)
                    .frame(width: 14, height: 14)
            case .upcoming:
                Circle()
                    .strokeBorder(Color.yard.ink3, lineWidth: 2)
                    .frame(width: 14, height: 14)
            case .stopped:
                Circle().fill(Color.yard.danger)
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Color.yard.onPhoto)
            }
        }
        .onAppear {
            guard state == .current else { return }
            withAnimation(.easeOut(duration: 1.5).repeatForever(autoreverses: false)) {
                pulse = true
            }
        }
    }
}

#Preview("Timeline — dark") {
    OrderTimelinePreview().preferredColorScheme(.dark)
}

#Preview("Timeline — light") {
    OrderTimelinePreview().preferredColorScheme(.light)
}

private struct OrderTimelinePreview: View {
    var body: some View {
        Card {
            OrderTimelineView(steps: [
                OrderTimelineStep(id: "paid", title: "Paid", date: Date().addingTimeInterval(-86_400 * 2), state: .done),
                OrderTimelineStep(id: "packed", title: "Packed", date: Date().addingTimeInterval(-86_400), state: .done),
                OrderTimelineStep(id: "shipped", title: "Shipped", date: Date().addingTimeInterval(-3_600), detail: "Your parcel is with the carrier.", state: .current),
                OrderTimelineStep(id: "out", title: "Out for delivery", state: .upcoming),
                OrderTimelineStep(id: "delivered", title: "Delivered", state: .upcoming),
            ])
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg)
    }
}
