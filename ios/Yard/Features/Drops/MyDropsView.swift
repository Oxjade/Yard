import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: drops agent.
// Replace this file's contents, but keep the type name and the initializer
// `MyDropsView()` exactly: App/Router.swift's RouteView calls it.

struct MyDropsView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("My drops")
    }
}

#Preview("MyDropsView — dark") {
    NavigationStack { MyDropsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("MyDropsView — light") {
    NavigationStack { MyDropsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
