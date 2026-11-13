import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: you agent.
// Replace this file's contents, but keep the type name and the initializer
// `AppearanceView()` exactly: App/Router.swift's RouteView calls it.

struct AppearanceView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Appearance")
    }
}

#Preview("AppearanceView — dark") {
    NavigationStack { AppearanceView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("AppearanceView — light") {
    NavigationStack { AppearanceView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
