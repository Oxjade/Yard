package space.yardstore.app.designsystem.components

import android.os.Build
import android.view.WindowManager
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.material3.SheetValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
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
 *
 * Sheets that hold text input or a form (sign-in, account changes, returns) pass
 * `dismissOnScrimTap = false`: a tap outside the card or a swipe down never closes them (and never
 * loses what was typed); they close only with their × (call [onDismissRequest] / `sheetState.hide()`)
 * or system back. Pickers and menus keep the default (tap outside closes). When you pass your own
 * [sheetState], build it with [rememberYardSheetState] so the same rule applies to the swipe.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YardSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    skipPartiallyExpanded: Boolean = false,
    /** False for sheets with input: tapping the scrim or swiping down does nothing (× and back still close). */
    dismissOnScrimTap: Boolean = true,
    sheetState: SheetState = rememberYardSheetState(skipPartiallyExpanded, dismissOnScrimTap),
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
        YardDialogSheet(onDismissRequest = onDismissRequest, modifier = modifier, dismissOnScrimTap = dismissOnScrimTap, content = content)
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
    ) {
        SheetBackdropBlur()
        content()
    }
}

/**
 * Whether a bottom sheet may settle to Hidden from a user gesture (scrim tap, swipe down).
 * Programmatic `hide()` (the × button, system back) is not gated by this, so form sheets still close.
 */
@OptIn(ExperimentalMaterial3Api::class)
fun yardSheetAllowsGestureDismiss(target: SheetValue, dismissOnScrimTap: Boolean, canDismiss: Boolean = true): Boolean =
    target != SheetValue.Hidden || (dismissOnScrimTap && canDismiss)

/** A [SheetState] for [YardSheet] that applies the [dismissOnScrimTap] rule (and an optional live [canDismiss]). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun rememberYardSheetState(
    skipPartiallyExpanded: Boolean = false,
    dismissOnScrimTap: Boolean = true,
    canDismiss: () -> Boolean = { true },
): SheetState {
    val allowGesture by rememberUpdatedState(dismissOnScrimTap)
    val canDismissNow by rememberUpdatedState(canDismiss)
    return rememberModalBottomSheetState(
        skipPartiallyExpanded = skipPartiallyExpanded,
        confirmValueChange = { yardSheetAllowsGestureDismiss(it, allowGesture, canDismissNow()) },
    )
}

/**
 * Sheets are a physical layer: on API 31+ (when the device allows cross-window blur) the app
 * behind the sheet's scrim is blurred by the window manager. Older devices keep the plain scrim.
 * Call inside a dialog window's content (ModalBottomSheet, Dialog).
 */
@Composable
internal fun SheetBackdropBlur(radius: Dp = 20.dp) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
    val view = LocalView.current
    val px = with(LocalDensity.current) { radius.roundToPx() }
    DisposableEffect(view, px) {
        runCatching {
            val window = (view.parent as? DialogWindowProvider)?.window ?: return@runCatching
            if (!window.windowManager.isCrossWindowBlurEnabled) return@runCatching
            window.addFlags(WindowManager.LayoutParams.FLAG_BLUR_BEHIND)
            window.attributes = window.attributes.apply { blurBehindRadius = px }
        }
        onDispose { }
    }
}

/**
 * A sheet presented as a centered dialog surface on wide windows (iPad form sheet): `bg`
 * background, 28dp corners, at most [maxWidth] wide and [maxHeight] tall (and 32dp clear of the
 * window edges), over a scrim. Android back calls [onDismissRequest]; tapping the scrim does too
 * unless [dismissOnScrimTap] is false (sheets with input: they close only with × or back).
 * Taps inside the card, the keyboard opening and focus changes never dismiss it.
 * The content gets a bounded height, so `fillMaxSize()` content (a NavHost, a screen) works.
 */
@Composable
fun YardDialogSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    maxWidth: Dp = YardWindow.dialogSheetMaxWidth,
    maxHeight: Dp = 820.dp,
    dismissOnScrimTap: Boolean = true,
    content: @Composable ColumnScope.() -> Unit,
) {
    val dismiss by rememberUpdatedState(onDismissRequest)
    Dialog(
        onDismissRequest = onDismissRequest,
        // The content fills the window and draws its own scrim, so outside taps are handled below.
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnClickOutside = false,
            dismissOnBackPress = true,
        ),
    ) {
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .testTag(YardDialogSheetTags.SCRIM)
                .then(
                    if (dismissOnScrimTap) {
                        Modifier.clickable(remember { MutableInteractionSource() }, indication = null) { dismiss() }
                    } else {
                        Modifier
                    },
                )
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(32.dp),
            contentAlignment = Alignment.Center,
        ) {
            val w = minOf(this.maxWidth, maxWidth)
            val h = minOf(this.maxHeight, maxHeight)
            Column(
                modifier
                    .testTag(YardDialogSheetTags.CARD)
                    .size(width = w, height = h)
                    .shadow(24.dp, RoundedCornerShape(Radius.sheet), ambientColor = Color.yard.scrim.copy(alpha = 0.3f), spotColor = Color.yard.scrim.copy(alpha = 0.3f))
                    .clip(RoundedCornerShape(Radius.sheet))
                    .background(Color.yard.bg)
                    // Swallow taps so they don't reach the scrim's dismiss.
                    .clickable(remember { MutableInteractionSource() }, indication = null) {},
            ) {
                SheetBackdropBlur()
                CompositionLocalProvider(LocalContentColor provides Color.yard.ink) { content() }
            }
        }
    }
}

/** Test tags of [YardDialogSheet]'s scrim (the area around the card) and card. */
object YardDialogSheetTags {
    const val SCRIM = "yard-dialog-sheet-scrim"
    const val CARD = "yard-dialog-sheet-card"
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
