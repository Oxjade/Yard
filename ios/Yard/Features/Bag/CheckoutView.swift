import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: bag agent.
// Replace this file's contents, but keep the type name and the initializer
// `CheckoutView()` exactly: App/Router.swift's RouteView calls it.

struct CheckoutView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Checkout")
    }
}

#Preview("CheckoutView — dark") {
    NavigationStack { CheckoutView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("CheckoutView — light") {
    NavigationStack { CheckoutView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
