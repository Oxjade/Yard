import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: inbox agent.
// Replace this file's contents, but keep the type name and the initializer
// `BrandConversationView(brandId: String)` exactly: App/Router.swift's RouteView calls it.

struct BrandConversationView: View {
    let brandId: String

    init(brandId: String) {
        self.brandId = brandId
    }

    var body: some View {
        FeaturePlaceholder("Message")
    }
}

#Preview("BrandConversationView — dark") {
    NavigationStack { BrandConversationView(brandId: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BrandConversationView — light") {
    NavigationStack { BrandConversationView(brandId: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
