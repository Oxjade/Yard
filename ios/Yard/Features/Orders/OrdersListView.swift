import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: orders agent.
// Replace this file's contents, but keep the type name and the initializer
// `OrdersListView()` exactly: App/Router.swift's RouteView calls it.

struct OrdersListView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Orders")
    }
}

#Preview("OrdersListView — dark") {
    NavigationStack { OrdersListView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("OrdersListView — light") {
    NavigationStack { OrdersListView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
