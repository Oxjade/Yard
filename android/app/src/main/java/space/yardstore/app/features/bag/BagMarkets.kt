package space.yardstore.app.features.bag

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Dialpad
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.ui.graphics.vector.ImageVector
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

// Delivery countries and their checkout rules, ported from the website (mirrors BagMarkets.swift):
//   src/config/markets.ts                       (countries + local currency)
//   src/components/market/checkout/rules.ts     (phone, region, postcode, payment methods)
// Plain values and functions so both the bag and the checkout read the same rules.

/** One delivery country Yard ships to. */
data class BagCountry(
    val code: String,
    val name: String,
    /** The country's own currency (decides the charge currency when the display one can't be charged). */
    val currency: String,
    /** "+234". */
    val dial: String,
    /** Length of the national number, without the trunk 0. */
    val phoneDigits: IntRange,
    val phoneExample: String,
    val regionLabel: String,
    val regionRequired: Boolean,
    /** When set, the region is chosen from this list. */
    val regionOptions: List<String>?,
    val postcodeLabel: String,
    val postcodeRequired: Boolean,
    /** Regex the postcode must match (case-insensitive) when given. */
    val postcodePattern: String,
    val postcodeExample: String,
) {
    val id: String get() = code
}

object BagMarkets {
    private val ngStates = listOf("Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "Federal Capital Territory", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara")
    private val ghRegions = listOf("Ahafo", "Ashanti", "Bono", "Bono East", "Central", "Eastern", "Greater Accra", "North East", "Northern", "Oti", "Savannah", "Upper East", "Upper West", "Volta", "Western", "Western North")
    private val zaProvinces = listOf("Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape")
    private const val DIGITS5 = "^\\d{5}$"

    /** Every country, in the website's order. */
    val countries: List<BagCountry> = listOf(
        BagCountry("NG", "Nigeria", "NGN", "+234", 10..10, "0803 123 4567", "State", true, ngStates, "Postcode", false, "^\\d{6}$", "101245"),
        BagCountry("GH", "Ghana", "GHS", "+233", 9..9, "024 123 4567", "Region", true, ghRegions, "GhanaPost GPS address", false, "^[A-Z]{2}-?\\d{1,4}-?\\d{4}$", "GA-183-8164"),
        BagCountry("KE", "Kenya", "KES", "+254", 9..9, "0712 345 678", "County", true, null, "Postal code", false, DIGITS5, "00100"),
        BagCountry("ZA", "South Africa", "ZAR", "+27", 9..9, "082 123 4567", "Province", true, zaProvinces, "Postal code", true, "^\\d{4}$", "2001"),
        BagCountry("GB", "United Kingdom", "GBP", "+44", 10..10, "07700 900123", "County", false, null, "Postcode", true, "^[A-Z]{1,2}\\d[A-Z\\d]?\\s?\\d[A-Z]{2}$", "E8 4DG"),
        BagCountry("FR", "France", "EUR", "+33", 9..9, "06 12 34 56 78", "Region", false, null, "Postcode", true, DIGITS5, "75011"),
        BagCountry("DE", "Germany", "EUR", "+49", 7..11, "01512 3456789", "State", false, null, "Postcode", true, DIGITS5, "10115"),
        BagCountry("US", "United States", "USD", "+1", 10..10, "(212) 555-0142", "State", true, null, "ZIP code", true, "^\\d{5}(-\\d{4})?$", "10001"),
        BagCountry("MX", "Mexico", "MXN", "+52", 10..10, "55 1234 5678", "State", true, null, "Postal code", true, DIGITS5, "06700"),
        BagCountry("JP", "Japan", "JPY", "+81", 9..10, "090-1234-5678", "Prefecture", true, null, "Postal code", true, "^\\d{3}-?\\d{4}$", "150-0001"),
        BagCountry("KR", "South Korea", "KRW", "+82", 9..10, "010-1234-5678", "Province or city", false, null, "Postal code", true, DIGITS5, "04524"),
    )

