package space.yardstore.app.designsystem

import androidx.compose.animation.core.FiniteAnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Spacing scale (dp). Screen gutter is [gutter]; masonry gap is [gridGap]. Mirrors `Metrics.swift`. */
object Spacing {
    val xxs: Dp = 2.dp
    val xs: Dp = 4.dp
    val s: Dp = 8.dp
    val m: Dp = 12.dp
    val l: Dp = 16.dp
    val xl: Dp = 24.dp
    val xxl: Dp = 32.dp
    val xxxl: Dp = 48.dp

    /** Horizontal screen padding. */
    val gutter: Dp = 16.dp
    /** Gap between masonry tiles (Home, grids): 6dp, edge to edge. */
    val gridGap: Dp = 6.dp
    /** Height reserved at the bottom of tab-root screens for the floating tab pill (plus the nav-bar inset). */
    val tabPillClearance: Dp = 84.dp
}

/** Corner radii. */
object Radius {
    /** Cards (20dp). */
    val card: Dp = 20.dp
    /** Images and tiles (16dp). */
    val image: Dp = 16.dp
    /** Small elements: thumbnails, inputs (12dp). */
    val small: Dp = 12.dp
    /** Sheets (28dp). */
    val sheet: Dp = 28.dp
}

/** Shapes built from [Radius]. iOS `.clipShape(.yardCard)` → `Modifier.clip(YardShapes.card)`. */
object YardShapes {
    val card = RoundedCornerShape(Radius.card)
    val image = RoundedCornerShape(Radius.image)
    val small = RoundedCornerShape(Radius.small)
    val sheet = RoundedCornerShape(topStart = Radius.sheet, topEnd = Radius.sheet)
    val pill = RoundedCornerShape(percent = 50)

    val material = Shapes(
        extraSmall = RoundedCornerShape(8.dp),
        small = small,
        medium = image,
        large = card,
        extraLarge = RoundedCornerShape(Radius.sheet),
    )
}

/**
 * Motion tokens. SwiftUI `spring(response:dampingFraction:)` maps to Compose stiffness
 * (2π / response)²: response 0.35 → ≈322, 0.25 → ≈632.
 */
object Motion {
    /** The app's standard spring (response 0.35, damping 0.82). */
    fun <T> spring(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.82f, stiffness = 322f)
    /** A quicker spring for small state flips (chips, toggles): response 0.25, damping 0.9. */
    fun <T> snappy(): FiniteAnimationSpec<T> = spring(dampingRatio = 0.9f, stiffness = 632f)
    /** Image fade-in (ease-out 250 ms). */
    fun <T> fade(): FiniteAnimationSpec<T> = tween(durationMillis = 250, easing = LinearOutSlowInEasing)
    /** Standard ease for screen transitions. */
    fun <T> standard(durationMillis: Int = 300): FiniteAnimationSpec<T> = tween(durationMillis, easing = FastOutSlowInEasing)
}
