package space.yardstore.app.features.sell

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.outlined.HourglassTop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.core.models.ShopperBrand
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.studio.LocalStudioStore
import space.yardstore.app.features.studio.StudioApplication
import space.yardstore.app.features.studio.StudioBrandMark
import space.yardstore.app.features.studio.latestApplication

/** What the You tab says about selling (pure, unit-tested). */
sealed interface YouSellerState {
    data object None : YouSellerState
    /** "{Brand}: in review" (shopper.brands status pending_review). */
    data class InReview(val brand: ShopperBrand) : YouSellerState
    /** A live brand: "Switch to Studio". */
    data class Member(val brand: ShopperBrand, val count: Int) : YouSellerState
    /** The last application was sent back with a note. */
    data class Rejected(val name: String, val note: String?) : YouSellerState

    companion object {
        fun from(brands: List<ShopperBrand>, application: StudioApplication?): YouSellerState {
            brands.firstOrNull { it.isPendingReview }?.let { return InReview(it) }
            val open = brands.filter { it.canOpenStudio }
            if (open.isNotEmpty()) return Member(open.first(), open.size)
            if (application?.isRejected == true) return Rejected(application.brand?.name.orEmpty(), application.reviewNote)
            return None
        }
    }
}

/**
 * The seller card on You: "{Brand}: in review" while Yard reviews the application, "Switch to
 * Studio" for brand members, or the review note after a rejection (apply again).
 */
@Composable
fun YouSellerCard(modifier: Modifier = Modifier) {
    val session = LocalSessionStore.current
    val studio = LocalStudioStore.current
    val haptics = rememberYardHaptics()
    val shopper = session.shopper ?: return
    var application by remember(shopper.id) { mutableStateOf<StudioApplication?>(null) }
    // Only people who said "Sell" here and have no brand yet: was their application sent back?
    val askedToSell = studio.prefs.roleChoice(shopper.id) == "sell"
    LaunchedEffect(shopper.id, shopper.brands.isEmpty(), askedToSell) {
        if (shopper.brands.isEmpty() && askedToSell) application = runCatching { studio.latestApplication() }.getOrNull()
    }
    when (val state = YouSellerState.from(shopper.brands, application)) {
        YouSellerState.None -> Unit
        is YouSellerState.InReview -> SellerCard(
            modifier = modifier,
            background = Color.yard.violetFill,
            foreground = Color.yard.onVioletFill,
            kicker = "Your application",
            title = "${state.brand.name}: in review",
            body = "Yard is reviewing ${state.brand.name}. We'll let you know. You can set up your shop in Studio meanwhile; nothing goes live until you're approved.",
            action = "Open Studio",
            mark = { StudioBrandMark(state.brand.name, state.brand.mark, null, size = 44.dp, fill = Color.yard.acid, onFill = Color.yard.onAcid) },
        ) {
            haptics.click()
            studio.enter(state.brand.id)
        }
        is YouSellerState.Member -> SellerCard(
            modifier = modifier,
            background = Color.yard.onAcid,
            foreground = Color.yard.onPhoto,
            kicker = "Studio",
            title = if (state.count > 1) "Run your ${state.count} brands" else "Run ${state.brand.name}",
            body = "Orders, products, payouts and messages, right here.",
            action = "Switch to Studio",
            mark = { StudioBrandMark(state.brand.name, state.brand.mark, state.brand.logoSrc?.takeUnless { it.endsWith("?as=brand") }, size = 44.dp) },
        ) {
            haptics.click()
            studio.enter()
        }
        is YouSellerState.Rejected -> SellerCard(
            modifier = modifier,
            background = Color.yard.surface,
            foreground = Color.yard.ink,
            kicker = "Your application",
            title = "${state.name.ifBlank { "Your shop" }}: needs changes",
            body = state.note?.ifBlank { null } ?: "Yard couldn't approve it as it was. Update it and apply again.",
            action = "Apply again",
            mark = null,
        ) {
            haptics.click()
            studio.openApplication()
        }
    }
}

@Composable
private fun SellerCard(
    modifier: Modifier,
    background: Color,
    foreground: Color,
    kicker: String,
    title: String,
    body: String,
    action: String,
    mark: (@Composable () -> Unit)?,
    onClick: () -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(background, YardShapes.card)
            .pressableClick(pressedScale = 0.98f, onClickLabel = action, onClick = onClick)
            .padding(Spacing.l)
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            if (mark != null) mark() else Icon(Icons.Outlined.HourglassTop, contentDescription = null, tint = foreground)
            Column(Modifier.weight(1f)) {
                Text(kicker.uppercase(), style = YardFonts.micro, color = foreground.copy(alpha = 0.7f))
                YardDisplayText(title, size = 24.sp, color = foreground, maxLines = 2)
            }
        }
        Text(body, style = YardFonts.callout, color = foreground.copy(alpha = 0.8f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s), modifier = Modifier.padding(top = Spacing.xs)) {
            Text(action, style = YardFonts.bodyEmphasis, color = foreground)
            Box(Modifier.size(28.dp).background(foreground, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = null, tint = background, modifier = Modifier.size(16.dp))
            }
        }
    }
}
