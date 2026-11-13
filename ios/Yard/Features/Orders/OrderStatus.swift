import SwiftUI

/// The shopper's view of one brand order (the server's `states.merchant`), with the website's words
/// (src/components/market/account/order-status.tsx `customerOrderStatus`).
enum OrderStatus: String, CaseIterable, Sendable {
    case pendingPayment = "pending_payment"
    case paid
    case processing
    case shipped
    case delivered
    case cancelled
    case refundRequested = "refund_requested"
    case refunded

    /// Unknown values read as awaiting payment, as on the website.
    init(raw: String) {
        self = OrderStatus(rawValue: raw) ?? .pendingPayment
    }

    var label: String {
        switch self {
        case .pendingPayment: return "Awaiting payment"
        case .paid: return "Confirmed"
        case .processing: return "Being prepared"
        case .shipped: return "On its way"
        case .delivered: return "Delivered"
        case .cancelled: return "Cancelled"
        case .refundRequested: return "Return requested"
        case .refunded: return "Refunded"
        }
    }

    var note: String {
        switch self {
        case .pendingPayment: return "Not charged yet. The brand starts preparing it once the payment provider confirms payment."
        case .paid: return "The brand has your order and will start preparing it soon."
        case .processing: return "The brand is packing your order. Tracking follows when it ships."
        case .shipped: return "Your parcel is with the carrier."
        case .delivered: return "Delivered. Something not right? You can request a return."
        case .cancelled: return "Cancelled before it shipped."
        case .refundRequested: return "The brand is reviewing your return request."
        case .refunded: return "Your refund was issued to your original payment method."
        }
    }

    var tagStyle: Tag.Style {
        switch self {
        case .pendingPayment: return .violet
        case .paid: return .neutral
        case .processing: return .neutral
        case .shipped: return .acid
        case .delivered: return .success
        case .cancelled: return .danger
        case .refundRequested: return .violet
        case .refunded: return .neutral
        }
    }

    var systemImage: String {
        switch self {
        case .pendingPayment: return "clock"
        case .paid: return "checkmark.seal"
        case .processing: return "shippingbox"
        case .shipped: return "truck.box"
        case .delivered: return "house"
        case .cancelled: return "xmark.circle"
        case .refundRequested: return "arrow.uturn.backward"
        case .refunded: return "arrow.uturn.backward.circle"
        }
    }

    /// Still moving (the website's "In progress" filter).
    var isOpen: Bool {
        switch self {
        case .pendingPayment, .paid, .processing, .shipped, .refundRequested: return true
        case .delivered, .cancelled, .refunded: return false
        }
    }
}

/// The status chip on order rows: the badge words, never invented states.
struct OrderStatusChip: View {
    let status: OrderStatus

    init(status: OrderStatus) {
        self.status = status
    }

    var body: some View {
        Tag(status.label, style: status.tagStyle, systemImage: status.systemImage)
    }
}

/// "Cancelled before it was paid…" etc. (order-status.tsx `orderStatusNote`).
enum OrderStatusText {
    static func note(status: OrderStatus, payment: String) -> String {
        guard status == .cancelled else { return status.note }
        switch payment {
        case "pending", "failed": return "Cancelled before it was paid, so nothing was charged."
        case "refunded": return "Cancelled before it shipped, and marked refunded to your original payment method."
        default: return "Cancelled before it shipped. The refund goes back to your original payment method once the payment provider processes it."
        }
    }

    /// Payment line for a checkout group (server-orders-list.tsx).
    static func groupPayment(_ orders: [OrderSummary]) -> String {
        if orders.contains(where: { $0.states.payment == "failed" }) { return "Payment didn’t go through" }
        let settled: Set<String> = ["paid", "partially_refunded", "refunded"]
        if orders.allSatisfy({ settled.contains($0.states.payment) }) { return "Payment confirmed" }
        return "Awaiting payment confirmation"
    }

    /// Payment sentence for an order's details (server-order-detail.tsx).
    static func payment(_ state: String) -> String {
        switch state {
        case "failed": return "Payment didn’t go through; nothing was charged."
        case "pending": return "Payment confirmation is pending."
        default: return "Payment status: \(state.replacingOccurrences(of: "_", with: " "))."
        }
    }
}
