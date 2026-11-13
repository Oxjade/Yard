import SwiftUI

/// A product tile for masonry grids: image (natural aspect, 16pt corners), title, brand, price,
/// a "Sold out"/"New" tag and an optional save heart (Saved store; signed-out taps open Sign in).
///
/// The tile does not navigate by itself; wrap it:
///   NavigationLink(value: Route.product(slug: product.slug)) { ProductTile(product: product) }
///       .buttonStyle(PressableButtonStyle())
///
/// Needs `SavedStore`, `SessionStore`, `Router` and `ToastCenter` in the environment (the root
/// injects them; previews use `.yardPreviewEnvironment()`).
@MainActor
struct ProductTile: View {
    let product: Product
    var showsBrand: Bool = true
    var showsPrice: Bool = true
    var showsSaveButton: Bool = true
    /// Decoded image size cap (pixels).
    var maxPixelSize: CGFloat = 700

    /// Caption height used by `MasonryGrid` for balancing.
    nonisolated static let captionHeight: CGFloat = 56

    /// Tile aspects are kept between 9:16 and 5:4 so no tile is absurdly tall or flat.
    nonisolated static func clampedAspect(_ ratio: Double) -> CGFloat {
        CGFloat(min(max(ratio, 0.5625), 1.25))
    }

    @Environment(SavedStore.self) private var saved
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    init(product: Product, showsBrand: Bool = true, showsPrice: Bool = true, showsSaveButton: Bool = true, maxPixelSize: CGFloat = 700) {
        self.product = product
        self.showsBrand = showsBrand
        self.showsPrice = showsPrice
        self.showsSaveButton = showsSaveButton
        self.maxPixelSize = maxPixelSize
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            RemoteImage(url: product.coverURL, maxPixelSize: maxPixelSize)
                .aspectRatio(ProductTile.clampedAspect(product.tileAspectRatio), contentMode: .fit)
                .clipShape(.yardImage)
                .overlay(alignment: .topLeading) { badge.padding(Spacing.s) }
                .overlay(alignment: .topTrailing) {
                    if showsSaveButton { saveButton.padding(6) }
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(product.title)
                    .font(.yardCallout.weight(.semibold))
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                if showsBrand, let brand = product.brand {
                    Text(brand.name)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
                if showsPrice {
                    PriceText(product: product, font: .yardCaptionEmphasis)
                }
            }
            .padding(.horizontal, 4)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var badge: some View {
        if product.isNotForSale {
            Tag("Opening soon", style: .onPhoto)
        } else if product.isSoldOut {
            Tag("Sold out", style: .onPhoto)
        } else if product.compareAt != nil {
            Tag("Sale", style: .acid)
        } else if product.isNew {
            Tag("New", style: .acid)
        }
    }

    private var isSaved: Bool { saved.isSaved(product.id) }

    private var saveButton: some View {
        Button {
            guard session.isSignedIn else {
                router.present(.signIn)
                return
            }
            let productId = product.id
            Task { @MainActor in
                do {
                    try await saved.toggle(productId: productId)
                } catch {
                    toast.show(error)
                }
            }
        } label: {
            Image(systemName: isSaved ? "heart.fill" : "heart")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isSaved ? Color.yard.danger : Color.yard.ink)
                .frame(width: 30, height: 30)
                .background(.ultraThinMaterial, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressableButtonStyle())
        .sensoryFeedback(.impact(weight: .light), trigger: isSaved)
        .accessibilityLabel(Text(isSaved ? "Remove from saved" : "Save"))
    }
}

#Preview("ProductTile — dark") {
    ProductTilePreview()
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ProductTile — light") {
    ProductTilePreview()
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

private struct ProductTilePreview: View {
    var body: some View {
        ScrollView {
            MasonryGrid(PreviewFixtures.products) { product in
                ProductTile(product: product)
            }
            .padding(.horizontal, Spacing.gridGap)
        }
        .background(Color.yard.bg)
    }
}
