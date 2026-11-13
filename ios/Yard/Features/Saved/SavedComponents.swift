import SwiftUI

// Pieces shared by SavedView and FollowingView (saved feature only).

/// Big condensed screen header with the website's "Your World" kicker.
struct SavedScreenHeader: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Your World")
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.violet)
            Text(title)
                .yardDisplay(44)
                .foregroundStyle(Color.yard.ink)
            Text(subtitle)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, Spacing.gutter)
    }
}

/// Signed-out invite (the website's AccountGate invite copy).
struct SavedSignInInvite: View {
    let title: String
    let message: String
    let systemImage: String
    let signIn: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xl) {
                SavedScreenHeader(title: title, subtitle: message)
                    .padding(.top, Spacing.l)
                Card {
                    VStack(spacing: Spacing.m) {
                        Image(systemName: systemImage)
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(Color.yard.ink2)
                            .frame(width: 56, height: 56)
                            .overlay(Circle().strokeBorder(Color.yard.line, lineWidth: 1))
                        Text("Sign in to Yard")
                            .font(.yardTitle)
                            .foregroundStyle(Color.yard.ink)
                        YardButton("Sign in", systemImage: "person.crop.circle", action: signIn)
                    }
                    .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .padding(.bottom, Spacing.xxl)
        }
        .scrollBounceBehavior(.basedOnSize)
    }
}

/// Bottom sheet to pick a size/variant before moving a saved piece to the bag.
@MainActor
struct SavedVariantSheet: View {
    let product: Product
    let onConfirm: (ProductVariant) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedId: String? = nil

    init(product: Product, onConfirm: @escaping (ProductVariant) -> Void) {
        self.product = product
        self.onConfirm = onConfirm
    }

    private var selected: ProductVariant? {
        guard let selectedId else { return nil }
        return product.variants.first { $0.id == selectedId }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            YardSheetHeader("Choose a size", subtitle: product.title) { dismiss() }
            ScrollView {
                FlowChips(variants: product.variants, selectedId: selectedId) { variant in
                    withAnimation(Motion.snappy) { selectedId = variant.id }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            VStack(spacing: Spacing.s) {
                if let selected {
                    PriceText(minor: selected.priceMinor, currency: product.currency, compareAtMinor: nil, font: .yardBodyEmphasis, color: Color.yard.ink)
                }
                YardButton(selected == nil ? "Pick a size" : "Move to bag", systemImage: "bag", style: .primary) {
                    guard let selected else { return }
                    dismiss()
                    onConfirm(selected)
                }
                .disabled(selected == nil)
                .opacity(selected == nil ? 0.6 : 1)
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.bottom, Spacing.l)
        }
        .yardSheet(detents: [.medium])
        .onAppear {
            let inStock = product.variants.filter { $0.inStock && $0.available > 0 }
            if inStock.count == 1 { selectedId = inStock[0].id }
        }
    }
}

/// Variant chips laid out in rows of up to three.
private struct FlowChips: View {
    let variants: [ProductVariant]
    let selectedId: String?
    let onSelect: (ProductVariant) -> Void

    var body: some View {
        let columns: [GridItem] = [GridItem(.adaptive(minimum: 96), spacing: Spacing.s)]
        LazyVGrid(columns: columns, alignment: .leading, spacing: Spacing.s) {
            ForEach(variants) { variant in
                let available = variant.inStock && variant.available > 0
                Chip(variant.label.isEmpty ? variant.sku : variant.label,
                     isSelected: selectedId == variant.id,
                     isEnabled: available) {
                    if available { onSelect(variant) }
                }
            }
        }
    }
}

/// A drop card for the Following feed rail.
@MainActor
struct FollowingDropCard: View {
    let drop: Drop
    let brandName: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            ZStack(alignment: .topLeading) {
                RemoteImage(url: drop.imageURL, maxPixelSize: 700) {
                    ZStack {
                        Color.yard.surface2
                        Image(systemName: "flame")
                            .font(.system(size: 28, weight: .semibold))
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                .frame(width: 220, height: 150)
                .clipShape(.yardImage)
                Tag(statusText, style: drop.isLive ? .acid : .onPhoto, systemImage: drop.isLive ? "dot.radiowaves.left.and.right" : "clock")
                    .padding(Spacing.s)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(drop.name)
                    .font(.yardCallout.weight(.semibold))
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                Text("\(brandName) · \(drop.accessLabel)")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink2)
                    .lineLimit(1)
            }
            .padding(.horizontal, 4)
        }
        .frame(width: 220, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private var statusText: String {
        if drop.isLive { return "Live now" }
        if let start = drop.startDate { return "Starts \(Formatters.future(start))" }
        return "Upcoming"
    }
}

/// Loading placeholder for the brand avatar row.
struct FollowingAvatarSkeleton: View {
    var body: some View {
        HStack(spacing: Spacing.l) {
            ForEach(0..<5, id: \.self) { _ in
                VStack(spacing: Spacing.s) {
                    Skeleton(shape: .circle).frame(width: 64, height: 64)
                    Skeleton(cornerRadius: 6).frame(width: 56, height: 10)
                }
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