    fun country(code: String): BagCountry = countries.firstOrNull { it.code == code.uppercase() } ?: countries[0]

    fun isSupported(code: String): Boolean = countries.any { it.code == code.uppercase() }

    // Ship-to (persisted, like the website's session shipTo / shipToCity)

    private const val SHIP_TO_KEY = "yard.bag.shipTo"
    private const val SHIP_TO_CITY_KEY = "yard.bag.shipToCity"

    /**
     * The delivery country the bag quotes shipping for. Defaults to the device region when Yard
     * ships there, else Nigeria (the website's default).
     */
    var shipTo: String
        get() {
            val saved = Config.preferences?.getString(SHIP_TO_KEY, null)
            if (saved != null && isSupported(saved)) return saved.uppercase()
            val region = Locale.getDefault().country.orEmpty()
            return if (isSupported(region)) region.uppercase() else "NG"
        }
        set(value) {
            Config.preferences?.edit()?.putString(SHIP_TO_KEY, value.uppercase())?.apply()
        }

    var shipToCity: String?
        get() {
            val v = Config.preferences?.getString(SHIP_TO_CITY_KEY, null)?.trim().orEmpty()
            return v.ifEmpty { null }
        }
        set(value) {
            val v = value?.trim().orEmpty()
            val editor = Config.preferences?.edit() ?: return
            if (v.isEmpty()) editor.remove(SHIP_TO_CITY_KEY) else editor.putString(SHIP_TO_CITY_KEY, v.take(60))
            editor.apply()
        }

    // Phone

    private val phoneDigitsOnly = Regex("^\\+?\\d+$")

    /** Normalises a phone number to "+234 8031234567", or null if it doesn't fit the country. */
    fun parsePhone(raw: String, country: BagCountry): String? {
        var n = raw.filter { !" -().".contains(it) && !it.isWhitespace() }
        if (n.isEmpty() || !phoneDigitsOnly.matches(n)) return null
        if (n.startsWith("+")) {
            if (n.startsWith(country.dial)) {
                n = n.drop(country.dial.length)
            } else {
                val intl = n.drop(1)
                return if (intl.length in 8..15) "+$intl" else null
            }
        } else if (n.startsWith("00")) {
            return parsePhone("+" + n.drop(2), country)
        }
        if (n.startsWith("0")) n = n.drop(1)
        if (n.length !in country.phoneDigits) return null
        return "${country.dial} $n"
    }

    /** "Ikeja, Lagos", or just "Lagos" when the city and region match. */
    fun cityLine(city: String, region: String): String {
        val c = city.trim()
        val r = region.trim()
        return if (r.isNotEmpty() && r.lowercase() != c.lowercase()) "$c, $r" else c
    }

    /** Whether a non-empty postcode fits the country's pattern (case-insensitive). */
    fun postcodeMatches(postcode: String, country: BagCountry): Boolean =
        Regex(country.postcodePattern, RegexOption.IGNORE_CASE).containsMatchIn(postcode)

    // Charge currency and payment methods

    /**
     * What a checkout charges in: the display currency when the provider takes it, else the
     * delivery country's, else NGN when allowed, else the first allowed (rules.ts chargeCurrencyFor).
     */
    fun chargeCurrency(display: String, country: BagCountry, allowed: List<String>): String {
        val list = if (allowed.isEmpty()) listOf("NGN") else allowed.map { it.uppercase() }
        if (display.uppercase() in list) return display.uppercase()
        if (country.currency in list) return country.currency
        return if ("NGN" in list) "NGN" else list[0]
    }

