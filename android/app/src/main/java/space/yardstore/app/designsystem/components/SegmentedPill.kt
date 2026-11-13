package space.yardstore.app.designsystem.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * A pill-shaped segmented control with a sliding selection (reference 07: Status / Details).
 * Mirrors `SegmentedPill.swift` (a binding becomes `selection` + `onSelect`).
 *
 *   SegmentedPill(selection = tab, options = listOf(Tab.Status, Tab.Details), onSelect = { tab = it }) { it.title }
 */
@Composable
fun <T> SegmentedPill(
    selection: T,
    options: List<T>,
    onSelect: (T) -> Unit,
    modifier: Modifier = Modifier,
    title: (T) -> String,
) {
    val haptics = LocalHapticFeedback.current
    val index = options.indexOf(selection).coerceAtLeast(0)
    BoxWithConstraints(
        modifier
            .fillMaxWidth()
            .background(Color.yard.surface2, YardShapes.pill)
            .padding(4.dp),
    ) {
        val segment = if (options.isEmpty()) maxWidth else maxWidth / options.size
        val offset by animateDpAsState(segment * index, Motion.spring(), label = "segment")
        Box(
            Modifier
                .offset(x = offset)
                .width(segment)
                .height(36.dp)
                .shadow(2.dp, YardShapes.pill, ambientColor = Color.yard.scrim.copy(alpha = 0.08f), spotColor = Color.yard.scrim.copy(alpha = 0.08f))
                .background(Color.yard.surface, YardShapes.pill),
        )
        Row(Modifier.fillMaxWidth()) {
            options.forEach { option ->
                val isSelected = option == selection
                Box(
                    Modifier
                        .weight(1f)
                        .height(36.dp)
                        .semantics { selected = isSelected }
                        .clickable(remember { MutableInteractionSource() }, indication = null, role = Role.Tab) {
                            if (option != selection) {
                                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                onSelect(option)
                            }
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        title(option),
                        style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                        color = if (isSelected) Color.yard.ink else Color.yard.ink2,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun SegmentedPreviewContent() {
    var tab by remember { mutableStateOf("Status") }
    SegmentedPill(tab, listOf("Status", "Details"), { tab = it }, Modifier.padding(16.dp)) { it }
}

@Preview(name = "Segmented — dark")
@Composable
private fun SegmentedDarkPreview() = YardPreview(darkTheme = true) { SegmentedPreviewContent() }

@Preview(name = "Segmented — light")
@Composable
private fun SegmentedLightPreview() = YardPreview(darkTheme = false) { SegmentedPreviewContent() }
