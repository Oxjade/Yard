package space.yardstore.app.features.studio

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.MoneyFormatter
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.or
import space.yardstore.app.designsystem.rememberReducedMotion
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard

// Building blocks shared by Studio and the "Sell on Yard" flow.

/** Money in a brand's currency (minor units). */
fun studioMoney(minor: Long, currency: String): String =
    MoneyFormatter.format(minor.coerceIn(Int.MIN_VALUE.toLong(), Int.MAX_VALUE.toLong()).toInt(), currency)

/** A brand's logo, or its initials on a violet disc while there is none (or it fails to load). */
@Composable
fun StudioBrandMark(
    name: String,
    initials: String,
    logoSrc: String?,
    modifier: Modifier = Modifier,
    size: Dp = 40.dp,
    /** On a violet surface pass acid (and [onFill] onAcid) so the disc still reads. */
    fill: Color = Color.yard.violetFill,
    onFill: Color = Color.yard.onVioletFill,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(fill, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initials.ifBlank { name.take(1).uppercase() }.take(2),
            style = YardFonts.display((size.value * 0.4f).sp),
            color = onFill,
        )
        if (!logoSrc.isNullOrBlank()) {
            RemoteImage(Config.url(logoSrc), Modifier.fillMaxWidth().fillMaxHeight(), maxPixelSize = 256, placeholder = {})
        }
    }
}

/**
 * A big input for one-question screens and Studio forms. On a bold full-bleed colour ([onColor])
 * it is a white field with black text; elsewhere a `surface2` field.
 */
@Composable
fun StudioTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String = placeholder,
    onColor: Boolean = false,
    large: Boolean = false,
    error: String? = null,
    prefix: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.Sentences,
    imeAction: ImeAction = ImeAction.Done,
    singleLine: Boolean = true,
    onImeAction: () -> Unit = {},
) {
    val bg = if (onColor) Color.yard.onPhoto else Color.yard.surface2
    val fg = if (onColor) Color.yard.onPhotoInk else Color.yard.ink
    val hint = if (onColor) Color.yard.onPhotoInk.copy(alpha = 0.4f) else Color.yard.ink3
    val shape = RoundedCornerShape(if (large) 22.dp else 16.dp)
    val textStyle = if (large) TextStyle(fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 30.sp) else YardFonts.body
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = singleLine,
            textStyle = textStyle.copy(color = fg),
            cursorBrush = SolidColor(fg),
            keyboardOptions = KeyboardOptions(capitalization = capitalization, autoCorrectEnabled = false, keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onImeAction() }),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
            decorationBox = { inner ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = if (large) 68.dp else 52.dp)
                        .clip(shape)
                        .background(bg, shape)
                        .border(if (error != null) 2.dp else 1.dp, if (error != null) Color.yard.danger else if (onColor) Color.Transparent else Color.yard.line, shape)
                        .padding(horizontal = if (large) 20.dp else 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (prefix != null) Text(prefix, style = textStyle, color = hint, modifier = Modifier.padding(end = 4.dp))
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty()) Text(placeholder, style = textStyle, color = hint, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        inner()
                    }
                }
            },
        )
        if (error != null) {
            Text(error, style = YardFonts.captionEmphasis, color = if (onColor) Color.yard.onAcid else Color.yard.danger)
        }
    }
}

