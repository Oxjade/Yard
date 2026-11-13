package space.yardstore.app.core.models

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config

// Public brand cards: GET /api/catalog/brands (src/lib/api/public-brands.ts). Mirrors Models/Brand.swift.
//
//   GET /api/catalog/brands?q=&category=&country=&founding=1|0&exclude=&sort=name|new&limit=&offset=
//       → BrandsPage { brands, total, nextOffset }

/** A listed brand, as the directory / "brands like this" / welcome flow show it. */
@Serializable
data class BrandCard(
    val id: String,
    val handle: String = id,
    val name: String = "",
    val city: String = "",
    val country: String = "",
    /** Category slugs. */
    val categories: List<String> = emptyList(),
    /** About 160 characters of the brand story, or null. */
    val story: String? = null,
    val logoSrc: String? = null,
    val coverSrc: String? = null,
    val verified: Boolean = false,
    val founding: Boolean = false,
    val foundingBadge: Boolean = false,
    /** False while a founding brand isn't selling yet ("Opening soon"). */
    val forSale: Boolean = true,
    /** When the brand went public. */
    val listedAt: String? = null,
) {
    val logoUrl: String? get() = Config.url(logoSrc)
    val coverUrl: String? get() = Config.url(coverSrc)
    /** "Lagos, NG". */
    val locationText: String get() = listOf(city, country).filter { it.isNotEmpty() }.joinToString(", ")
    /** Two letters for a brand without a logo. */
    val monogram: String get() = monogram(name)

    companion object {
        /** Same rule as the website's `brandMonogram`: first two letters/digits, uppercased, else "Y". */
        fun monogram(name: String): String {
            val sb = StringBuilder()
            var i = 0
            while (i < name.length && sb.codePointCount(0, sb.length) < 2) {
                val cp = name.codePointAt(i)
                if (Character.isLetterOrDigit(cp)) sb.appendCodePoint(cp)
                i += Character.charCount(cp)
            }
            return if (sb.isEmpty()) "Y" else sb.toString().uppercase()
        }
    }
}

/** GET /api/catalog/brands. */
@Serializable
data class BrandsPage(
    val brands: List<BrandCard> = emptyList(),
    val total: Int = 0,
    val nextOffset: Int? = null,
)
