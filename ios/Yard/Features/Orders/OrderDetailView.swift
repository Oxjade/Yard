import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: orders agent.
// Replace this file's contents, but keep the type name and the initializer
// `OrderDetailView(id: String)` exactly: App/Router.swift's RouteView calls it.

struct OrderDetailView: View {
    let id: String

    init(id: String) {
        self.id = id
    }

    var body: some View {
        FeaturePlaceholder("Order")
    }
}

#Preview("OrderDetailView — dark") {
    NavigationStack { OrderDetailView(id: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("OrderDetailView — light") {
    NavigationStack { OrderDetailView(id: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
