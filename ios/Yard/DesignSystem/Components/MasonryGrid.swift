import SwiftUI

/// A two-column, height-balanced masonry (Home, brand grids, saved, shop).
///
/// Each item goes to whichever column is currently shorter, using its estimated height
/// (`heightRatio` × column width + `extraHeight` for a caption). Each column is a `LazyVStack`,
/// so put the grid inside a `ScrollView`; ~200 items stay smooth.
///
///   ScrollView {
///       MasonryGrid(products) { product in
///           NavigationLink(value: Route.product(slug: product.slug)) { ProductTile(product: product) }
///               .buttonStyle(PressableButtonStyle())
///               .onAppear { if product.id == products.last?.id { Task { await loadMore() } } }
///       }
///   }
///
/// Generic form for any `Identifiable` item:
///   MasonryGrid(posts, extraHeight: 0, heightRatio: { $0.height / $0.width }) { PostTile(post: $0) }
///
/// Edge to edge by default (Pinterest look): add `.padding(.horizontal, Spacing.gridGap)` for a
/// small outer gutter.
struct MasonryGrid<Item: Identifiable, Content: View>: View {
    let items: [Item]
    var spacing: CGFloat
    var extraHeight: CGFloat
    let heightRatio: (Item) -> CGFloat
    let content: (Item) -> Content

    /// - Parameters:
    ///   - spacing: gap between columns and between tiles (default 6pt).
    ///   - extraHeight: fixed height per tile beyond the image (caption), in points, for balancing.
    ///   - heightRatio: tile image height ÷ width for an item (e.g. 1.25 for a 4:5 photo).
    init(_ items: [Item], spacing: CGFloat = Spacing.gridGap, extraHeight: CGFloat = 0, heightRatio: @escaping (Item) -> CGFloat, @ViewBuilder content: @escaping (Item) -> Content) {
        self.items = items
        self.spacing = spacing
        self.extraHeight = extraHeight
        self.heightRatio = heightRatio
        self.content = content
    }

    var body: some View {
        let columns = distribute()
        HStack(alignment: .top, spacing: spacing) {
            column(columns.left)
            column(columns.right)
        }
    }

    private func column(_ items: [Item]) -> some View {
        LazyVStack(spacing: spacing) {
            ForEach(items) { item in
                content(item)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    /// Greedy shortest-column placement, in order, so new pages append without reshuffling.
    private func distribute() -> (left: [Item], right: [Item]) {
        let nominalWidth: CGFloat = 180
        var left: [Item] = []
        var right: [Item] = []
        left.reserveCapacity(items.count / 2 + 1)
        right.reserveCapacity(items.count / 2 + 1)
        var leftHeight: CGFloat = 0
        var rightHeight: CGFloat = 0
        for item in items {
            let ratio = heightRatio(item)
            let safeRatio: CGFloat = ratio.isFinite && ratio > 0 ? ratio : 1
            let h = nominalWidth * safeRatio + extraHeight + spacing
            if leftHeight <= rightHeight {
                left.append(item)
                leftHeight += h
            } else {
                right.append(item)
                rightHeight += h
            }
        }
        return (left, right)
    }
}

extension MasonryGrid where Item == Product {
    /// Products with `ProductTile`-sized captions; heights from each product's cover image.
    init(_ products: [Product], spacing: CGFloat = Spacing.gridGap, extraHeight: CGFloat = ProductTile.captionHeight, @ViewBuilder content: @escaping (Product) -> Content) {
        self.init(products, spacing: spacing, extraHeight: extraHeight, heightRatio: { 1 / ProductTile.clampedAspect($0.tileAspectRatio) }, content: content)
    }
}

#Preview("Masonry — dark") {
    MasonryPreview().preferredColorScheme(.dark)
}

#Preview("Masonry — light") {
    MasonryPreview().preferredColorScheme(.light)
}

private struct MasonryPreview: View {
    struct Block: Identifiable {
        let id: Int
        let ratio: CGFloat
    }

    let blocks: [Block] = (0..<24).map { Block(id: $0, ratio: [1.3, 0.9, 1.6, 1.1, 1.45][$0 % 5]) }

    var body: some View {
        ScrollView {
            MasonryGrid(blocks, heightRatio: { $0.ratio }) { block in
                RoundedRectangle(cornerRadius: Radius.image, style: .continuous)
                    .fill(block.id % 3 == 0 ? Color.yard.acid : Color.yard.surface2)
                    .aspectRatio(1 / block.ratio, contentMode: .fit)
                    .overlay(Text("\(block.id)").font(.yardDisplay(28)).foregroundStyle(Color.yard.ink3))
            }
            .padding(.horizontal, Spacing.gridGap)
        }
        .background(Color.yard.bg)
    }
}