/** The bold screens' black pill CTA (onboarding inspo): "Continue  »". */
@Composable
fun StudioBlackPill(
    title: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    isLoading: Boolean = false,
    icon: ImageVector? = Icons.AutoMirrored.Filled.KeyboardArrowRight,
    onClick: () -> Unit,
) {
    val haptics = rememberYardHaptics()
    Row(
        modifier
            .fillMaxWidth()
            .height(58.dp)
            .clip(YardShapes.pill)
            .background(Color.yard.onAcid.copy(alpha = if (enabled) 1f else 0.45f), YardShapes.pill)
            .pressableClick(enabled = enabled && !isLoading, onClickLabel = title) {
                haptics.click()
                onClick()
            }
            .padding(start = 24.dp, end = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(title, style = YardFonts.bodyEmphasis, color = Color.yard.onPhoto, modifier = Modifier.weight(1f), maxLines = 1)
        Box(Modifier.size(40.dp).background(Color.yard.onPhoto.copy(alpha = 0.12f), CircleShape), contentAlignment = Alignment.Center) {
            if (isLoading) {
                CircularProgressIndicator(color = Color.yard.onPhoto, strokeWidth = 2.dp, modifier = Modifier.size(18.dp))
            } else if (icon != null) {
                Icon(icon, contentDescription = null, tint = Color.yard.onPhoto, modifier = Modifier.size(22.dp))
            }
        }
    }
}

/** A thin progress bar (springy) for one-question flows. */
@Composable
fun StudioProgressBar(progress: Float, modifier: Modifier = Modifier, track: Color = Color.yard.onAcid.copy(alpha = 0.15f), fill: Color = Color.yard.onAcid) {
    val reduce = rememberReducedMotion()
    val shown by animateFloatAsState(progress.coerceIn(0f, 1f), Motion.or(reduce) { Motion.spring() }, label = "progress")
    Box(modifier.fillMaxWidth().height(6.dp).clip(YardShapes.pill).background(track, YardShapes.pill)) {
        Box(Modifier.fillMaxWidth(shown).fillMaxHeight().background(fill, YardShapes.pill))
    }
}

/** A chip for bold screens: outline on the colour, black fill when picked. */
@Composable
fun StudioBoldChip(title: String, selected: Boolean, onColor: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    val bg = if (selected) Color.yard.onAcid else Color.Transparent
    val fg = if (selected) Color.yard.onPhoto else onColor
    Box(
        modifier
            .clip(YardShapes.pill)
            .background(bg, YardShapes.pill)
            .border(1.5.dp, if (selected) Color.yard.onAcid else onColor.copy(alpha = 0.45f), YardShapes.pill)
            .pressableClick(pressedScale = Motion.PRESSED_SCALE, onClickLabel = title) {
                haptics.tick()
                onClick()
            }
            .padding(horizontal = 18.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(title, style = YardFonts.bodyEmphasis, color = fg, maxLines = 1)
    }
}

/** Live / Draft / status pills. */
enum class StudioPillStyle { Acid, Violet, Neutral, Success, Danger }

@Composable
fun StudioPill(text: String, style: StudioPillStyle, modifier: Modifier = Modifier) {
    val (bg, fg) = when (style) {
        StudioPillStyle.Acid -> Color.yard.acid to Color.yard.onAcid
        StudioPillStyle.Violet -> Color.yard.violetFill to Color.yard.onVioletFill
        StudioPillStyle.Neutral -> Color.yard.surface2 to Color.yard.ink2
        StudioPillStyle.Success -> Color.yard.success.copy(alpha = 0.16f) to Color.yard.success
        StudioPillStyle.Danger -> Color.yard.danger.copy(alpha = 0.14f) to Color.yard.danger
    }
    Text(
        text,
        style = YardFonts.micro,
        color = fg,
        maxLines = 1,
        modifier = modifier.background(bg, YardShapes.pill).padding(horizontal = 9.dp, vertical = 4.dp),
    )
}

/** Merchant status words for brand eyes (the shopper's wording lives in orders/OrderStatus). */
fun studioOrderStatus(merchant: String): Pair<String, StudioPillStyle> = when (merchant) {
    "pending_payment" -> "Awaiting payment" to StudioPillStyle.Neutral
    "paid" -> "New" to StudioPillStyle.Acid
    "processing" -> "Preparing" to StudioPillStyle.Violet
    "shipped" -> "Shipped" to StudioPillStyle.Neutral
    "delivered" -> "Delivered" to StudioPillStyle.Success
    "cancelled" -> "Cancelled" to StudioPillStyle.Danger
    "refund_requested" -> "Return requested" to StudioPillStyle.Violet
    "refunded" -> "Refunded" to StudioPillStyle.Neutral
    else -> merchant.replace('_', ' ').replaceFirstChar { it.uppercase() } to StudioPillStyle.Neutral
}

/** The section heading Studio uses ("To do", "Top products"). */
@Composable
fun StudioSectionTitle(title: String, modifier: Modifier = Modifier, trailing: String? = null, onTrailing: (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = YardFonts.title, color = Color.yard.ink, modifier = Modifier.weight(1f))
        if (trailing != null && onTrailing != null) {
            val haptics = rememberYardHaptics()
            Text(
                trailing,
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.ink2,
                modifier = Modifier.pressableClick(onClickLabel = trailing) { haptics.click(); onTrailing() }.padding(Spacing.xs),
            )
        }
    }
}
