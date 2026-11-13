import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: orders agent.
// Replace this file's contents, but keep the type name and the initializer
// `OrderConfirmationView(checkoutId: String)` exactly: App/Router.swift's RouteView calls it.

struct OrderConfirmationView: View {
    let checkoutId: String

    init(checkoutId: String) {
        self.checkoutId = checkoutId
    }

    var body: some View {
        FeaturePlaceholder("Order confirmed")
    }
}

#Preview("OrderConfirmationView — dark") {
    NavigationStack { OrderConfirmationView(checkoutId: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("OrderConfirmationView — light") {
    NavigationStack { OrderConfirmationView(checkoutId: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
