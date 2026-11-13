package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard

/**
 * A bottom sheet with Yard styling: `bg` background, 28dp top corners, a visible grabber.
 * Mirrors `.yardSheet(detents:showsGrabber:)` in `YardSheet.swift` (a Material 3 ModalBottomSheet
 * underneath; iOS detents map to [skipPartiallyExpanded]: false ≈ [.medium, .large], true ≈ [.large]).
 * Toasts inside: wrap the content in `YardToastHost(LocalToastCenter.current) { … }` if needed.
 *
 *   if (showSizes) YardSheet(onDismissRequest = { showSizes = false }) {
 *       YardSheetHeader("Choose size") { showSizes = false }
 *       …
 *   }
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YardSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    skipPartiallyExpanded: Boolean = false,
    sheetState: SheetState = rememberModalBottomSheetState(skipPartiallyExpanded = skipPartiallyExpanded),
    showsGrabber: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier,
        sheetState = sheetState,
        shape = YardShapes.sheet,
        containerColor = Color.yard.bg,
        contentColor = Color.yard.ink,
        tonalElevation = 0.dp,
        scrimColor = Color.yard.scrim.copy(alpha = 0.45f),
        dragHandle = if (showsGrabber) ({ YardSheetGrabber() }) else null,
        content = content,
    )
}

/** The sheet grabber (36 × 5 pill in `ink3`). */
@Composable
fun YardSheetGrabber(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(top = Spacing.s, bottom = Spacing.xs), contentAlignment = Alignment.Center) {
        Box(Modifier.size(width = 36.dp, height = 5.dp).background(Color.yard.ink3.copy(alpha = 0.5f), YardShapes.pill))
    }
}

/** Title row for sheets: title on the left, a glass close button on the right. */
@Composable
fun YardSheetHeader(title: String, modifier: Modifier = Modifier, subtitle: String? = null, onClose: () -> Unit) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.m, bottom = Spacing.s),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = YardFonts.title, color = Color.yard.ink)
            if (subtitle != null) Text(subtitle, style = YardFonts.caption, color = Color.yard.ink2)
        }
        GlassIconButton(Icons.Filled.Close, "Close", size = 34.dp, onClick = onClose)
    }
}

@Preview(name = "Sheet header — dark")
@Composable
private fun SheetDarkPreview() = YardPreview(darkTheme = true) {
    Column { YardSheetGrabber(); YardSheetHeader("Choose size", subtitle = "Fits true to size") {} }
}

@Preview(name = "Sheet header — light")
@Composable
private fun SheetLightPreview() = YardPreview(darkTheme = false) {
    Column { YardSheetGrabber(); YardSheetHeader("Filters") {} }
}
