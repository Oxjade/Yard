import SwiftUI

/// "Message" from a storefront or product (route `.messageBrand(brandId:)`).
/// Resolves GET /api/inbox/conversations/by-brand/{brandId}: an existing thread opens as itself;
/// otherwise a new-thread composer whose first send creates the conversation (POST /api/inbox/messages
/// with `brandId`). When the brand can't be messaged, the composer says why.
@MainActor
struct BrandConversationView: View {
    let brandId: String

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @State private var model: InboxThreadModel

    init(brandId: String) {
        self.brandId = brandId
        _model = State(initialValue: InboxThreadModel(brandId: brandId))
    }

    var body: some View {
        if session.isSignedIn {
            InboxThreadScreen(model: model)
        } else {
            InboxSignedOutGate(hasLoaded: session.hasLoaded) { router.present(.signIn) }
        }
    }
}

#Preview("BrandConversationView — dark") {
    NavigationStack { InboxThreadScreen(model: InboxThreadPreviewData.model()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BrandConversationView — light") {
    NavigationStack { BrandConversationView(brandId: "preview") }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
