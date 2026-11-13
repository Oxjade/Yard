import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: home agent.
// Replace this file's contents, but keep the type name and the initializer
// `HomeView()` exactly: App/Router.swift's RouteView calls it.

struct HomeView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Home")
    }
}

#Preview("HomeView — dark") {
    NavigationStack { HomeView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("HomeView — light") {
    NavigationStack { HomeView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
