import SwiftUI

// Preview helpers. Fixtures here are for #Preview ONLY — never show them in the app.

extension View {
    /// Injects fresh stores, a router and a toast center so any view previews without the root.
    ///
    ///   #Preview("Bag — dark") { BagView().yardPreviewEnvironment().preferredColorScheme(.dark) }
    @MainActor
    func yardPreviewEnvironment(signedIn: Bool = true) -> some View {
        let toast = ToastCenter()
        return self
            .environment(SessionStore.preview(signedIn: signedIn))
            .environment(CartStore.preview())
            .environment(FollowStore.preview())
            .environment(SavedStore.preview())
            .environment(Router())
            .environment(toast)
            .yardToastHost(toast)
            .tint(Color.yard.ink)
    }
}

/// Small inline fixture values for previews.
enum PreviewFixtures {
    static let brand = BrandSummary(id: "brd_preview", handle: "acme", name: "Acme Studio", verified: true, city: "Lagos", country: "NG", currency: "USD", foundingBadge: true)

    static let products: [Product] = (0..<10).map { (i: Int) -> Product in
        let ratios: [(Int, Int)] = [(800, 1000), (900, 1200), (1000, 1000), (800, 1300), (1200, 1000)]
        let r = ratios[i % ratios.count]
        return Product(
            id: "prd_\(i)",
            slug: "piece-\(i)",
            brandId: PreviewFixtures.brand.id,
            title: ["Boxy tee", "Cargo pant", "Washed hoodie", "Track jacket", "Bucket hat"][i % 5],
            priceMinor: [4500, 12000, 8900, 15000, 3500][i % 5],
            compareAtMinor: i == 2 ? 11000 : nil,
            currency: "USD",
            images: [ProductImage(id: "img_\(i)", src: "/media/missing.svg", alt: "", width: r.0, height: r.1)],
            variants: [ProductVariant(id: "var_\(i)", label: "Size M", priceMinor: 4500, available: i == 3 ? 0 : 5, inStock: i != 3)],
            available: i == 3 ? 0 : 5,
            brand: PreviewFixtures.brand
        )
    }

    static let brandCard = BrandCard(id: "brd_preview", handle: "acme", name: "Acme Studio", city: "Lagos", country: "NG", categories: ["tops"], story: "Heavyweight basics cut in Lagos.", verified: true, founding: true, foundingBadge: true)

    static let shopper = Shopper(id: "usr_preview", name: "Ada Obi", email: "ada@example.com")
}
