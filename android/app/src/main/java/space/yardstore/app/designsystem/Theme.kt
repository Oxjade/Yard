package space.yardstore.app.designsystem

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

// Colour tokens. Every colour in the app comes from here; each token has a light and a dark
// value and the root picks the set (`YardTheme(darkTheme = …)`). Mirrors `DesignSystem/Theme.swift`.
//
// Use:  `color = Color.yard.ink`, `Modifier.background(Color.yard.surface)`.
// Never write `Color.Black`, `Color.White`, `Color(0xFF…)` or a hex literal in a feature screen.

/** The Yard palette, mirroring the website's tokens. Values are exact: dark / light. */
@Immutable
data class YardColors(
    /** App background. Dark #080808 / light #F6F5F1. */
    val bg: Color,
    /** Cards and raised surfaces. Dark #121212 / light #FFFFFF. */
    val surface: Color,
    /** Secondary surfaces: secondary buttons, chips, inputs. Dark #1A1A1A / light #EFEDE7. */
    val surface2: Color,
    /** Hairlines and card borders. White 8% / black 8%. */
    val line: Color,
    /** Primary text. Dark #F5F5F0 / light #0B0B0B. */
    val ink: Color,
    /** Secondary text. Dark #A3A39C / light #5B5B55. */
    val ink2: Color,
    /** Tertiary text, placeholders. Dark #6E6E68 / light #8A8A83. */
    val ink3: Color,
    /** THE accent, #F5FF00 in both modes. Put [onAcid] text on it. */
    val acid: Color,
    /** Text/icons on an acid fill: always #0B0B0B. */
    val onAcid: Color,
    /** Brand purple #6D28D9 in both modes. */
    val purple: Color,
    /** Violet: #A78BFA dark / #6D28D9 light (readable purple text on either background). */
    val violet: Color,
    /** Errors and destructive actions. Dark #FF4D4D / light #D92D20. */
    val danger: Color,
    /** Success. Dark #22C55E / light #16A34A. */
    val success: Color,
    /** Pills and text placed ON A PHOTO (brand profile Follow, glass overlays): white in both modes. */
    val onPhoto: Color,
    /** Text on an [onPhoto] (white) pill: #0B0B0B in both modes. */
    val onPhotoInk: Color,
    /** Scrim for gradients over photos (black, fixed). Use with `.copy(alpha = …)`. */
    val scrim: Color,
    /** True for the dark set. */
    val isDark: Boolean,
) {
    companion object {
        val Light = YardColors(
            bg = Color(0xFFF6F5F1),
            surface = Color(0xFFFFFFFF),
            surface2 = Color(0xFFEFEDE7),
            line = Color(0x14000000),
            ink = Color(0xFF0B0B0B),
            ink2 = Color(0xFF5B5B55),
            ink3 = Color(0xFF8A8A83),
            acid = Color(0xFFF5FF00),
            onAcid = Color(0xFF0B0B0B),
            purple = Color(0xFF6D28D9),
            violet = Color(0xFF6D28D9),
            danger = Color(0xFFD92D20),
            success = Color(0xFF16A34A),
            onPhoto = Color(0xFFFFFFFF),
            onPhotoInk = Color(0xFF0B0B0B),
            scrim = Color(0xFF000000),
            isDark = false,
        )

        val Dark = YardColors(
            bg = Color(0xFF080808),
            surface = Color(0xFF121212),
            surface2 = Color(0xFF1A1A1A),
            line = Color(0x14FFFFFF),
            ink = Color(0xFFF5F5F0),
            ink2 = Color(0xFFA3A39C),
            ink3 = Color(0xFF6E6E68),
            acid = Color(0xFFF5FF00),
            onAcid = Color(0xFF0B0B0B),
            purple = Color(0xFF6D28D9),
            violet = Color(0xFFA78BFA),
            danger = Color(0xFFFF4D4D),
            success = Color(0xFF22C55E),
            onPhoto = Color(0xFFFFFFFF),
            onPhotoInk = Color(0xFF0B0B0B),
            scrim = Color(0xFF000000),
            isDark = true,
        )
    }
}

/** The colour set in use. Provided by [YardTheme]. */
val LocalYardColors = staticCompositionLocalOf { YardColors.Dark }

/** `Color.yard.ink` — the iOS spelling, resolved for the current appearance. */
val Color.Companion.yard: YardColors
    @Composable
    @ReadOnlyComposable
    get() = LocalYardColors.current

/**
 * The app theme: Yard colours, type and a Material 3 scheme mapped onto the Yard tokens (so any
 * Material component that slips through still looks like Yard, never stock Material).
 */
@Composable
fun YardTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (darkTheme) YardColors.Dark else YardColors.Light
    val scheme = if (darkTheme) {
        darkColorScheme(
            primary = colors.acid, onPrimary = colors.onAcid,
            primaryContainer = colors.surface2, onPrimaryContainer = colors.ink,
            secondary = colors.ink, onSecondary = colors.bg,
            secondaryContainer = colors.surface2, onSecondaryContainer = colors.ink,
            tertiary = colors.violet, onTertiary = colors.ink,
            background = colors.bg, onBackground = colors.ink,
            surface = colors.bg, onSurface = colors.ink,
            surfaceVariant = colors.surface2, onSurfaceVariant = colors.ink2,
            surfaceContainerLowest = colors.bg, surfaceContainerLow = colors.surface,
            surfaceContainer = colors.surface, surfaceContainerHigh = colors.surface2,
            surfaceContainerHighest = colors.surface2,
            outline = colors.line, outlineVariant = colors.line,
            error = colors.danger, onError = colors.onPhoto,
            scrim = colors.scrim,
        )
    } else {
        lightColorScheme(
            primary = colors.acid, onPrimary = colors.onAcid,
            primaryContainer = colors.surface2, onPrimaryContainer = colors.ink,
            secondary = colors.ink, onSecondary = colors.bg,
            secondaryContainer = colors.surface2, onSecondaryContainer = colors.ink,
            tertiary = colors.violet, onTertiary = colors.onPhoto,
            background = colors.bg, onBackground = colors.ink,
            surface = colors.bg, onSurface = colors.ink,
            surfaceVariant = colors.surface2, onSurfaceVariant = colors.ink2,
            surfaceContainerLowest = colors.bg, surfaceContainerLow = colors.surface,
            surfaceContainer = colors.surface, surfaceContainerHigh = colors.surface2,
            surfaceContainerHighest = colors.surface2,
            outline = colors.line, outlineVariant = colors.line,
            error = colors.danger, onError = colors.onPhoto,
            scrim = colors.scrim,
        )
    }
    CompositionLocalProvider(LocalYardColors provides colors) {
        MaterialTheme(colorScheme = scheme, typography = YardFonts.materialTypography, shapes = YardShapes.material) {
            content()
        }
    }
}
