import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: you agent.
// Replace this file's contents, but keep the type name and the initializer
// `LegalView(page: LegalPage)` exactly: App/Router.swift's RouteView calls it.

struct LegalView: View {
    let page: LegalPage

    init(page: LegalPage) {
        self.page = page
    }

    var body: some View {
        FeaturePlaceholder("Legal")
    }
}

#Preview("LegalView — dark") {
    NavigationStack { LegalView(page: .terms) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("LegalView — light") {
    NavigationStack { LegalView(page: .terms) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
