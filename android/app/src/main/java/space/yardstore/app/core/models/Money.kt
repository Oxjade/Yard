package space.yardstore.app.core.models

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Formatters
import java.math.BigDecimal
import java.text.DecimalFormat
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * An amount in integer minor units (cents, kobo…) plus an ISO currency code, as the API sends it.
 * The API's field names vary: products use `priceMinor` + `currency`, the wishlist uses
 * `{ amount, currency }` (decoded straight into [Money]), carts use `unitMinor`/`lineMinor`.
 */
@Serializable
data class Money(
    /** Minor units (e.g. 4500 = $45.00; JPY/KRW have no minor unit). */
    val amount: Int,
    /** ISO 4217 code, e.g. "USD", "NGN". */
    val currency: String,
) {
    /** "$45", "$45.50", "₦12,000", "MX$640" — same rules as the website's `formatMoney`. */
    val formatted: String get() = MoneyFormatter.format(amount, currency)
}

/** Port of the website's `src/lib/money.ts` + `src/config/markets.ts` currency table. */
object MoneyFormatter {
    data class CurrencyInfo(val symbol: String, val minor: Int, val locale: String)

    /** The website's currencies. Unknown codes fall back to 2 minor digits and the code as symbol. */
    val currencies: Map<String, CurrencyInfo> = mapOf(
        "USD" to CurrencyInfo("$", 2, "en_US"),
        "NGN" to CurrencyInfo("₦", 2, "en_NG"),
        "GBP" to CurrencyInfo("£", 2, "en_GB"),
        "EUR" to CurrencyInfo("€", 2, "de_DE"),
        "GHS" to CurrencyInfo("GH₵", 2, "en_GH"),
        "KES" to CurrencyInfo("KSh", 2, "en_KE"),
        "ZAR" to CurrencyInfo("R", 2, "en_ZA"),
        "JPY" to CurrencyInfo("¥", 0, "ja_JP"),
        "KRW" to CurrencyInfo("₩", 0, "ko_KR"),
        "MXN" to CurrencyInfo("MX$", 2, "es_MX"),
    )

    fun info(currency: String): CurrencyInfo =
        currencies[currency.uppercase()] ?: CurrencyInfo(currency.uppercase(), 2, "en_US")

    /** Minor units → major units (4500 USD → 45.0). */
    fun toMajor(minor: Int, currency: String): Double {
        val digits = info(currency).minor
        var divisor = 1.0
        repeat(digits) { divisor *= 10 }
        return minor.toDouble() / divisor
    }

    /**
     * Formats minor units. Cents show only when the amount has them (unless [showCents]).
     * [compact] gives "$1.2K".
     */
    fun format(minor: Int, currency: String, showCents: Boolean? = null, compact: Boolean = false): String {
        val code = currency.uppercase()
        val c = info(code)
        val major = toMajor(minor, code)
        if (compact) return c.symbol + Formatters.compactNumber(major)
        val parts = c.locale.split("_")
        val locale = Locale(parts[0], parts.getOrElse(1) { "" })
        val f = NumberFormat.getCurrencyInstance(locale)
        runCatching { f.currency = Currency.getInstance(code) }
        if (f is DecimalFormat) {
            val symbols = f.decimalFormatSymbols
            symbols.currencySymbol = c.symbol
            f.decimalFormatSymbols = symbols
        }
        val wantsCents = showCents ?: (BigDecimal.valueOf(major).stripTrailingZeros().scale() > 0)
        f.minimumFractionDigits = if (wantsCents) c.minor else 0
        f.maximumFractionDigits = c.minor
        var out = f.format(major)
        // A prefix symbol sits against the number ("KSh8,296", not "KSh 8,296").
        if (out.startsWith(c.symbol)) {
            val rest = out.substring(c.symbol.length).trimStart(' ', ' ', ' ')
            out = c.symbol + rest
        }
        return out
    }
}
