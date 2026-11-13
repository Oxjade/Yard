package space.yardstore.app.designsystem.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.yard

/**
 * Honest empty and error states with Yard's colours (iOS `ContentUnavailableView`). Mirrors `EmptyState.swift`.
 *
 *   EmptyState("Nothing saved yet", message = "Tap the heart on any piece to keep it here.",
 *              icon = Icons.Outlined.FavoriteBorder, actionTitle = "Browse") { router.select(AppTab.Home) }
 *   EmptyState.Error(error) { viewModel.load() }          // shows APIError.message + "Try again"
 *   EmptyState.SignedOut(message = "Sign in to see your orders.") { router.present(Route.SignIn) }
 */
@Composable
fun EmptyState(
    title: String,
    modifier: Modifier = Modifier,
    message: String? = null,
    icon: ImageVector = Icons.Outlined.AutoAwesome,
    actionTitle: String? = null,
    action: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = Spacing.xl, vertical = Spacing.xxl),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Icon(icon, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(44.dp))
        Spacer(Modifier.height(Spacing.m))
        Text(title, style = YardFonts.title, color = Color.yard.ink, textAlign = TextAlign.Center)
        if (message != null) {
            Spacer(Modifier.height(Spacing.s))
            Text(message, style = YardFonts.callout, color = Color.yard.ink2, textAlign = TextAlign.Center)
        }
        if (actionTitle != null && action != null) {
            Spacer(Modifier.height(Spacing.l))
            YardButton(actionTitle, style = YardButtonStyle.Secondary, size = YardButtonSize.Medium, fullWidth = false, onClick = action)
        }
    }
}

/** The iOS `EmptyState.error(…)` / `.signedOut(…)` factories. */
object EmptyState {
    /** An error with a retry button. `retry` runs in a coroutine. */
    @Composable
    fun Error(error: Throwable, modifier: Modifier = Modifier, retry: suspend () -> Unit) =
        Error(message = APIError.messageFor(error), modifier = modifier, retry = retry)

    /** A message-only error with a retry button. */
    @Composable
    fun Error(message: String, modifier: Modifier = Modifier, retry: suspend () -> Unit) {
        val scope = rememberCoroutineScope()
        EmptyState(
            title = "Couldn't load this",
            modifier = modifier,
            message = message,
            icon = Icons.Outlined.CloudOff,
            actionTitle = "Try again",
            action = { scope.launch { retry() } },
        )
    }

    /** Signed-out gate for shopper-only screens. */
    @Composable
    fun SignedOut(message: String, modifier: Modifier = Modifier, title: String = "Sign in to Yard", signIn: () -> Unit) =
        EmptyState(title = title, modifier = modifier, message = message, icon = Icons.Outlined.AccountCircle, actionTitle = "Sign in", action = signIn)
}

@Preview(name = "Empty — dark")
@Composable
private fun EmptyDarkPreview() = YardPreview(darkTheme = true) {
    Column {
        EmptyState("Your bag is empty", message = "Pieces you add from any brand land here.", icon = Icons.Outlined.ShoppingBag, actionTitle = "Start shopping") {}
        EmptyState.Error(message = "You're offline. Check your connection and try again.") {}
    }
}

@Preview(name = "Empty — light")
@Composable
private fun EmptyLightPreview() = YardPreview(darkTheme = false) {
    EmptyState.SignedOut(message = "Sign in to see your orders.") {}
}
