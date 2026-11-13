import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: saved agent.
// Replace this file's contents, but keep the type name and the initializer
// `FollowingView()` exactly: App/Router.swift's RouteView calls it.

struct FollowingView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Following")
    }
}

#Preview("FollowingView — dark") {
    NavigationStack { FollowingView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("FollowingView — light") {
    NavigationStack { FollowingView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
