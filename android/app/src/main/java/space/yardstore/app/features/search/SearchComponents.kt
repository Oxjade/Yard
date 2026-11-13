package space.yardstore.app.features.search

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.Formatters
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.yard

// Small building blocks private to the Search feature (prefixed `Search…`). Mirrors SearchComponents.swift.

/** Wraps its children onto as many rows as needed (Browse and Try chips). iOS `SearchFlowLayout`. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SearchFlowLayout(
    modifier: Modifier = Modifier,
    spacing: Dp = Spacing.s,
    lineSpacing: Dp = Spacing.s,
    content: @Composable () -> Unit,
) {
    FlowRow(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(spacing),
        verticalArrangement = Arrangement.spacedBy(lineSpacing),
    ) { content() }
}

/** A small caption-style section label ("Recent", "Browse", "Brands"), with an optional action. */
@Composable
fun SearchSectionLabel(
    title: String,
    modifier: Modifier = Modifier,
    actionTitle: String? = null,
    action: (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            title.uppercase(),
            style = YardFonts.captionEmphasis,
            color = Color.yard.ink3,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.weight(1f).width(Spacing.s))
        if (actionTitle != null && action != null) {
            Text(
                actionTitle,
                style = YardFonts.captionEmphasis,
                color = Color.yard.ink2,
                modifier = Modifier
                    .clip(YardShapes.pill)
                    .clickable(onClick = action)
                    .padding(horizontal = Spacing.s, vertical = Spacing.xs),
            )
        }
    }
}

/** A product match in the type-ahead list: thumbnail, title, brand, price. */
@Composable
fun SearchProductRow(item: SearchItem, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RemoteImage(
            item.image,
            Modifier.size(52.dp).clip(YardShapes.small),
            maxPixelSize = 200,
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.title, style = YardFonts.body, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val brandName = item.brandName
            if (!brandName.isNullOrEmpty()) {
                Text(brandName, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        item.shownPrice?.let { price ->
            Text(
                Formatters.price(price.amount, price.currency),
                style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                color = Color.yard.ink,
            )
        }
    }
}

/** A brand match in the type-ahead list: monogram, name, city. */
@Composable
fun SearchBrandRow(brand: SearchBrandHit, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BrandAvatar(name = brand.name, size = 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(brand.name, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            brand.locationText?.let {
                Text(it, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Icon(
            Icons.AutoMirrored.Outlined.KeyboardArrowRight,
            contentDescription = null,
            tint = Color.yard.ink3,
            modifier = Modifier.size(18.dp),
        )
    }
}

/** Loading rows while the marketplace is searched. */
@Composable
fun SearchRowsSkeleton(modifier: Modifier = Modifier, count: Int = 4) {
    Column(
        modifier
            .fillMaxWidth()
            .clearAndSetSemantics { contentDescription = "Searching the marketplace" },
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        repeat(count) { index ->
            Row(
                Modifier.padding(horizontal = Spacing.gutter),
                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Skeleton(Modifier.size(52.dp), cornerRadius = Radius.small)
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Skeleton(Modifier.width(if (index % 2 == 0) 170.dp else 130.dp).height(12.dp), cornerRadius = 4.dp)
                    Skeleton(Modifier.width(90.dp).height(10.dp), cornerRadius = 4.dp)
                }
            }
        }
    }
}

// region Previews

@Composable
private fun SearchRowsPreviewContent() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        SearchSectionLabel("Brands", actionTitle = "Clear") {}
        SearchPreviewData.brands.forEach { SearchBrandRow(it) }
        SearchSectionLabel("Products")
        SearchPreviewData.items.forEach { SearchProductRow(it) }
        SearchRowsSkeleton(count = 2)
    }
}

@Preview(name = "Search rows — dark")
@Composable
private fun SearchRowsDarkPreview() = YardPreview(darkTheme = true) { SearchRowsPreviewContent() }

@Preview(name = "Search rows — light")
@Composable
private fun SearchRowsLightPreview() = YardPreview(darkTheme = false) { SearchRowsPreviewContent() }

// endregion
