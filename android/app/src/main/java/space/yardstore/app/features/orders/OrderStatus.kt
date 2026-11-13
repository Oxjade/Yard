package space.yardstore.app.features.orders

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.AssignmentReturn
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LocalShipping
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle

/**
 * The shopper's view of one brand order (the server's `states.merchant`), with the website's words
 * (src/components/market/account/order-status.tsx `customerOrderStatus`). Mirrors OrderStatus.swift.
 */
enum class OrderStatus(val rawValue: String) {
    PendingPayment("pending_payment"),
    Paid("paid"),
    Processing("processing"),
    Shipped("shipped"),
    Delivered("delivered"),
    Cancelled("cancelled"),
    RefundRequested("refund_requested"),
    Refunded("refunded");

    val label: String
        get() = when (this) {
            PendingPayment -> "Awaiting payment"
            Paid -> "Confirmed"
            Processing -> "Being prepared"
            Shipped -> "On its way"
            Delivered -> "Delivered"
            Cancelled -> "Cancelled"
            RefundRequested -> "Return requested"
            Refunded -> "Refunded"
        }

    val note: String
        get() = when (this) {
            PendingPayment -> "Not charged yet. The brand starts preparing it once the payment provider confirms payment."
            Paid -> "The brand has your order and will start preparing it soon."
            Processing -> "The brand is packing your order. Tracking follows when it ships."
            Shipped -> "Your parcel is with the carrier."
            Delivered -> "Delivered. Something not right? You can request a return."
            Cancelled -> "Cancelled before it shipped."
            RefundRequested -> "The brand is reviewing your return request."
            Refunded -> "Your refund was issued to your original payment method."
        }

    val tagStyle: TagStyle
        get() = when (this) {
            PendingPayment -> TagStyle.Violet
            Paid -> TagStyle.Neutral
            Processing -> TagStyle.Neutral
            Shipped -> TagStyle.Acid
            Delivered -> TagStyle.Success
            Cancelled -> TagStyle.Danger
            RefundRequested -> TagStyle.Violet
            Refunded -> TagStyle.Neutral
        }

    /** SF Symbols clock / checkmark.seal / shippingbox / truck.box / house / xmark.circle / arrow.uturn… */
    val icon: ImageVector
        get() = when (this) {
            PendingPayment -> Icons.Outlined.Schedule
            Paid -> Icons.Outlined.Verified
            Processing -> Icons.Outlined.Inventory2
            Shipped -> Icons.Outlined.LocalShipping
            Delivered -> Icons.Outlined.Home
            Cancelled -> Icons.Outlined.Cancel
            RefundRequested -> Icons.AutoMirrored.Outlined.Undo
            Refunded -> Icons.AutoMirrored.Outlined.AssignmentReturn
        }

    /** Still moving (the website's "In progress" filter). */
    val isOpen: Boolean
        get() = when (this) {
            PendingPayment, Paid, Processing, Shipped, RefundRequested -> true
            Delivered, Cancelled, Refunded -> false
        }

    companion object {
        /** Unknown values read as awaiting payment, as on the website. */
        fun from(raw: String): OrderStatus = entries.firstOrNull { it.rawValue == raw } ?: PendingPayment
    }
}

/** The status chip on order rows: the badge words, never invented states. */
@Composable
fun OrderStatusChip(status: OrderStatus, modifier: Modifier = Modifier) {
    Tag(status.label, modifier = modifier, style = status.tagStyle, icon = status.icon)
}

/** "Cancelled before it was paid…" etc. (order-status.tsx `orderStatusNote`). */
object OrderStatusText {
    fun note(status: OrderStatus, payment: String): String {
        if (status != OrderStatus.Cancelled) return status.note
        return when (payment) {
            "pending", "failed" -> "Cancelled before it was paid, so nothing was charged."
            "refunded" -> "Cancelled before it shipped, and marked refunded to your original payment method."
            else -> "Cancelled before it shipped. The refund goes back to your original payment method once the payment provider processes it."
        }
    }

    /** Payment line for a checkout group (server-orders-list.tsx). */
    fun groupPayment(orders: List<OrderSummary>): String {
        if (orders.any { it.states.payment == "failed" }) return "Payment didn’t go through"
        val settled = setOf("paid", "partially_refunded", "refunded")
        if (orders.all { it.states.payment in settled }) return "Payment confirmed"
        return "Awaiting payment confirmation"
    }

    /** Payment sentence for an order's details (server-order-detail.tsx). */
    fun payment(state: String): String = when (state) {
        "failed" -> "Payment didn’t go through; nothing was charged."
        "pending" -> "Payment confirmation is pending."
        else -> "Payment status: ${state.replace("_", " ")}."
    }
}
