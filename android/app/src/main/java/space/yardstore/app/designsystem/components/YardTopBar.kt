package space.yardstore.app.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yard

/** How the current screen goes back. Provided by the navigation shell (`RootView`). */
data class BackAction(
    /** "back" (pushed screen) or "close" (root of a presented sheet). */
    val isClose: Boolean,
    val perform: () -> Unit,
)

/** The current screen's back action; null on tab roots. Set by `RootView` for every destination. */
val LocalBackAction = compositionLocalOf<BackAction?> { null }

/**
 * ANDROID-ONLY addition (iOS gets this from NavigationStack's bar): a transparent top bar with a
 * glass back (or × in a sheet) button, a centred inline title and trailing actions. It pads for
 * the status bar itself. iOS `.navigationTitle(title)` + `.navigationBarTitleDisplayMode(.inline)`.
 *
 *   YardTopBar("Orders")
 *   YardTopBar("Brand", actions = { GlassIconButton(Icons.Outlined.Share, "Share") { … } })
 */
@Composable
fun YardTopBar(
    title: String?,
    modifier: Modifier = Modifier,
    back: BackAction? = LocalBackAction.current,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Box(
        modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.s),
        contentAlignment = Alignment.Center,
    ) {
        if (title != null) {
            Text(
                title,
                style = YardFonts.headline,
                color = Color.yard.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 56.dp).semantics { heading() },
            )
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            if (back != null) {
                GlassIconButton(
                    if (back.isClose) Icons.Filled.Close else Icons.AutoMirrored.Filled.ArrowBack,
                    contentDescription = if (back.isClose) "Close" else "Back",
                    size = 38.dp,
                    onClick = back.perform,
                )
            }
            Spacer(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
    }
}

@Preview(name = "TopBar — dark")
@Composable
private fun TopBarDarkPreview() = YardPreview(darkTheme = true) {
    Column {
        YardTopBar("Orders", back = BackAction(false) {})
        YardTopBar("Sign in", back = BackAction(true) {}, actions = { GlassIconButton(Icons.Outlined.Share, "Share", size = 38.dp) {} })
        Spacer(Modifier.width(1.dp))
    }
}

@Preview(name = "TopBar — light")
@Composable
private fun TopBarLightPreview() = YardPreview(darkTheme = false) { YardTopBar("Settings", back = BackAction(false) {}) }
