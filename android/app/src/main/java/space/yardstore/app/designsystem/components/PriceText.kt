package space.yardstore.app.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Money
import space.yardstore.app.core.models.Product
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard

/**
 * A formatted price, with the compare-at ("was") price struck through when it is higher.
 * Mirrors `PriceText.swift`.
 *
 *   PriceText(minor = product.priceMinor, currency = product.currency, compareAtMinor = product.compareAtMinor)
 *   PriceText(money = line.unitPrice!!, style = YardFonts.title)
 *   PriceText(product = product)                         // uses the product's price/compareAt
 */
@Composable
fun PriceText(
    minor: Int,
    currency: String,
    modifier: Modifier = Modifier,
    compareAtMinor: Int? = null,
    style: TextStyle = YardFonts.bodyEmphasis,
    color: Color = Color.yard.ink,
) {
    val now = Formatters.price(minor, currency)
    val was = compareAtMinor?.takeIf { it > minor }?.let { Formatters.price(it, currency) }
    val a11y = if (was != null) "$now, was $was" else now
    Row(
        modifier = modifier.clearAndSetSemantics { contentDescription = a11y },
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
    ) {
        Text(now, style = style.monospacedDigits(), color = color, modifier = Modifier.alignByBaseline())
        if (was != null) {
            Text(
                was,
                style = YardFonts.caption.copy(textDecoration = TextDecoration.LineThrough),
                color = Color.yard.ink3,
                modifier = Modifier.alignByBaseline(),
            )
        }
    }
}

/** [PriceText] for a [Money]. */
@Composable
fun PriceText(
    money: Money,
    modifier: Modifier = Modifier,
    compareAtMinor: Int? = null,
    style: TextStyle = YardFonts.bodyEmphasis,
    color: Color = Color.yard.ink,
) = PriceText(money.amount, money.currency, modifier, compareAtMinor, style, color)

/** [PriceText] for a product's price and compare-at price. */
@Composable
fun PriceText(
    product: Product,
    modifier: Modifier = Modifier,
    style: TextStyle = YardFonts.bodyEmphasis,
    color: Color = Color.yard.ink,
) = PriceText(product.priceMinor, product.currency, modifier, product.compareAtMinor, style, color)

@Preview(name = "Price — dark")
@Composable
private fun PriceDarkPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        PriceText(4500, "USD")
        PriceText(3200, "USD", compareAtMinor = 4000)
        PriceText(1_250_000, "NGN", style = YardFonts.title)
    }
}

@Preview(name = "Price — light")
@Composable
private fun PriceLightPreview() = YardPreview(darkTheme = false) {
    PriceText(6400, "MXN", Modifier.padding(16.dp), compareAtMinor = 8000)
}
