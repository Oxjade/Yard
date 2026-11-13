import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: bag agent.
// Replace this file's contents, but keep the type name and the initializer
// `BagView()` exactly: App/Router.swift's RouteView calls it.

struct BagView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Bag")
    }
}

#Preview("BagView — dark") {
    NavigationStack { BagView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BagView — light") {
    NavigationStack { BagView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
