import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: shop agent.
// Replace this file's contents, but keep the type name and the initializer
// `CollectionView(brand: String, handle: String)` exactly: App/Router.swift's RouteView calls it.

struct CollectionView: View {
    let brand: String
    let handle: String

    init(brand: String, handle: String) {
        self.brand = brand
        self.handle = handle
    }

    var body: some View {
        FeaturePlaceholder("Collection")
    }
}

#Preview("CollectionView — dark") {
    NavigationStack { CollectionView(brand: "preview", handle: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("CollectionView — light") {
    NavigationStack { CollectionView(brand: "preview", handle: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
