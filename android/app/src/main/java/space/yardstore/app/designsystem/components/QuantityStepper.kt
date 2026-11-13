package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * A compact − qty + stepper for bag rows. Server-driven: it reports the wanted value and the caller
 * updates the cart (`CartStore.setQuantity`). Mirrors `QuantityStepper.swift`.
 *
 *   QuantityStepper(line.qty, range = 0..minOf(10, line.available), isBusy = line.variantId in cart.busyVariantIds) { qty ->
 *       scope.launch { try { cart.setQuantity(line.variantId, qty) } catch (e: Exception) { toast.show(e) } }
 *   }
 * At the lower bound the minus becomes a trash icon (0 removes the line when [range] starts at 0).
 */
@Composable
fun QuantityStepper(
    value: Int,
    modifier: Modifier = Modifier,
    range: IntRange = 0..10,
    isBusy: Boolean = false,
    onChange: (Int) -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val removesOnMinus = value - 1 <= 0 && range.first <= 0
    Row(
        modifier
            .background(Color.yard.surface2, YardShapes.pill)
            .padding(3.dp)
            .semantics(mergeDescendants = false) { stateDescription = "Quantity $value" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        StepButton(
            icon = if (removesOnMinus) Icons.Outlined.Delete else Icons.Filled.Remove,
            label = if (removesOnMinus) "Remove" else "Decrease",
            enabled = !isBusy && value - 1 >= range.first,
        ) {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onChange(value - 1)
        }
        Box(Modifier.widthIn(min = 28.dp), contentAlignment = Alignment.Center) {
            if (isBusy) {
                CircularProgressIndicator(color = Color.yard.ink, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
            } else {
                Text("$value", style = YardFonts.number(15.sp), color = Color.yard.ink)
            }
        }
        StepButton(Icons.Filled.Add, "Increase", enabled = !isBusy && value + 1 <= range.last) {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onChange(value + 1)
        }
    }
}

@Composable
private fun StepButton(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(30.dp)
            .background(Color.yard.surface, CircleShape)
            .semantics { contentDescription = label }
            .pressableClick(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = if (enabled) Color.yard.ink else Color.yard.ink3, modifier = Modifier.size(14.dp))
    }
}

@Preview(name = "Stepper — dark")
@Composable
private fun StepperDarkPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        QuantityStepper(1) {}
        QuantityStepper(3, range = 0..3) {}
        QuantityStepper(2, isBusy = true) {}
    }
}

@Preview(name = "Stepper — light")
@Composable
private fun StepperLightPreview() = YardPreview(darkTheme = false) {
    QuantityStepper(2, Modifier.padding(16.dp)) {}
}
