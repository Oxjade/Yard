import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: shop agent.
// Replace this file's contents, but keep the type name and the initializer
// `ShopView(category: String?)` exactly: App/Router.swift's RouteView calls it.

struct ShopView: View {
    let category: String?

    init(category: String?) {
        self.category = category
    }

    var body: some View {
        FeaturePlaceholder("Shop")
    }
}

#Preview("ShopView — dark") {
    NavigationStack { ShopView(category: nil) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ShopView — light") {
    NavigationStack { ShopView(category: nil) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
