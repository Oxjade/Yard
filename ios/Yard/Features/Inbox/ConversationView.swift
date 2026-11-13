import SwiftUI

/// One conversation with a brand (route `.conversation(id:)`, also opened from notifications and
/// `/inbox?thread=` links). Messages, order context, composer; polls every 5 s while open.
@MainActor
struct ConversationView: View {
    let id: String

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @State private var model: InboxThreadModel

    init(id: String) {
        self.id = id
        _model = State(initialValue: InboxThreadModel(conversationId: id))
    }

    var body: some View {
        if session.isSignedIn {
            InboxThreadScreen(model: model)
        } else {
            InboxSignedOutGate(hasLoaded: session.hasLoaded) { router.present(.signIn) }
        }
    }
}

/// Signed-out state for the thread screens (skeleton while the session is still loading).
struct InboxSignedOutGate: View {
    let hasLoaded: Bool
    let signIn: () -> Void

    var body: some View {
        Group {
            if hasLoaded {
                EmptyState.signedOut(title: "Your inbox", message: "Sign in to message brands about sizing, stock and delivery.", signIn: signIn)
            } else {
                InboxThreadSkeleton()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.yard.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
    }
}

#Preview("ConversationView — dark") {
    NavigationStack { InboxThreadScreen(model: InboxThreadPreviewData.model()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ConversationView — light") {
    NavigationStack { ConversationView(id: "preview") }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}
