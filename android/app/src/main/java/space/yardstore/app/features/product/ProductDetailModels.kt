package space.yardstore.app.features.product

import kotlinx.serialization.Serializable
import space.yardstore.app.core.models.Money
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// Product-feature-only DTOs (not shared models). Mirrors Features/Product/ProductDetailModels.swift.
//
//   GET    /api/shipping/estimate?product=&to=&city=&qty=&cur=   → ProductEstimate (public)
//   GET    /api/wishlist/back-in-stock/{variantId}               → ProductBackInStockWatch (shopper)
//   POST   /api/wishlist/back-in-stock  { variantId }            → start watching a variant
//   DELETE /api/wishlist/back-in-stock/{variantId}               → stop watching
//
// Shapes from src/lib/api/contracts/shipping.ts (`estimateResponse`, `quoteOptionDto`,
// `estimateDto`, `shippingBrandDto`) and src/components/market/back-in-stock-button.tsx.

/** GET /api/shipping/estimate: how this piece ships to the shopper's country. */
@Serializable
data class ProductEstimate(
    val brand: Brand? = null,
    /** Business days to pack and hand over, [min, max]. */
    val handling: List<Int> = emptyList(),
    val options: List<Option> = emptyList(),
    val unavailable: Boolean = false,
    val reason: String? = null,
    val cutoffAt: String? = null,
) {
    @Serializable
    data class Brand(
        val name: String = "",
        val originCity: String = "",
        val originCountry: String = "",
        val cutoffLocal: String? = null,
    )

    @Serializable
    data class Dates(
        val arrivalFrom: String? = null,
        val arrivalTo: String? = null,
    )

    @Serializable
    data class Option(
        val service: String = "standard",
        val label: String = "",
        val available: Boolean = false,
        val free: Boolean = false,
        val price: Money? = null,
        /** Business days in transit, [min, max]. */
        val transit: List<Int> = emptyList(),
        val estimate: Dates? = null,
    )

    /** Parcel options that can be chosen (pickup left out), as the website's `parcel()`. */
    val parcelOptions: List<Option> get() = options.filter { it.available && it.service != "pickup" }

    /** Standard, else the first parcel option. */
    val standard: Option? get() = parcelOptions.firstOrNull { it.service == "standard" } ?: parcelOptions.firstOrNull()

    val express: Option? get() = parcelOptions.firstOrNull { it.service == "express" }
}

/** GET /api/wishlist/back-in-stock/{variantId}. */
@Serializable
data class ProductBackInStockWatch(
    val variantId: String = "",
    val watching: Boolean = false,
)

/** POST /api/wishlist/back-in-stock body. */
@Serializable
data class ProductBackInStockBody(val variantId: String)

/** Formatting helpers that port src/lib/shipping/format.ts. */
object ProductShippingFormat {
    /** "1–3 business days", "1 business day", "the same business day". */
    fun businessDays(range: List<Int>): String? {
        if (range.size != 2) return null
        val a = range[0]
        val b = range[1]
        if (b <= 0) return "the same business day"
        if (a == b) return "$a business ${if (a == 1) "day" else "days"}"
        return "$a–$b business days"
    }

    private val dayMonth: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d MMM", Locale.UK)
    private val dayOnly: DateTimeFormatter = DateTimeFormatter.ofPattern("EEE d", Locale.UK)
    private val monthOnly: DateTimeFormatter = DateTimeFormatter.ofPattern("MMM", Locale.UK)

    private fun parseDay(s: String): LocalDate? = runCatching { LocalDate.parse(s.take(10)) }.getOrNull()

    /** "Tue 18 – Fri 21 Nov" (same month) or "Fri 28 Nov – Tue 2 Dec". */
    fun range(from: String, to: String): String? {
        val a = parseDay(from) ?: return null
        val b = parseDay(to) ?: return null
        if (from.take(10) == to.take(10)) return dayMonth.format(a)
        if (from.take(7) == to.take(7)) return "${dayOnly.format(a)} – ${dayOnly.format(b)} ${monthOnly.format(b)}"
        return "${dayMonth.format(a)} – ${dayMonth.format(b)}"
    }
}
