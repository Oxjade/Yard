package space.yardstore.app.features.inbox

import androidx.compose.runtime.Composable
import androidx.compose.ui.tooling.preview.Preview
import androidx.lifecycle.viewmodel.compose.viewModel
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.YardPreview

/**
 * "Message" from a storefront or product (route `Route.MessageBrand(brandId)`).
 * Resolves GET /api/inbox/conversations/by-brand/{brandId}: an existing thread opens as itself;
 * otherwise a new-thread composer whose first send creates the conversation (POST /api/inbox/messages
 * with `brandId`). When the brand can't be messaged, the composer says why.
 * Mirrors `BrandConversationView.swift`.
 */
@Composable
fun BrandConversationView(brandId: String) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    if (session.isSignedIn) {
        val model: InboxThreadModel = viewModel(key = "inbox-brand-$brandId") { InboxThreadModel.forBrand(brandId) }
        InboxThreadScreen(model)
    } else {
        InboxSignedOutGate(hasLoaded = session.hasLoaded) { router.present(Route.SignIn) }
    }
}

@Preview(name = "BrandConversationView — dark")
@Composable
private fun BrandConversationViewDark() = YardPreview(darkTheme = true) {
    InboxThreadScreen(InboxThreadPreviewData.model(), autoLoad = false)
}

@Preview(name = "BrandConversationView — light")
@Composable
private fun BrandConversationViewLight() = YardPreview(darkTheme = false, signedIn = false) { BrandConversationView(brandId = "preview") }
