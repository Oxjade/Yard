package space.yardstore.app.features.inbox

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.viewmodel.compose.viewModel
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground

/**
 * One conversation with a brand (route `Route.Conversation(id)`, also opened from notifications and
 * `/inbox?thread=` links). Messages, order context, composer; polls every 5 s while open.
 * Mirrors `ConversationView.swift`.
 */
@Composable
fun ConversationView(id: String) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    if (session.isSignedIn) {
        val model: InboxThreadModel = viewModel(key = "inbox-thread-$id") { InboxThreadModel.forConversation(id) }
        InboxThreadScreen(model)
    } else {
        InboxSignedOutGate(hasLoaded = session.hasLoaded) { router.present(Route.SignIn) }
    }
}

/** Signed-out state for the thread screens (skeleton while the session is still loading). */
@Composable
fun InboxSignedOutGate(hasLoaded: Boolean, signIn: () -> Unit) {
    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(null)
        if (hasLoaded) {
            EmptyState.SignedOut(
                message = "Sign in to message brands about sizing, stock and delivery.",
                modifier = Modifier.weight(1f),
                title = "Your inbox",
                signIn = signIn,
            )
        } else {
            InboxThreadSkeleton()
        }
    }
}

@Preview(name = "ConversationView — dark")
@Composable
private fun ConversationViewDark() = YardPreview(darkTheme = true) {
    InboxThreadScreen(InboxThreadPreviewData.model(), autoLoad = false)
}

@Preview(name = "ConversationView — light")
@Composable
private fun ConversationViewLight() = YardPreview(darkTheme = false, signedIn = false) { ConversationView(id = "preview") }
