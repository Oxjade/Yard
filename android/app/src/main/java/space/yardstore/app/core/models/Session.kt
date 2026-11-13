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
) {
    /** First name for greetings ("Hi, Ada"). */
    val firstName: String get() = name.split(" ").firstOrNull { it.isNotEmpty() } ?: name

    /** Initials for an avatar. */
    val initials: String
        get() {
            val letters = name.split(" ").filter { it.isNotEmpty() }.take(2).map { it.first() }.joinToString("")
            return if (letters.isEmpty()) "Y" else letters.uppercase()
        }
}

/** A brand membership on this device (the web Studio; the app just knows it exists). */
@Serializable
data class BrandMember(
    val userId: String = "",
    val name: String = "",
    val brand: Brand,
    val role: String = "",
) {
    @Serializable
    data class Brand(val id: String = "", val handle: String = id, val name: String = "")
}
