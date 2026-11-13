package space.yardstore.app.designsystem.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Construction
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import space.yardstore.app.designsystem.YardPreview

/**
 * Temporary body for a feature screen that hasn't been built yet. Feature agents replace the
 * placeholder files (keeping the function name and parameters) and stop using this.
 */
@Composable
fun FeaturePlaceholder(title: String, detail: String? = null) {
    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(title)
        Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
            EmptyState(title = title, message = detail ?: "This screen is on its way.", icon = Icons.Outlined.Construction)
        }
    }
}

@Preview(name = "Placeholder — dark")
@Composable
private fun PlaceholderDarkPreview() = YardPreview(darkTheme = true) { FeaturePlaceholder("Coming soon") }

@Preview(name = "Placeholder — light")
@Composable
private fun PlaceholderLightPreview() = YardPreview(darkTheme = false) { FeaturePlaceholder("Coming soon") }
