package space.yardstore.app.features.product

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.models.ProductOption
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.ChipRow
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard

/**
 * Chips (or colour swatches when the values carry hex codes) for one option axis.
 * Values with no stock for the other chosen options are disabled (struck through), unless the
 * brand is still opening, when every value reads as open (website rule).
 * Mirrors `ProductOptionPicker` in ProductOptionPickers.swift.
 */
@Composable
fun ProductOptionPicker(
    option: ProductOption,
    model: ProductDetailModel,
    modifier: Modifier = Modifier,
    showsHeader: Boolean = true,
    showsInvalid: Boolean = false,
    onChoose: (String) -> Unit = {},
) {
    val haptics = LocalHapticFeedback.current
    val chosen = model.selection[option.name]
    val isSize = ProductDetailModel.isSizeName(option.name)
    val hasSwatches = option.values.any { it.hex != null }

    fun isEnabled(value: String): Boolean = model.isOpening || model.stock(value, option) > 0

    fun choose(value: String) {
        if (chosen != value) haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
        model.choose(value, option)
        onChoose(value)
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (showsHeader) {
            Row(Modifier.padding(horizontal = Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(option.name, style = YardFonts.callout, color = Color.yard.ink2)
                if (chosen != null) {
                    Text(chosen, style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold), color = Color.yard.ink)
                }
            }
        }
        ChipRow {
            option.values.forEach { value ->
                val enabled = isEnabled(value.value)
                if (hasSwatches && !isSize) {
                    ProductSwatchChip(value, selected = chosen == value.value, enabled = enabled) { choose(value.value) }
                } else {
                    Chip(
                        value.value,
                        modifier = if (enabled) Modifier else Modifier.semantics { contentDescription = "${value.value}, sold out" },
                        isSelected = chosen == value.value,
                        isEnabled = enabled,
                    ) { choose(value.value) }
                }
            }
        }
        AnimatedVisibility(visible = showsInvalid && chosen == null, enter = fadeIn(Motion.snappy()), exit = fadeOut(Motion.snappy())) {
            Text(
                if (model.isOpening) "Choose a size to hear when it goes on sale." else "Choose a size to add this to your bag.",
                style = YardFonts.caption,
                color = Color.yard.danger,
                modifier = Modifier.padding(horizontal = Spacing.gutter),
            )
        }
    }
}

/** A colour value as a pill with its swatch dot. */
@Composable
private fun ProductSwatchChip(value: ProductOption.Value, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val border by animateColorAsState(if (selected) Color.yard.ink else Color.yard.line, Motion.snappy(), label = "swatch-border")
    Row(
        Modifier
            .semantics {
                this.selected = selected
                contentDescription = if (enabled) value.value else "${value.value}, sold out"
            }
            .background(Color.yard.surface2, YardShapes.pill)
            .border(BorderStroke(if (selected) 2.dp else 1.dp, border), YardShapes.pill)
            .pressableClick(onClick = onClick)
            .defaultMinSize(minHeight = 36.dp)
            .padding(start = Spacing.s, end = Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(18.dp)
                .background(ProductSwatchColor.color(value.hex) ?: Color.yard.surface2, CircleShape)
                .border(BorderStroke(1.dp, Color.yard.line), CircleShape),
        )
        Text(
            value.value,
            style = YardFonts.callout.copy(
                fontWeight = FontWeight.SemiBold,
                textDecoration = if (enabled) null else TextDecoration.LineThrough,
            ),
            color = if (enabled) Color.yard.ink else Color.yard.ink3,
            maxLines = 1,
        )
    }
}

/**
 * A colour swatch's fill comes from the product data (the brand's own hex), not from the theme:
 * it is content, like a photo.
 */
object ProductSwatchColor {
    fun color(hex: String?): Color? {
        var s = hex?.trim().orEmpty()
        if (s.isEmpty()) return null
        if (s.startsWith("#")) s = s.drop(1)
        if (s.length == 3) s = s.map { "$it$it" }.joinToString("")
        if (s.length != 6) return null
        val v = s.toLongOrNull(16) ?: return null
        return Color(0xFF000000 or v)
    }
}

/**
 * The "Select a size" sheet body: option chips, stock line, quantity and the main action.
 * Mirrors `ProductSizeSheet` (the caller wraps it in a `YardSheet`).
 */
