import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: drops agent.
// Replace this file's contents, but keep the type name and the initializer
// `DropDetailView(id: String)` exactly: App/Router.swift's RouteView calls it.

struct DropDetailView: View {
    let id: String

    init(id: String) {
        self.id = id
    }

    var body: some View {
        FeaturePlaceholder("Drop")
    }
}

#Preview("DropDetailView — dark") {
    NavigationStack { DropDetailView(id: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("DropDetailView — light") {
    NavigationStack { DropDetailView(id: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
