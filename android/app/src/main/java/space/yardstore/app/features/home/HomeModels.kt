package space.yardstore.app.features.home

import kotlinx.serialization.Serializable
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.Product

// Home-only models. Mirrors ios/Yard/Features/Home/HomeModels.swift.
// Everything shared (Product, BrandCard, Drop) comes from core/models.

/**
 * One marketplace category: GET /api/catalog/categories → `{ categories: [...] }`
 * (src/server/catalog/public.ts `publicCategories`).
 */
@Serializable
data class HomeCategory(
    val slug: String,
    val name: String = slug,
    val productCount: Int = 0,
) {
    val id: String get() = slug
}

@Serializable
data class HomeCategoriesResponse(val categories: List<HomeCategory> = emptyList())

/** GET /api/inbox/unread → `{ conversations }` (shopper only). */
@Serializable
data class HomeInboxUnread(val conversations: Int? = null)

/** GET /api/notifications?as=shopper → `{ items: [{ id, read, … }] }`. */
@Serializable
data class HomeNotificationsResponse(val items: List<Item> = emptyList()) {
    @Serializable
    data class Item(val id: String = "", val read: Boolean? = null)
}

/** The tabs across the top of Home. */
sealed interface HomeTab {
    data object ForYou : HomeTab
    data object Following : HomeTab
    data class Category(val category: HomeCategory) : HomeTab

    val id: String
        get() = when (this) {
            ForYou -> "for-you"
            Following -> "following"
            is Category -> "category-${category.slug}"
        }

    val title: String
        get() = when (this) {
            ForYou -> "For you"
            Following -> "Following"
            is Category -> category.name
        }
}

/** One tile of the masonry feed. */
sealed interface HomeFeedItem {
    data class ProductItem(val product: Product) : HomeFeedItem
    data class BrandItem(val brand: BrandCard) : HomeFeedItem
    data class DropItem(val drop: Drop) : HomeFeedItem

    val id: String
        get() = when (this) {
            is ProductItem -> "p-${product.id}"
            is BrandItem -> "b-${brand.id}"
            is DropItem -> "d-${drop.id}"
        }
}

/** Deterministic tile shapes (stable across launches; the same numbers as iOS). */
object HomeShape {
    /** Product image aspects (w÷h) used when the API sends no image size: 4:5, 2:3, 3:4, 1:1, 3:4. */
    val productAspects: List<Double> = listOf(0.8, 0.6667, 0.75, 1.0, 0.75)
    const val DROP_RATIO: Float = 1.3f

    /** djb2 over UTF-8, modulo 1_000_003 (same numbers as iOS `HomeShape.stableHash`). */
    fun stableHash(s: String): Int {
        var h: ULong = 5381u
        for (byte in s.encodeToByteArray()) {
            h = h * 33u + byte.toUByte().toULong()
        }
        return (h % 1_000_003u).toInt()
    }

    /** Brand cover tiles: h÷w between 1.15 and 1.5. */
    fun brandRatio(id: String): Float {
        val ratios = floatArrayOf(1.15f, 1.35f, 1.5f, 1.25f)
        return ratios[stableHash(id) % ratios.size]
    }

    /**
     * Products whose cover has no width/height get a stable per-id size so the masonry varies.
     * (ProductTile reads `tileAspectRatio` from the first image, so we give that image a size.)
     */
    fun shaped(p: Product): Product {
        val first = p.images.firstOrNull() ?: return p
        if (first.aspectRatio != null) return p
        val aspect = productAspects[stableHash(p.id) % productAspects.size]
        val sized = first.copy(width = (aspect * 1000).toInt(), height = 1000)
        return p.copy(images = listOf(sized) + p.images.drop(1))
    }
}
