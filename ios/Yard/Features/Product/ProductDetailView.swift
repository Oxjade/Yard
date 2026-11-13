import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: product agent.
// Replace this file's contents, but keep the type name and the initializer
// `ProductDetailView(slug: String)` exactly: App/Router.swift's RouteView calls it.

struct ProductDetailView: View {
    let slug: String

    init(slug: String) {
        self.slug = slug
    }

    var body: some View {
        FeaturePlaceholder("Product")
    }
}

#Preview("ProductDetailView — dark") {
    NavigationStack { ProductDetailView(slug: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ProductDetailView — light") {
    NavigationStack { ProductDetailView(slug: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
