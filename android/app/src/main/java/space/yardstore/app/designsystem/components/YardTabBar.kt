package space.yardstore.app.designsystem.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.sp
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.rememberReducedMotion
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.GlassBackdrop
import space.yardstore.app.designsystem.GlassStyle
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.yardGlass

/**
 * The one bottom-bar family: the shopper bar (Home · Shop · Around · Cart · Me, purple selection)
 * and the Studio bar (Home · Orders · Products · Me, acid selection) share this capsule — the
 * same shape, height, margins and smoked-glass blur — like the website's phone tab bar
 * (`mobile-tabbar.tsx`: 58px black glass capsule, 12px from the screen edges, max 23rem).
 * Same values on iOS (`YardTabBarMetrics`).
 */
object YardTabBarDefaults {
    /** The capsule's height. */
    val height: Dp = 60.dp
    /** Space between the capsule and the screen's sides. */
    val sideMargin: Dp = 12.dp
    /** The capsule never grows wider than this (tablets in portrait, large phones). */
    val maxWidth: Dp = 400.dp
    /** A tab's touch target and selection-pill height. */
    val itemHeight: Dp = 44.dp
    /** The raised centre button (Around). */
    val pinSize: Dp = 56.dp
    /** How far the centre button rises above the capsule's middle. */
    val pinRise: Dp = 14.dp
    /** The smoked glass fill (#080808, the website's obsidian); alpha comes from [GlassStyle.Bar]. */
    val glass: Color = Color(0xFF080808)

    /** Icons and labels on the bar: white (the bar is dark in both appearances). */
    val ink: Color
        @Composable @ReadOnlyComposable get() = Color.yard.onPhoto

    /** Unselected icons: white at 72%. */
    val inkMuted: Color
        @Composable @ReadOnlyComposable get() = Color.yard.onPhoto.copy(alpha = 0.72f)
}

/** The bar capsule: margins, max width, height and the smoked glass. Put it before the content padding. */
fun Modifier.yardTabBarSurface(backdrop: GlassBackdrop?): Modifier = this
    .padding(horizontal = YardTabBarDefaults.sideMargin)
    .widthIn(max = YardTabBarDefaults.maxWidth)
    .fillMaxWidth()
    .height(YardTabBarDefaults.height)
    .yardGlass(YardShapes.pill, style = GlassStyle.Bar, backdrop = backdrop)

/** One tab of a [YardTabBar]. */
class YardTabBarItem(
    val key: Any,
    val title: String,
    val icon: ImageVector,
    val selectedIcon: ImageVector,
    /** What TalkBack reads (e.g. "Cart, 3 items"); the title when null. */
    val accessibilityLabel: String? = null,
    /** Drawn on the tab's top-right corner (the Cart count). */
    val badge: (@Composable () -> Unit)? = null,
)

/**
 * THE bottom tab bar, used by both the shopper app and Studio: the same capsule
 * ([yardTabBarSurface]), height, margins, smoked-glass blur, icon size and active-tab behaviour
 * (the active tab is a pill with the filled icon and its label; below 380dp the label hides).
 * Only two things vary: the tabs (with an optional raised [centre] button that splits them into
 * two equal halves, as the shopper bar's Around pin does) and the active pill's colours
 * ([activeFill] / [activeInk]: purple for shoppers, acid for Studio). Mirrors iOS `YardTabBar`.
 */
@Composable
fun YardTabBar(
    items: List<YardTabBarItem>,
    selected: Any?,
    activeFill: Color,
    activeInk: Color,
    onSelect: (YardTabBarItem) -> Unit,
    modifier: Modifier = Modifier,
    backdrop: GlassBackdrop? = null,
    /** Shrinks the bar a little (scrolling down on a tab root). */
    collapsed: Boolean = false,
    centre: (@Composable () -> Unit)? = null,
) {
    val reduce = rememberReducedMotion()
    val scale by animateFloatAsState(if (collapsed && !reduce) 0.9f else 1f, Motion.spring(), label = "bar-scale")
    val narrow = LocalYardWindow.current.width < 380.dp
    Box(
        modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
                transformOrigin = TransformOrigin(0.5f, 1f)
            }
            .selectableGroup(),
        contentAlignment = Alignment.BottomCenter,
    ) {
        Row(Modifier.yardTabBarSurface(backdrop).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            @Composable
            fun tab(item: YardTabBarItem) = YardTabBarTab(item, item.key == selected, narrow, activeFill, activeInk) { onSelect(item) }
            if (centre != null) {
                val half = (items.size + 1) / 2
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.End)) { items.take(half).forEach { tab(it) } }
                Spacer(Modifier.width(YardTabBarDefaults.pinSize + 12.dp))
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(2.dp, Alignment.Start)) { items.drop(half).forEach { tab(it) } }
            } else {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                    items.forEach { tab(it) }
                }
            }
        }
        if (centre != null) {
            Box(Modifier.padding(bottom = (YardTabBarDefaults.height - YardTabBarDefaults.pinSize) / 2 + YardTabBarDefaults.pinRise)) { centre() }
        }
    }
}

/** One side tab: the active pill with icon + label, or a plain icon. */
@Composable
private fun YardTabBarTab(item: YardTabBarItem, isSelected: Boolean, narrow: Boolean, activeFill: Color, activeInk: Color, onClick: () -> Unit) {
    val haptics = LocalHapticFeedback.current
    val fill by animateColorAsState(if (isSelected) activeFill else activeFill.copy(alpha = 0f), Motion.snappy(), label = "tab-fill")
    val tint by animateColorAsState(if (isSelected) activeInk else YardTabBarDefaults.inkMuted, Motion.snappy(), label = "tab-tint")
    val showsLabel = isSelected && !narrow
    Box {
        Row(
            Modifier
                .height(YardTabBarDefaults.itemHeight)
                .defaultMinSize(minWidth = YardTabBarDefaults.itemHeight)
                // Not clipped: a badge sits over the pill's edge, as on the website.
                .background(fill, YardShapes.pill)
                .semantics {
                    contentDescription = item.accessibilityLabel ?: item.title
                    selected = isSelected
                }
                .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) {
                    if (!isSelected) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    onClick()
                }
                .animateContentSize(Motion.snappy())
                .padding(horizontal = if (showsLabel) 12.dp else 0.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            Box(Modifier.size(if (showsLabel) 24.dp else YardTabBarDefaults.itemHeight), contentAlignment = Alignment.Center) {
                Icon(if (isSelected) item.selectedIcon else item.icon, contentDescription = null, tint = tint, modifier = Modifier.size(22.dp))
            }
            if (showsLabel) {
                Text(item.title, style = YardFonts.captionEmphasis.copy(fontSize = 13.sp), color = tint, maxLines = 1, modifier = Modifier.padding(start = 6.dp))
            }
        }
        item.badge?.let { Box(Modifier.align(Alignment.TopEnd).offset(x = 2.dp, y = 1.dp)) { it() } }
    }
}
