package space.yardstore.app.core.models

import kotlinx.serialization.Serializable
import space.yardstore.app.core.Config
import java.time.Instant

// Drops (src/server/drops/service.ts toDropDto / dropDetail). Mirrors Models/Drop.swift.
//
//   GET    /api/drops?phase=upcoming|live|ended|all&brandId=&limit=&cursor=  → DropsPage { items, nextCursor }
//   GET    /api/drops/{id or slug}           → DropDetailResponse { drop, me }   (me only when signed in)
//   POST   /api/drops/{id}/reminder          → remind me (shopper)
//   DELETE /api/drops/{id}/reminder
//   POST   /api/drops/{id}/entry             → enter a draw (see src/app/api/drops/[id]/entry)
//   GET    /api/drops/me                     → the shopper's entries and reminders

@Serializable
data class Drop(
    val id: String,
    val slug: String = id,
    val brand: BrandRef = BrandRef(id = ""),
    val name: String = "",
    val description: String = "",
    /** A media id or a "/media/…" path; use [imageUrl]. */
    val image: String? = null,
    /** "first_come" | "draw" | "early_access". */
    val access: String = "first_come",
    val status: String = "scheduled",
    /** "draft" | "scheduled" | "early_access" | "entries_open" | "live" | "ended" | "cancelled" | … */
    val phase: String = "scheduled",
    val startsAt: String = "",
    val endsAt: String = "",
    val earlyAccessAt: String? = null,
    val entryOpensAt: String? = null,
    val entryClosesAt: String? = null,
    val drawnAt: String? = null,
    val purchaseWindowMinutes: Int? = null,
    /** Number of draw winners (draws only). */
    val winners: Int? = null,
    val limitPerCustomer: Int = 1,
    val totalUnits: Int = 0,
    val productIds: List<String> = emptyList(),
    /** Draw entries so far (draws only). */
    val entries: Int? = null,
    val sponsored: Boolean = false,
    /** Detail only. */
    val variantIds: List<String>? = null,
    /** Detail only: live units left across the drop's variants (null when unknown). */
    val unitsAvailable: Int? = null,
) {
    @Serializable
    data class BrandRef(val id: String = "", val handle: String? = null, val name: String? = null)

    val startDate: Instant? get() = YardDate.parse(startsAt)
    val endDate: Instant? get() = YardDate.parse(endsAt)
    val isLive: Boolean get() = phase == "live"
    val isEnded: Boolean get() = phase == "ended" || phase == "cancelled"
    val isUpcoming: Boolean get() = !isLive && !isEnded
    val isDraw: Boolean get() = access == "draw"

    /** Same rule as the website: "/media/…" paths stay, anything else is a media id. */
    val imageUrl: String?
        get() {
            val image = image
            if (image.isNullOrEmpty()) return null
            if (image.startsWith("/") || image.startsWith("http")) return Config.url(image)
            return Config.url(Config.mediaPath(image))
        }

    /** "Draw" / "Early access" / "First come". */
    val accessLabel: String
        get() = when (access) {
            "draw" -> "Draw"
            "early_access" -> "Early access"
            else -> "First come"
        }
}

/** GET /api/drops. */
@Serializable
data class DropsPage(
    val items: List<Drop> = emptyList(),
    /** Pass as `cursor` for the next page. */
    val nextCursor: String? = null,
)

/** GET /api/drops/{id}. */
@Serializable
data class DropDetailResponse(
    val drop: Drop,
    /** The signed-in shopper's state; null when signed out. */
    val me: DropViewerState? = null,
)

/** The viewer's own state on a drop. */
@Serializable
data class DropViewerState(
    val reminder: Boolean = false,
    val following: Boolean = false,
    val earlyAccess: Boolean = false,
    val entry: DropEntry? = null,
    val canBuy: Boolean = false,
    /** Why they can't buy (a sentence), or null. */
    val reason: String? = null,
    val claimed: Int = 0,
    val remainingAllowance: Int = 0,
)

/** A draw entry. */
@Serializable
data class DropEntry(
    /** "entered" | "won" | "waitlisted" | "lost" | "purchased" | "expired" | "withdrawn" … */
    val status: String = "",
    val rank: Int? = null,
    val windowOpensAt: String? = null,
    val windowEndsAt: String? = null,
    val enteredAt: String? = null,
)
