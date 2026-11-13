import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: drops agent.
// Replace this file's contents, but keep the type name and the initializer
// `DropsView()` exactly: App/Router.swift's RouteView calls it.

struct DropsView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Drops")
    }
}

#Preview("DropsView — dark") {
    NavigationStack { DropsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("DropsView — light") {
    NavigationStack { DropsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