    /** Methods offered for a country and charge currency (rules.ts paymentMethodsFor / bachsPaymentMethodsFor). */
    fun paymentMethods(country: String, currency: String, provider: String): List<BagPaymentMethod> {
        if (provider == "bachs") {
            if (currency == "NGN") return listOf(BagPaymentMethod.Card, BagPaymentMethod.BankTransfer)
            if (currency == "GHS" || currency == "KES") return listOf(BagPaymentMethod.MobileMoney)
            return listOf(BagPaymentMethod.Card)
        }
        return when (country to currency) {
            "NG" to "NGN" -> listOf(BagPaymentMethod.Card, BagPaymentMethod.BankTransfer, BagPaymentMethod.Ussd)
            "GH" to "GHS" -> listOf(BagPaymentMethod.Card, BagPaymentMethod.MobileMoney)
            "KE" to "KES" -> listOf(BagPaymentMethod.Card, BagPaymentMethod.MobileMoney)
            "ZA" to "ZAR" -> listOf(BagPaymentMethod.Card, BagPaymentMethod.BankTransfer)
            else -> listOf(BagPaymentMethod.Card)
        }
    }

    /** "Paystack" / "Bachs". */
    fun providerName(provider: String): String = if (provider == "bachs") "Bachs" else "Paystack"

    // Delivery estimates

    private val dayFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("d MMM", Locale.UK).withZone(ZoneOffset.UTC)
    private val dayNumberFormatter: DateTimeFormatter = DateTimeFormatter.ofPattern("d", Locale.UK).withZone(ZoneOffset.UTC)

    /** "11–16 Nov", "30 Nov – 2 Dec", "11 Nov" from calendar dates ("2026-11-11"); null without both. */
    fun arrivalRange(from: String?, to: String?): String? {
        if (from == null || to == null) return null
        val a = YardDate.parse(from) ?: return null
        val b = YardDate.parse(to) ?: return null
        if (from == to) return dayFormatter.format(a)
        if (from.take(7) == to.take(7)) return "${dayNumberFormatter.format(a)}–${dayFormatter.format(b)}"
        return "${dayFormatter.format(a)} – ${dayFormatter.format(b)}"
    }
}

/**
 * How the shopper will pay (the server's PAYMENT_METHODS). Card details are typed on the
 * provider's hosted page, never in the app.
 */
enum class BagPaymentMethod(val rawValue: String) {
    Card("card"),
    BankTransfer("bank_transfer"),
    Ussd("ussd"),
    MobileMoney("mobile_money");

    val id: String get() = rawValue

    fun title(country: String): String = when (this) {
        Card -> "Card"
        BankTransfer -> if (country == "ZA") "Instant EFT" else "Bank transfer"
        Ussd -> "USSD"
        MobileMoney -> if (country == "KE") "M-Pesa or Airtel Money" else "Mobile money"
    }

    fun detail(country: String): String = when (this) {
        Card -> if (country == "NG") "Visa, Mastercard and Verve" else "Visa, Mastercard and American Express"
        BankTransfer -> if (country == "ZA") "Instant EFT from your banking app" else "Pay into a one-time account number"
        Ussd -> "Dial a short code from your phone, no data needed"
        MobileMoney -> if (country == "KE") "Approve the prompt on your phone" else "MTN MoMo, Telecel Cash or AirtelTigo Money"
    }

    /** What the provider's page asks for (rules.ts paymentMethodNext). */
    fun next(country: String, providerName: String): String = when (this) {
        Card -> "Yard never sees or stores your card number."
        BankTransfer -> if (country == "ZA" && providerName == "Paystack") {
            "Paystack takes you to your bank to approve the payment. Brands start preparing orders once it clears."
        } else {
            "$providerName shows a one-time account number and the exact amount to send from your banking app."
        }
        Ussd -> "$providerName shows the code to dial for your bank. Dial it from the phone number linked to your account."
        MobileMoney -> "$providerName asks for your mobile money number and sends a prompt to approve on your phone."
    }

    val icon: ImageVector
        get() = when (this) {
            Card -> Icons.Outlined.CreditCard
            BankTransfer -> Icons.Outlined.AccountBalance
            Ussd -> Icons.Outlined.Dialpad
            MobileMoney -> Icons.Outlined.PhoneIphone
        }
}
