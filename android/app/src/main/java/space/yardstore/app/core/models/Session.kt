package space.yardstore.app.core.models

import kotlinx.serialization.Serializable

// GET /api/session (src/lib/api/contracts/session.ts SessionDto). Who this device is signed in as.
// The app only acts as a shopper; `brand` is decoded leniently for completeness.
// Sign out: POST /api/auth/sign-out?actor=shopper (SessionStore.signOut()). Mirrors Models/Session.swift.

@Serializable
data class Session(
    val shopper: Shopper? = null,
    val brand: BrandMember? = null,
    val sampleData: Boolean = false,
) {
    companion object {
        val signedOut = Session(shopper = null, brand = null, sampleData = false)
    }
}

/** The signed-in shopper. */
@Serializable
data class Shopper(
    val id: String,
    val name: String = "",
    val email: String = "",
    /** "active" | "restricted" | "suspended". */
    val status: String = "active",
    val demo: Boolean = false,
    /**
     * The profile photo (`/api/media/med_…?as=shopper`, cookie-scoped), or null: show [initials].
     * A replaced photo gets a new URL, so image caches never show the old one.
     */
    val photoSrc: String? = null,
    /**
     * The brands this account is an active member of (GET /api/session only; `[]` when none),
     * oldest first. docs/APP.md › Studio in the app › Sessions.
     */
    val brands: List<ShopperBrand> = emptyList(),
) {
    /** Brands whose Studio can open in the app (`canOpenStudio`; not suspended). */
    val studioBrands: List<ShopperBrand> get() = brands.filter { it.canOpenStudio }

    /** First name for greetings ("Hi, Ada"). */
    val firstName: String get() = name.split(" ").firstOrNull { it.isNotEmpty() } ?: name

    /** Initials for an avatar. */
    val initials: String
        get() {
            val letters = name.split(" ").filter { it.isNotEmpty() }.take(2).map { it.first() }.joinToString("")
            return if (letters.isEmpty()) "Y" else letters.uppercase()
        }
}

/**
 * One of the shopper's brand memberships (`shopper.brands[]`). `status`: pending_review | approved |
 * claimed | restricted | suspended. `logoSrc` ending `?as=brand` loads only once the brand session
 * is open; draw [initials] until then (or when it fails / is null).
 */
@Serializable
data class ShopperBrand(
    val id: String,
    val handle: String = "",
    val name: String = "",
    val logoSrc: String? = null,
    val initials: String = "",
    /** owner | admin | designer | fulfilment | finance | viewer. */
    val role: String = "viewer",
    val status: String = "pending_review",
    val canOpenStudio: Boolean = false,
) {
    val isPendingReview: Boolean get() = status == "pending_review"
    val isRestricted: Boolean get() = status == "restricted"
    val isSuspended: Boolean get() = status == "suspended"
    /** Approved, or a founding brand the owner claimed (treated as approved). */
    val isLive: Boolean get() = status == "approved" || status == "claimed"

    /** Initials for the mark: the server's, else from the name. */
    val mark: String
        get() = initials.ifBlank {
            name.split(" ").filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }.ifEmpty { "Y" }
        }
}

/**
 * The open brand session (`GET /api/session`'s `brand`, and `POST /api/studio/session/switch`'s
 * `profile`): BrandProfile. Use [permissions] to hide actions the role can't take.
 */
@Serializable
data class BrandMember(
    val userId: String = "",
    val name: String = "",
    val brand: Brand,
    val role: String = "",
    val permissions: List<String> = emptyList(),
    val demo: Boolean = false,
    val photoSrc: String? = null,
) {
    @Serializable
    data class Brand(
        val id: String = "",
        val handle: String = id,
        val name: String = "",
        /** pending_review | verified | restricted | suspended. */
        val reviewStatus: String = "verified",
        val logoSrc: String? = null,
    )

    fun can(permission: String): Boolean = permission in permissions
    /** Payouts are visible to roles owner, admin and finance only. */
    val seesPayouts: Boolean get() = role == "owner" || role == "admin" || role == "finance"
    /** Refunds: `orders.fulfil` and role owner/admin. */
    val canRefund: Boolean get() = can("orders.fulfil") && (role == "owner" || role == "admin")
}
