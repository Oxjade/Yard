import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: shop agent.
// Replace this file's contents, but keep the type name and the initializer
// `CategoriesView()` exactly: App/Router.swift's RouteView calls it.

struct CategoriesView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Categories")
    }
}

#Preview("CategoriesView — dark") {
    NavigationStack { CategoriesView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("CategoriesView — light") {
    NavigationStack { CategoriesView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
