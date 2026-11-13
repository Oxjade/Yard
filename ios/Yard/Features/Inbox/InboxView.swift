import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: inbox agent.
// Replace this file's contents, but keep the type name and the initializer
// `InboxView()` exactly: App/Router.swift's RouteView calls it.

struct InboxView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Inbox")
    }
}

#Preview("InboxView — dark") {
    NavigationStack { InboxView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("InboxView — light") {
    NavigationStack { InboxView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
