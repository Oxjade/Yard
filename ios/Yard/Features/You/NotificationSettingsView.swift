import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: you agent.
// Replace this file's contents, but keep the type name and the initializer
// `NotificationSettingsView()` exactly: App/Router.swift's RouteView calls it.

struct NotificationSettingsView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Notifications")
    }
}

#Preview("NotificationSettingsView — dark") {
    NavigationStack { NotificationSettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("NotificationSettingsView — light") {
    NavigationStack { NotificationSettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
