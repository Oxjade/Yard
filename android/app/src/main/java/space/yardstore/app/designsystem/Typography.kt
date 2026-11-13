package space.yardstore.app.designsystem

import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.DeviceFontFamilyName
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

// Type scale. Mirrors `DesignSystem/Typography.swift`.
//
// iOS uses SF Pro, with display headlines in the heavy condensed capitals (.black, .compressed).
// Android: the device's condensed sans (`sans-serif-condensed`, Roboto Condensed on most phones)
// at Black/Bold for display; the system sans for everything else. No font is bundled.
// Sizes are the iOS text-style sizes in sp, so they follow the user's font scale (Dynamic Type).
//
//   YardDisplayText("New drops", size = 34.sp)          // uppercase + condensed + tight tracking
//   Text("Title", style = YardFonts.title, color = Color.yard.ink)

/** The condensed family used by the display face. */
val YardCondensedFamily: FontFamily = FontFamily(
    Font(DeviceFontFamilyName("sans-serif-condensed"), weight = FontWeight.Black),
    Font(DeviceFontFamilyName("sans-serif-condensed"), weight = FontWeight.ExtraBold),
    Font(DeviceFontFamilyName("sans-serif-condensed"), weight = FontWeight.Bold),
    Font(DeviceFontFamilyName("sans-serif-condensed"), weight = FontWeight.Normal),
)

private val Trim = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

/** Yard's text styles (iOS `Font.yard…`). Colours are not part of the styles: pass `Color.yard.*`. */
object YardFonts {
    /** Heavy condensed display face. Fixed size; use for headlines (uppercase the text: [YardDisplayText]). */
    fun display(size: TextUnit): TextStyle = TextStyle(
        fontFamily = YardCondensedFamily,
        fontWeight = FontWeight.Black,
        fontSize = size,
        lineHeight = size * 0.98f,
        letterSpacing = (-0.01).em,
        lineHeightStyle = Trim,
    )

    /** Large title for screen headers (bold, 34). */
    val largeTitle = TextStyle(fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 41.sp, letterSpacing = 0.sp)
    /** Section / card titles (bold title3, 20). */
    val title = TextStyle(fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 25.sp, letterSpacing = 0.sp)
    /** Smaller headings, row titles (semibold headline, 17). */
    val headline = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = 0.sp)
    /** Body text (17). */
    val body = TextStyle(fontWeight = FontWeight.Normal, fontSize = 17.sp, lineHeight = 22.sp, letterSpacing = 0.sp)
    /** Emphasised body text (prices, button labels). */
    val bodyEmphasis = body.copy(fontWeight = FontWeight.SemiBold)
    /** Secondary body text (callout, 16). */
    val callout = TextStyle(fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 21.sp, letterSpacing = 0.sp)
    /** Captions, metadata (12). */
    val caption = TextStyle(fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.sp)
    /** Emphasised caption (tags, badges). */
    val captionEmphasis = caption.copy(fontWeight = FontWeight.SemiBold)
    /** Tiny labels (tab pill, counters): semibold caption2, 11. */
    val micro = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 13.sp, letterSpacing = 0.sp)

    /** Numbers that tick (countdowns, stats): tabular digits, bold. */
    fun number(size: TextUnit): TextStyle = TextStyle(
        fontWeight = FontWeight.Bold,
        fontSize = size,
        fontFeatureSettings = "tnum",
    )

    /** The Material typography mapped onto Yard's scale (for any Material component that slips through). */
    val materialTypography: Typography = Typography(
        displayLarge = display(57.sp), displayMedium = display(45.sp), displaySmall = display(36.sp),
        headlineLarge = largeTitle, headlineMedium = largeTitle.copy(fontSize = 28.sp), headlineSmall = title.copy(fontSize = 24.sp),
        titleLarge = title, titleMedium = headline, titleSmall = callout.copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = body, bodyMedium = callout, bodySmall = caption,
        labelLarge = callout.copy(fontWeight = FontWeight.SemiBold), labelMedium = captionEmphasis, labelSmall = micro,
    )
}

/** Monospaced-digit variant of any style (iOS `.monospacedDigit()`). */
fun TextStyle.monospacedDigits(): TextStyle = copy(fontFeatureSettings = "tnum")

/**
 * The display face applied the iOS way (`Text(…).yardDisplay(34)`): uppercased, condensed,
 * black weight, tight tracking.
 */
@Composable
fun YardDisplayText(
    text: String,
    size: TextUnit,
    modifier: Modifier = Modifier,
    color: Color = Color.yard.ink,
    textAlign: TextAlign? = null,
    maxLines: Int = Int.MAX_VALUE,
) {
    Text(
        text = text.uppercase(),
        modifier = modifier,
        style = YardFonts.display(size),
        color = color,
        textAlign = textAlign,
        maxLines = maxLines,
        overflow = TextOverflow.Ellipsis,
    )
}
