package space.yardstore.app.designsystem

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.background
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Router
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.BrandSummary
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductImage
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.core.models.Shopper
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.core.stores.SavedStore
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.designsystem.components.YardToastHost

// Preview helpers. Fixtures here are for @Preview ONLY — never show them in the app.
// Mirrors `DesignSystem/PreviewSupport.swift`.

/**
 * Wraps a preview in the Yard theme with fresh stores, a router and a toast center, on `bg`
 * (iOS `.yardPreviewEnvironment(signedIn:)` + `.preferredColorScheme`). One light and one dark
 * `@Preview` per main screen:
 *
 *   @Preview(name = "Bag — dark") @Composable private fun BagDark() = YardPreview(darkTheme = true) { BagView() }
 *   @Preview(name = "Bag — light") @Composable private fun BagLight() = YardPreview(darkTheme = false) { BagView() }
 */
@Composable
fun YardPreview(darkTheme: Boolean, signedIn: Boolean = true, content: @Composable BoxScope.() -> Unit) {
    val session = remember(signedIn) { SessionStore.preview(signedIn) }
    val cart = remember { CartStore.preview() }
    val follows = remember { FollowStore.preview() }
    val saved = remember { SavedStore.preview() }
    val router = remember { Router() }
    val toast = remember { ToastCenter() }
    YardTheme(darkTheme = darkTheme) {
        CompositionLocalProvider(
            LocalSessionStore provides session,
            LocalCartStore provides cart,
            LocalFollowStore provides follows,
            LocalSavedStore provides saved,
            LocalRouter provides router,
            LocalToastCenter provides toast,
        ) {
            YardToastHost(toast, Modifier.background(Color.yard.bg)) {
                Box(content = content)
            }
        }
    }
}

/** Small inline fixture values for previews. */
object PreviewFixtures {
    val brand = BrandSummary(id = "brd_preview", handle = "acme", name = "Acme Studio", verified = true, city = "Lagos", country = "NG", currency = "USD", foundingBadge = true)

    val products: List<Product> = (0 until 10).map { i ->
        val ratios = listOf(800 to 1000, 900 to 1200, 1000 to 1000, 800 to 1300, 1200 to 1000)
        val r = ratios[i % ratios.size]
        Product(
            id = "prd_$i",
            slug = "piece-$i",
            brandId = brand.id,
            title = listOf("Boxy tee", "Cargo pant", "Washed hoodie", "Track jacket", "Bucket hat")[i % 5],
            priceMinor = listOf(4500, 12000, 8900, 15000, 3500)[i % 5],
            compareAtMinor = if (i == 2) 11000 else null,
            currency = "USD",
            images = listOf(ProductImage(id = "img_$i", src = "/media/missing.svg", width = r.first, height = r.second)),
            variants = listOf(ProductVariant(id = "var_$i", label = "Size M", priceMinor = 4500, available = if (i == 3) 0 else 5, inStock = i != 3)),
            available = if (i == 3) 0 else 5,
            brand = brand,
        )
    }

    val brandCard = BrandCard(id = "brd_preview", handle = "acme", name = "Acme Studio", city = "Lagos", country = "NG", categories = listOf("tops"), story = "Heavyweight basics cut in Lagos.", verified = true, founding = true, foundingBadge = true)

    val shopper = Shopper(id = "usr_preview", name = "Ada Obi", email = "ada@example.com")
}
