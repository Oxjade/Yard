import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: search agent.
// Replace this file's contents, but keep the type name and the initializer
// `SearchView(query: String)` exactly: App/Router.swift's RouteView calls it.

struct SearchView: View {
    let query: String

    init(query: String) {
        self.query = query
    }

    var body: some View {
        FeaturePlaceholder("Search")
    }
}

#Preview("SearchView — dark") {
    NavigationStack { SearchView(query: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("SearchView — light") {
    NavigationStack { SearchView(query: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