@Composable
fun ProductSizeSheet(
    model: ProductDetailModel,
    isAdding: Boolean,
    onAdd: () -> Unit,
    onNotify: () -> Unit,
    onClose: () -> Unit,
) {
    val cart = LocalCartStore.current
    var showsInvalid by remember { mutableStateOf(false) }
    val p = model.product
    val colour = model.otherOptions.firstOrNull()?.let { model.selection[it.name] }
    val subtitle = p?.let { if (colour != null) "${it.title}, $colour" else it.title }

    Column(Modifier.fillMaxWidth().navigationBarsPadding(), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        YardSheetHeader("Select a size", subtitle = subtitle, onClose = onClose)

        Column(
            Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState()).padding(vertical = Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            model.otherOptions.forEach { option ->
                ProductOptionPicker(option, model)
            }
            model.sizeOption?.let { size ->
                ProductOptionPicker(size, model, showsHeader = model.otherOptions.isNotEmpty(), showsInvalid = showsInvalid) {
                    showsInvalid = false
                }
            }
            ProductStockLineView(model, Modifier.padding(horizontal = Spacing.gutter))
        }

        Box(Modifier.padding(start = Spacing.gutter, end = Spacing.gutter, bottom = Spacing.m)) {
            val action = model.action(cart)
            val v = model.variant
            when (action) {
                ProductBuyAction.Opening, ProductBuyAction.SoldOut -> when {
                    v != null -> {
                        val active = model.isWatching(v.id)
                        YardButton(
                            if (active) "Stop watching" else "Notify me",
                            icon = Icons.Outlined.NotificationsNone,
                            style = if (active) YardButtonStyle.Secondary else YardButtonStyle.Primary,
                            isLoading = model.watchBusy,
                            onClick = onNotify,
                        )
                    }
                    action == ProductBuyAction.Opening ->
                        YardButton("Notify me", icon = Icons.Outlined.NotificationsNone) { showsInvalid = true }
                    else -> YardButton("Sold out", style = YardButtonStyle.Secondary, enabled = false) {}
                }
                ProductBuyAction.ChooseSize ->
                    YardButton("Add to bag", icon = Icons.Outlined.ShoppingBag) { showsInvalid = true }
                ProductBuyAction.Limit ->
                    YardButton("Add to bag", style = YardButtonStyle.Secondary, enabled = false) {}
                ProductBuyAction.Ready ->
                    YardButton("Add to bag", icon = Icons.Outlined.ShoppingBag, isLoading = isAdding, onClick = onAdd)
            }
        }
    }
}

/** "● Only 2 left" (website `StockLine`). */
@Composable
fun ProductStockLineView(model: ProductDetailModel, modifier: Modifier = Modifier) {
    val (text, tone) = model.stockLine()
    val dot by animateColorAsState(
        when (tone) {
            ProductDetailModel.StockTone.Ok -> Color.yard.violet
            ProductDetailModel.StockTone.Low -> Color.yard.acid
            ProductDetailModel.StockTone.Out -> Color.yard.ink3
            ProductDetailModel.StockTone.Muted -> Color.yard.ink3.copy(alpha = 0.6f)
        },
        Motion.snappy(),
        label = "stock-dot",
    )
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(6.dp).background(dot, CircleShape))
        Text(text, style = YardFonts.callout, color = if (tone == ProductDetailModel.StockTone.Low) Color.yard.ink else Color.yard.ink2)
    }
}

// region Previews (fixtures are preview-only)

@Preview(name = "Size sheet — dark", heightDp = 420)
@Composable
private fun ProductSizeSheetDarkPreview() = YardPreview(darkTheme = true) {
    val model = remember { ProductDetailModel(ProductDetailPreviewData.product) }
    ProductSizeSheet(model, isAdding = false, onAdd = {}, onNotify = {}, onClose = {})
}

@Preview(name = "Size sheet — light", heightDp = 420)
@Composable
private fun ProductSizeSheetLightPreview() = YardPreview(darkTheme = false) {
    val model = remember { ProductDetailModel(ProductDetailPreviewData.product) }
    ProductSizeSheet(model, isAdding = false, onAdd = {}, onNotify = {}, onClose = {})
}

// endregion
