package space.yardstore.app.designsystem.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.YardWindow
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
    /**
     * On wide windows (`LocalYardWindow.current.sheetIsDialog`) show a centered [YardDialogSheet]
     * instead of a bottom sheet ([sheetState] is then unused). Route sheets (`router.present`) do this.
     * Off by default: a plain YardSheet on a tablet is a bottom sheet capped at 640dp, centered.
     */
    presentAsDialogOnWide: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (presentAsDialogOnWide && LocalYardWindow.current.sheetIsDialog) {
        YardDialogSheet(onDismissRequest = onDismissRequest, modifier = modifier, content = content)
        return
    }
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

/**
 * A sheet presented as a centered dialog surface on wide windows (iPad form sheet): `bg`
 * background, 28dp corners, at most [maxWidth] wide and [maxHeight] tall (and 32dp clear of the
 * window edges), over a scrim. Tapping the scrim or Android back calls [onDismissRequest].
 * The content gets a bounded height, so `fillMaxSize()` content (a NavHost, a screen) works.
 */
@Composable
fun YardDialogSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    maxWidth: Dp = YardWindow.dialogSheetMaxWidth,
    maxHeight: Dp = 820.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .clickable(remember { MutableInteractionSource() }, indication = null, onClick = onDismissRequest)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(32.dp),
            contentAlignment = Alignment.Center,
        ) {
            val w = minOf(this.maxWidth, maxWidth)
            val h = minOf(this.maxHeight, maxHeight)
            Column(
                modifier
                    .size(width = w, height = h)
                    .shadow(24.dp, RoundedCornerShape(Radius.sheet), ambientColor = Color.yard.scrim.copy(alpha = 0.3f), spotColor = Color.yard.scrim.copy(alpha = 0.3f))
                    .clip(RoundedCornerShape(Radius.sheet))
                    .background(Color.yard.bg)
                    // Swallow taps so they don't reach the scrim's dismiss.
                    .clickable(remember { MutableInteractionSource() }, indication = null) {},
            ) {
                CompositionLocalProvider(LocalContentColor provides Color.yard.ink) { content() }
            }
        }
    }
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
