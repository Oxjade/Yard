import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: charts agent.
// Replace this file's contents, but keep the type name and the initializer
// `ChartsView()` exactly: App/Router.swift's RouteView calls it.

struct ChartsView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Charts")
    }
}

#Preview("ChartsView — dark") {
    NavigationStack { ChartsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ChartsView — light") {
    NavigationStack { ChartsView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
