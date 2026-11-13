package space.yardstore.app.core.models

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config

// Public catalogue product, exactly as GET /api/catalog/products and
// GET /api/catalog/products/{slug} send it (src/server/catalog/dto.ts `toPublicProduct` plus the
// `brand` summary from src/server/catalog/public.ts `brandSummary`). Mirrors Models/Product.swift.
//
//   GET /api/catalog/products?brand=&category=&subcategory=&collection=&tag=&drop=&ids=&ids=&inStock=1
//                            &sort=new|price_asc|price_desc|title&limit=1…60&offset=
//       → ProductsPage { products, total, nextOffset }
//   GET /api/catalog/products/{slug or id} → ProductResponse { product }

/** One product image. `src` is relative (`/api/media/…`); use [url]. */
@Serializable
data class ProductImage(
    val id: String = "",
    val src: String = "",
    val alt: String = "",
    val width: Int? = null,
    val height: Int? = null,
    val mediaId: String? = null,
) {
    /** Absolute URL for [src]. */
    val url: String? get() = Config.url(src)

    /** width / height, or null when unknown. */
    val aspectRatio: Double?
        get() {
            val w = width ?: return null
            val h = height ?: return null
            if (w <= 0 || h <= 0) return null
            return w.toDouble() / h.toDouble()
        }
}

/** An option axis, e.g. name "Size", values S/M/L; or "Colour" with hex swatches. */
@Serializable
data class ProductOption(
    val name: String = "",
    val values: List<Value> = emptyList(),
) {
    @Serializable
    data class Value(val value: String = "", val hex: String? = null)
}

/** A purchasable variant. Add to bag with `variantId`. */
@Serializable
data class ProductVariant(
    val id: String,
    val sku: String = "",
    /** Option name → value, e.g. {"Size": "M", "Colour": "Black"}. */
    val options: Map<String, String> = emptyMap(),
    /** "Size M, Black". */
    val label: String = "",
    val priceMinor: Int = 0,
    val available: Int = 0,
    val inStock: Boolean = available > 0,
)

/** The brand summary joined onto every public product. */
@Serializable
data class BrandSummary(
    val id: String,
    val handle: String = id,
    val name: String = "",
    val verified: Boolean = false,
    val city: String? = null,
    val country: String? = null,
    val currency: String? = null,
    /** The "Founding brand" badge. */
    val foundingBadge: Boolean = false,
    /** False while a founding brand isn't selling yet: show "Notify me" instead of Add to bag. */
    val forSale: Boolean = true,
    /** The brand has a published storefront (its name can link to the brand profile). */
    val hasStorefront: Boolean = true,
)

/** A public product (PublicProductDto + brand). */
@Serializable
data class Product(
    val id: String,
    val slug: String = id,
    val brandId: String = "",
    val title: String = "",
    val description: String = "",
    /** Bullet points ("100% cotton", …). */
    val details: List<String> = emptyList(),
    /** Category slug, e.g. "tops". */
    val category: String = "",
    val subcategory: String? = null,
    val tags: List<String> = emptyList(),
    /** Merchandising badges, e.g. "new", "limited". */
    val badges: List<String> = emptyList(),
    /** Base price in minor units of [currency] (a variant may differ: use `variant.priceMinor`). */
    val priceMinor: Int = 0,
    /** The "was" price, when on sale. */
    val compareAtMinor: Int? = null,
    val currency: String = "USD",
    val images: List<ProductImage> = emptyList(),
    val options: List<ProductOption> = emptyList(),
    val variants: List<ProductVariant> = emptyList(),
    /** Units available across variants. */
    val available: Int = 0,
    /** [min, max] processing days before dispatch, or null. */
    val processingDays: List<Int>? = null,
    val dropId: String? = null,
    val collectionIds: List<String> = emptyList(),
    val publishedAt: String? = null,
    val createdAt: String = "",
    /** The brand summary (present on list and detail responses). */
    val brand: BrandSummary? = null,
) {
    /** The base price as [Money]. */
    val price: Money get() = Money(priceMinor, currency)

    /** The compare-at price as [Money], only when it is above the price. */
    val compareAt: Money?
        get() {
            val c = compareAtMinor ?: return null
            return if (c > priceMinor) Money(c, currency) else null
        }

    /** The first image, if any. */
    val coverImage: ProductImage? get() = images.firstOrNull()
    /** Absolute URL of the first image. */
    val coverUrl: String? get() = images.firstOrNull()?.url
    /** Image aspect (w/h) for masonry tiles; 4:5 when the image size is unknown. */
    val tileAspectRatio: Double get() = images.firstOrNull()?.aspectRatio ?: 0.8
    /** Nothing left to buy. */
    val isSoldOut: Boolean get() = available <= 0
    /** The brand isn't selling yet (founding brand before launch). */
    val isNotForSale: Boolean get() = brand?.forSale == false

    /** Lowest and highest variant prices (minor units); null when there are no variants. */
    val variantPriceRange: IntRange?
        get() {
            val prices = variants.map { it.priceMinor }
            val lo = prices.minOrNull() ?: return null
            val hi = prices.maxOrNull() ?: return null
            return lo..hi
        }

    /** "Ships in 2–4 days" style text, or null. */
    val processingText: String?
        get() {
            val p = processingDays ?: return null
            if (p.size != 2) return null
            return if (p[0] == p[1]) "Ships in ${p[0]} days" else "Ships in ${p[0]}–${p[1]} days"
        }

    /** Has the "new" badge (case-insensitive). */
    val isNew: Boolean get() = badges.any { it.lowercase() == "new" }
}

/** GET /api/catalog/products. */
@Serializable
data class ProductsPage(
    val products: List<Product> = emptyList(),
    val total: Int = 0,
    /** Pass as `offset` for the next page; null at the end. */
    val nextOffset: Int? = null,
)

/** GET /api/catalog/products/{slug}. */
@Serializable
data class ProductResponse(val product: Product)
