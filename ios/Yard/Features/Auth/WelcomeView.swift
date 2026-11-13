import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: auth agent.
// Replace this file's contents, but keep the type name and the initializer
// `WelcomeView()` exactly: App/Router.swift's RouteView calls it.

struct WelcomeView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Welcome")
    }
}

#Preview("WelcomeView — dark") {
    NavigationStack { WelcomeView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("WelcomeView — light") {
    NavigationStack { WelcomeView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
