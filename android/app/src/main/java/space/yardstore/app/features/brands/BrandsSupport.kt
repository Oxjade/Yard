package space.yardstore.app.features.brands

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.layout
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import space.yardstore.app.app.Route
import space.yardstore.app.app.Router
import space.yardstore.app.core.models.FollowResult
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import java.util.Locale

// Small helpers shared by the Brands screens (directory + profile). Brands-owned; prefixed
// `Brands…` so nothing clashes with other feature packages. Mirrors BrandsSupport.swift.

/** Category slug → name, the website's catalog list (src/lib/data/catalog.ts `categories`). */
object BrandsCategory {
    val names: Map<String, String> = mapOf(
        "fashion" to "Fashion",
        "streetwear" to "Streetwear",
        "sneakers" to "Sneakers",
        "accessories" to "Accessories",
        "jewelry" to "Jewelry",
        "beauty" to "Beauty",
        "technology" to "Technology",
        "art-design" to "Art & design",
        "home-lifestyle" to "Home & lifestyle",
        "creative" to "Independent creative",
    )

    /** The website's order for the category chips. */
    val order: List<String> = listOf("fashion", "streetwear", "sneakers", "accessories", "jewelry", "beauty", "technology", "art-design", "home-lifestyle", "creative")

    /** A category's display name; null for slugs the app doesn't know. */
    fun name(slug: String): String? = names[slug]

    /** The first known category name in a brand's list. */
    fun firstName(slugs: List<String>): String? = slugs.firstNotNullOfOrNull { names[it] }
}

object BrandsPlace {
    /** "Lagos, Nigeria" (the website shows the country's name, not its code). */
    fun text(city: String, country: String): String {
        val countryName = if (country.length == 2) {
            Locale("", country.uppercase()).getDisplayCountry(Locale.getDefault()).ifEmpty { country }
        } else {
            country
        }
        return listOf(city, countryName).filter { it.isNotEmpty() }.joinToString(", ")
    }
}

/** Follow/unfollow with the sign-in gate; haptics are left to the caller. */
object BrandsFollow {
    /**
     * Toggles following [brandId]. Signed out → presents Sign in and returns null.
     * Errors are shown as a toast (the server's message) and return null.
     */
    suspend fun toggle(
        brandId: String,
        brandName: String,
        session: SessionStore,
        follows: FollowStore,
        router: Router,
        toast: ToastCenter,
    ): FollowResult? {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return null
        }
        return try {
            val result = follows.toggle(brandId)
            if (result.following) toast.show("Following $brandName", Toast.Style.Success, Icons.Filled.Check)
            result
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            toast.show(e)
            null
        }
    }
}

/**
 * Fields of GET /api/catalog/storefronts/{handle} that the shared `StorefrontBrand` model doesn't
 * carry. The server returns the whole public brand row, which includes `story` (≤ 2,000 chars).
 */
@Serializable
data class BrandsStorefrontExtras(val brand: Brand? = null) {
    @Serializable
    data class Brand(val story: String? = null)
}

/** "Founding brand" (the website's FoundingBadge: sparkle + text, violet tint). */
@Composable
fun BrandsFoundingBadge(modifier: Modifier = Modifier, onPhoto: Boolean = false) {
    val c = Color.yard
    Row(
        modifier
            .height(22.dp)
            .background(if (onPhoto) c.onPhoto.copy(alpha = 0.16f) else c.violet.copy(alpha = 0.12f), YardShapes.pill)
            .border(BorderStroke(1.dp, if (onPhoto) c.onPhoto.copy(alpha = 0.3f) else c.violet.copy(alpha = 0.4f)), YardShapes.pill)
            .padding(horizontal = 8.dp)
            .clearAndSetSemantics { contentDescription = "Founding brand" },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.AutoAwesome, contentDescription = null, tint = if (onPhoto) c.onPhoto else c.violet, modifier = Modifier.size(10.dp))
        Text("Founding brand", style = YardFonts.micro, color = if (onPhoto) c.onPhoto else c.ink, maxLines = 1)
    }
}

/** Lets a full-width item of a padded lazy grid bleed into the grid's horizontal padding. */
internal fun Modifier.brandsBleed(horizontal: Dp): Modifier = layout { measurable, constraints ->
    val extra = (horizontal.roundToPx() * 2)
    val width = constraints.maxWidth + extra
    val placeable = measurable.measure(constraints.copy(minWidth = width, maxWidth = width))
    layout(constraints.maxWidth, placeable.height) { placeable.place(-extra / 2, 0) }
}

@Preview(name = "Founding badge — dark")
@Composable
private fun FoundingDark() = YardPreview(darkTheme = true) { BrandsFoundingBadge(Modifier.padding(16.dp)) }

@Preview(name = "Founding badge — light")
@Composable
private fun FoundingLight() = YardPreview(darkTheme = false) { BrandsFoundingBadge(Modifier.padding(16.dp)) }
