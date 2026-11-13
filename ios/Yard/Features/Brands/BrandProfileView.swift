import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: brands agent.
// Replace this file's contents, but keep the type name and the initializer
// `BrandProfileView(handle: String)` exactly: App/Router.swift's RouteView calls it.

struct BrandProfileView: View {
    let handle: String

    init(handle: String) {
        self.handle = handle
    }

    var body: some View {
        FeaturePlaceholder("Brand")
    }
}

#Preview("BrandProfileView — dark") {
    NavigationStack { BrandProfileView(handle: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BrandProfileView — light") {
    NavigationStack { BrandProfileView(handle: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
