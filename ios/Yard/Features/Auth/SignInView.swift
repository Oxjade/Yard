import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: auth agent.
// Replace this file's contents, but keep the type name and the initializer
// `SignInView()` exactly: App/Router.swift's RouteView calls it.

struct SignInView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Sign in")
    }
}

#Preview("SignInView — dark") {
    NavigationStack { SignInView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("SignInView — light") {
    NavigationStack { SignInView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
