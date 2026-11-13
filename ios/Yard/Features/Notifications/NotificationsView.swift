import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: notifications agent.
// Replace this file's contents, but keep the type name and the initializer
// `NotificationsView()` exactly: App/Router.swift's RouteView calls it.

struct NotificationsView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Notifications")
    }
}

#Preview("NotificationsView — dark") {
    NavigationStack { NotificationsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("NotificationsView — light") {
    NavigationStack { NotificationsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
