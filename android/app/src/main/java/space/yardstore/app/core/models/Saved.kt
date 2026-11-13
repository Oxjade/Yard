package space.yardstore.app.core.models

import kotlinx.serialization.Serializable

// Follows and the wishlist (src/server/follows/index.ts). All need a signed-in shopper except counts.
// Mirrors Models/Saved.swift.
//
//   GET    /api/follows                        → { items: [FollowedBrand] }
//   POST   /api/follows { brandId }            → FollowResult
//   DELETE /api/follows/{brandId}              → FollowResult
//   GET    /api/follows/counts?brandIds=a&brandIds=b → { counts: { brandId: Int } }   (public)
//   GET    /api/wishlist                       → { items: [WishlistItem] }
//   POST   /api/wishlist { productId }         → SaveResult
//   DELETE /api/wishlist/{productId}           → SaveResult
//
// Use `FollowStore` / `SavedStore`.

/** A brand the shopper follows. */
@Serializable
data class FollowedBrand(
    val brandId: String,
    val followedAt: String = "",
    val handle: String = brandId,
    val name: String = "",
    val city: String? = null,
    val country: String? = null,
    val verified: Boolean = false,
    /** Public follower count (baseline + real follows). */
    val followers: Int = 0,
) {
    val id: String get() = brandId
}

/** POST/DELETE /api/follows result. */
@Serializable
data class FollowResult(
    val brandId: String = "",
    val following: Boolean = false,
    /** The brand's follower count after the change. */
    val followers: Int = 0,
)

@Serializable
data class FollowsResponse(val items: List<FollowedBrand> = emptyList())

@Serializable
data class FollowCountsResponse(val counts: Map<String, Int> = emptyMap())

/** A saved (wishlisted) piece. No image comes with it: load the product by `slug` (or `ids=`) for one. */
@Serializable
data class WishlistItem(
    val productId: String,
    val brandId: String = "",
    val savedAt: String = "",
    val title: String? = null,
    val slug: String? = null,
    val brandName: String? = null,
    /** Units available, or null when unknown. */
    val available: Int? = null,
    /** Lowest current price (`{ amount, currency }`). */
    val price: Money? = null,
    /** False when the product was unpublished or hidden since it was saved. */
    val listed: Boolean = true,
    /** Variants with a pending back-in-stock watch. */
    val backInStockVariantIds: List<String> = emptyList(),
) {
    val id: String get() = productId
}

@Serializable
data class WishlistResponse(val items: List<WishlistItem> = emptyList())

/** POST/DELETE /api/wishlist result. */
@Serializable
data class SaveResult(val productId: String = "", val saved: Boolean = false)

/** POST /api/follows body. */
@Serializable
data class FollowBody(val brandId: String)

/** POST /api/wishlist body. */
@Serializable
data class WishlistBody(val productId: String)
