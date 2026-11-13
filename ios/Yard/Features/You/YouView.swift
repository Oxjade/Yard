import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: you agent.
// Replace this file's contents, but keep the type name and the initializer
// `YouView()` exactly: App/Router.swift's RouteView calls it.

struct YouView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("You")
    }
}

#Preview("YouView — dark") {
    NavigationStack { YouView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("YouView — light") {
    NavigationStack { YouView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
