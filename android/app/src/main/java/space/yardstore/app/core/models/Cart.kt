package space.yardstore.app.core.models

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config

// The server cart (src/server/cart/index.ts CartView, src/server/cart/pricing.ts). Mirrors Models/Cart.swift.
//
//   GET    /api/cart?currency=USD&to=NG&city=Lagos → Cart   (anonymous carts use the yard_cart cookie)
//   POST   /api/cart/lines { variantId, qty }      → 201 { ok }   (409 "Only 2 left." etc.)
//   PATCH  /api/cart/lines/{variantId} { qty }     → { ok }       (qty 0 removes)
//   DELETE /api/cart/lines/{variantId}             → 204
//   DELETE /api/cart                               → 204 (empties)
//
// Use `CartStore` rather than calling these directly.

@Serializable
data class Cart(
    val id: String? = null,
    /** Display currency every `*Minor` amount here is in. */
    val currency: String = "USD",
    /** Units across available lines (the Bag badge). */
    val itemCount: Int = 0,
    val subtotalMinor: Int = 0,
    val lines: List<CartLine> = emptyList(),
    /** Lines grouped per brand (each brand ships its own part), with shipping when `to` was given. */
    val groups: List<CartGroup> = emptyList(),
    /** Plain sentences about lines needing attention ("Only 1 of Tee (Size M) left."). */
    val issues: List<String> = emptyList(),
    val removedSample: Int = 0,
    val destination: Destination? = null,
) {
    @Serializable
    data class Destination(val country: String = "", val city: String? = null)

    val subtotal: Money get() = Money(subtotalMinor, currency)
    val isEmpty: Boolean get() = lines.isEmpty()

    /** Lines of one brand group, in group order. */
    fun lines(group: CartGroup): List<CartLine> =
        group.variantIds.mapNotNull { id -> lines.firstOrNull { it.variantId == id } }

    companion object {
        fun empty(currency: String): Cart = Cart(id = null, currency = currency)
    }
}

/** `unitPrice` arrives as `{ amountMinor, currency }`. */
@Serializable
data class CartUnitPrice(val amountMinor: Int = 0, val currency: String = "USD")

/** One cart line (one variant). */
@Serializable
data class CartLine(
    val variantId: String,
    val productId: String? = null,
    val brandId: String? = null,
    val title: String? = null,
    /** "Size M, Black". */
    val variantLabel: String? = null,
    /** Relative image path; use [imageUrl]. */
    val imagePath: String? = null,
    val qty: Int = 1,
    val available: Int = 0,
    /** Catalogue price in the brand's currency, as sent (`{ amountMinor, currency }`); use [unitPrice]. */
    @SerialName("unitPrice") val unitPriceWire: CartUnitPrice? = null,
    /** Unit price in the cart's display currency. */
    val unitMinor: Int = 0,
    /** `unitMinor * qty`. */
    val lineMinor: Int = 0,
    /** "ok" | "short" | "unavailable". */
    val status: String = "ok",
    /** "gone" | "sold_out" | "not_for_sale". */
    val unavailableReason: String? = null,
    val brandName: String? = null,
) {
    val id: String get() = variantId
    /** Catalogue price in the brand's currency. */
    val unitPrice: Money? get() = unitPriceWire?.let { Money(it.amountMinor, it.currency) }
    val imageUrl: String? get() = Config.url(imagePath)
    val isUnavailable: Boolean get() = status == "unavailable"
    val isShort: Boolean get() = status == "short"
}

/** A brand's part of the cart. */
@Serializable
data class CartGroup(
    val brandId: String = "",
    val variantIds: List<String> = emptyList(),
    val subtotalMinor: Int = 0,
    /** Delivery options (only when the cart was read with `to=`). */
    val shipping: ShippingQuote? = null,
) {
    val id: String get() = brandId
}

/** Shipping quote for one brand group. */
@Serializable
data class ShippingQuote(
    val brandId: String = "",
    val brandName: String = "",
    val unavailable: Boolean = false,
    val reason: String? = null,
    val options: List<ShippingOption> = emptyList(),
)

@Serializable
data class ShippingOption(
    /** "standard" | "express" | "pickup". */
    val service: String = "",
    val label: String = "",
    val available: Boolean = true,
    val reason: String? = null,
    val priceMinor: Int = 0,
    val currency: String = "USD",
    val free: Boolean = false,
) {
    val id: String get() = service
    val price: Money get() = Money(priceMinor, currency)
}

/** POST /api/cart/lines body. */
@Serializable
data class AddCartLineBody(val variantId: String, val qty: Int)

/** PATCH /api/cart/lines/{variantId} body. */
@Serializable
data class SetCartLineBody(val qty: Int)
