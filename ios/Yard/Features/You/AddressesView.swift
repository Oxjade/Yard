import SwiftUI

/// You › Addresses. Yard has no saved-address API yet (the delivery address is entered at checkout,
/// per order), so this screen is honest about it and keeps the one location setting that does
/// exist: the ship-to country, which sets delivery times, shipping costs and the currency.
@MainActor
struct AddressesView: View {
    @Environment(CartStore.self) private var cart
    @Environment(Router.self) private var router

    @State private var regionSheet: YouRegionSheet.Mode? = nil
    @State private var shipTo: String? = YouRegion.storedShipTo

    init() {}

    private var bagAction: (() -> Void)? {
        if cart.isEmpty { return nil }
        let router = self.router
        return { router.select(.bag) }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                EmptyState(
                    title: "No saved addresses",
                    message: "You enter where each order goes at checkout. Yard doesn't keep an address book yet.",
                    systemImage: "mappin.and.ellipse",
                    actionTitle: cart.isEmpty ? nil : "Go to your bag",
                    action: bagAction
                )
                .frame(minHeight: 260)

                YouSettingsGroup("Delivery", footer: "Where you ship to sets delivery times and shipping costs. Checkout confirms both.") {
                    Button { regionSheet = .country } label: {
                        SettingsRow("Ship to", systemImage: "shippingbox", value: YouMarkets.country(shipTo)?.name ?? "Not set")
                    }
                    .buttonStyle(.plain)
                    Button { regionSheet = .currency } label: {
                        SettingsRow("Currency", systemImage: "dollarsign.circle", value: YouMarkets.currency(cart.currency)?.label ?? cart.currency)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.xxl)
        }
        .yardScreenBackground()
        .navigationTitle("Addresses")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { YouRegion.restore(into: cart) }
        .sheet(item: $regionSheet) { mode in
            YouRegionSheet(mode: mode) { shipTo = YouRegion.storedShipTo }
        }
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
