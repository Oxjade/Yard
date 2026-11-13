package space.yardstore.app.core.models

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import java.util.UUID

// A brand's public storefront: GET /api/catalog/storefronts/{handle or brand id}
// (src/lib/api/storefront.ts `PublicStorefrontDto`). 404 "That brand isn't on Yard." when unlisted.
// Collection page: GET /api/catalog/storefronts/{handle}/collections/{collection}.
// Products of the brand: GET /api/catalog/products?brand={handle}.
// Follower count: `FollowStore.followerCounts(...)` (GET /api/follows/counts) — never invent it.
// Mirrors Models/Storefront.swift.

/** GET /api/catalog/storefronts/{handle}. */
@Serializable
data class PublicStorefront(
    val brand: StorefrontBrand,
    /** The live storefront version, or null when the brand hasn't published one. */
    val storefront: StorefrontVersion? = null,
    val collections: List<StorefrontCollection> = emptyList(),
)

@Serializable
data class StorefrontBrand(
    val id: String,
    val handle: String = id,
    val name: String = "",
    val city: String = "",
    val citySlug: String = "",
    val country: String = "",
    val currency: String = "USD",
    val categories: List<String> = emptyList(),
    val verified: Boolean = false,
    /** "pending_review" | "verified" | "restricted" | "suspended". */
    val reviewStatus: String = "verified",
    val joinedAt: String? = null,
    /** The baseline added to real follows (the counts endpoint already includes it). */
    val followersBase: Int = 0,
    val timeZone: String = "UTC",
    val foundingBadge: Boolean = false,
    val forSale: Boolean = true,
    val logoSrc: String? = null,
) {
    val logoUrl: String? get() = Config.url(logoSrc)
    val locationText: String get() = listOf(city, country).filter { it.isNotEmpty() }.joinToString(", ")
    val monogram: String get() = BrandCard.monogram(name)
}

@Serializable
data class StorefrontVersion(
    val version: Int = 0,
    val publishedAt: String = "",
    val config: StorefrontConfig = StorefrontConfig(),
)

/** The brand's storefront design. Enum-like fields are kept as strings so new values never fail decoding. */
@Serializable
data class StorefrontConfig(
    /** "editorial" | "minimal" | "street" | "studio". */
    val template: String = "editorial",
    /** "violet" | "acid" | "ink" | "ember" | "aqua" | "rose". */
    val accent: String = "ink",
    /** "condensed" | "grotesk" | "expanded". */
    val typePreset: String = "grotesk",
    /** The intro/bio text. */
    val intro: String = "",
    val announcement: Announcement? = null,
    val sections: List<StorefrontSection> = emptyList(),
    val coverMediaId: String? = null,
    val coverAlt: String? = null,
    val coverPath: String? = null,
    val mark: BrandMark? = null,
    val social: BrandSocial? = null,
) {
    @Serializable
    data class Announcement(
        val text: String = "",
        /** A site path ("/drops/…"); map with `Route.fromPath(...)`. */
        val href: String? = null,
    )

    /** The hero/cover image: the uploaded cover media, else the cover path. */
    val coverUrl: String?
        get() {
            val id = coverMediaId
            if (!id.isNullOrEmpty()) return Config.url(Config.mediaPath(id))
            return Config.url(coverPath)
        }
}

/**
 * One storefront section. `type`: "hero" | "featured-products" | "collections" | "drops" |
 * "story" | "lookbook" | "all-products" | "social-feed".
 */
@Serializable
data class StorefrontSection(
    val id: String = UUID.randomUUID().toString(),
    val type: String = "",
    val enabled: Boolean = true,
    val title: String? = null,
    val productIds: List<String>? = null,
    val collectionIds: List<String>? = null,
    val postIds: List<String>? = null,
)

/** The brand's text mark (1–3 characters) when it has no logo image. */
@Serializable
data class BrandMark(
    val text: String = "",
    /** "condensed" | "expanded" | "grotesk". */
    val style: String? = null,
)

/** Social handles/links. */
@Serializable
data class BrandSocial(
    val instagram: String? = null,
    val tiktok: String? = null,
    val x: String? = null,
    val website: String? = null,
)

/** A published collection of the brand. */
@Serializable
data class StorefrontCollection(
    val id: String,
    val handle: String = id,
    val name: String = "",
    val description: String = "",
    val imageSrc: String? = null,
    val imageMediaId: String? = null,
    val productIds: List<String> = emptyList(),
) {
    val imageUrl: String?
        get() {
            val src = imageSrc
            if (!src.isNullOrEmpty()) return Config.url(src)
            val id = imageMediaId
            if (!id.isNullOrEmpty()) return Config.url(Config.mediaPath(id))
            return null
        }
}
