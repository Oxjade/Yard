import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: around agent.
// Replace this file's contents, but keep the type name and the initializer
// `AroundView()` exactly: App/Router.swift's RouteView calls it.

struct AroundView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Around")
    }
}

#Preview("AroundView — dark") {
    NavigationStack { AroundView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("AroundView — light") {
    NavigationStack { AroundView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
