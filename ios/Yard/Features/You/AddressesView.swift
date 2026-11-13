import SwiftUI

// PLACEHOLDER created by the foundation agent. Owner: you agent.
// Replace this file's contents, but keep the type name and the initializer
// `AddressesView()` exactly: App/Router.swift's RouteView calls it.

struct AddressesView: View {
    init() {}

    var body: some View {
        FeaturePlaceholder("Addresses")
    }
}

#Preview("AddressesView — dark") {
    NavigationStack { AddressesView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("AddressesView — light") {
    NavigationStack { AddressesView() }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
