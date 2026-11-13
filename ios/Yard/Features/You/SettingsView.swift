import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: you agent.
// Replace this file's contents, but keep the type name and the initializer
// `SettingsView()` exactly: App/Router.swift's RouteView calls it.

struct SettingsView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Settings")
    }
}

#Preview("SettingsView — dark") {
    NavigationStack { SettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("SettingsView — light") {
    NavigationStack { SettingsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
