import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: inbox agent.
// Replace this file's contents, but keep the type name and the initializer
// `ConversationView(id: String)` exactly: App/Router.swift's RouteView calls it.

struct ConversationView: View {
    let id: String

    init(id: String) {
        self.id = id
    }

    var body: some View {
        FeaturePlaceholder("Conversation")
    }
}

#Preview("ConversationView — dark") {
    NavigationStack { ConversationView(id: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ConversationView — light") {
    NavigationStack { ConversationView(id: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
