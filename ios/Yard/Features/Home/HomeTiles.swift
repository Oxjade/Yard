import SwiftUI

// MARK: - Product tile with context menu

/// A product tile that pushes the product; long-press offers Save, Share and Open brand.
@MainActor
struct HomeProductTile: View {
    let product: Product

    @Environment(SavedStore.self) private var saved
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    var body: some View {
        NavigationLink(value: Route.product(slug: product.slug)) {
            ProductTile(product: product)
        }
        .buttonStyle(PressableButtonStyle())
        .contextMenu {
            Button {
                toggleSave()
            } label: {
                if saved.isSaved(product.id) {
                    Label("Remove from saved", systemImage: "heart.slash")
                } else {
                    Label("Save", systemImage: "heart")
                }
            }
            ShareLink(item: Config.webURL("/products/\(product.slug)"), subject: Text(product.title)) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            if let brand = product.brand {
                Button {
                    router.push(.brand(handle: brand.handle))
                } label: {
                    Label("Open \(brand.name)", systemImage: "storefront")
                }
            }
        }
    }

    private func toggleSave() {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        let productId = product.id
        Task { @MainActor in
            do {
                let nowSaved = try await saved.toggle(productId: productId)
                toast.show(nowSaved ? "Saved" : "Removed from saved", style: .success, systemImage: nowSaved ? "heart.fill" : "heart")
            } catch {
                toast.show(error)
            }
        }
    }
}

// MARK: - Brand tile

/// A brand as a cover photo with its name and a Follow chip; tap opens the brand.
@MainActor
struct HomeBrandTile: View {
    let brand: BrandCard

    @Environment(FollowStore.self) private var follows
    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    var body: some View {
        NavigationLink(value: Route.brand(handle: brand.handle)) {
            ZStack(alignment: .bottomLeading) {
                Color.yard.surface2
                RemoteImage(url: brand.coverURL, maxPixelSize: 700)
                LinearGradient(
                    colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.7)],
                    startPoint: .center,
                    endPoint: .bottom
                )
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    HStack(spacing: Spacing.s) {
                        BrandAvatar(name: brand.name, logoURL: brand.logoURL, size: 28, verified: brand.verified)
                        VStack(alignment: .leading, spacing: 0) {
                            Text(brand.name)
                                .font(.yardCallout.weight(.semibold))
                                .foregroundStyle(Color.yard.onPhoto)
                                .lineLimit(1)
                            if !brand.locationText.isEmpty {
                                Text(brand.locationText)
                                    .font(.yardMicro)
                                    .foregroundStyle(Color.yard.onPhoto.opacity(0.8))
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                .padding(Spacing.s)
                .padding(.trailing, 4)
            }
            .aspectRatio(1 / HomeShape.brandRatio(for: brand.id), contentMode: .fit)
            .clipShape(.yardImage)
            .overlay(alignment: .topLeading) {
                Tag("Brand", style: .onPhoto).padding(Spacing.s)
            }
        }
        .buttonStyle(PressableButtonStyle())
        .overlay(alignment: .topTrailing) {
            followChip.padding(6)
        }
        .accessibilityElement(children: .contain)
    }

    private var isFollowing: Bool { follows.isFollowing(brand.id) }

    private var followChip: some View {
        Button {
            guard session.isSignedIn else {
                router.present(.signIn)
                return
            }
            let id = brand.id
            Task { @MainActor in
                do {
                    try await follows.toggle(brandId: id)
                } catch {
                    toast.show(error)
                }
            }
        } label: {
            Text(isFollowing ? "Following" : "Follow")
                .font(.yardCaptionEmphasis)
                .foregroundStyle(isFollowing ? Color.yard.onPhoto : Color.yard.onPhotoInk)
                .padding(.horizontal, Spacing.m)
                .frame(height: 30)
                .background {
                    if isFollowing {
                        Capsule().fill(.ultraThinMaterial)
                    } else {
                        Capsule().fill(Color.yard.onPhoto)
                    }
                }
                .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle())
        .sensoryFeedback(.impact(weight: .light), trigger: isFollowing)
        .animation(Motion.snappy, value: isFollowing)
        .accessibilityLabel(Text(isFollowing ? "Unfollow \(brand.name)" : "Follow \(brand.name)"))
    }
}

// MARK: - Drop tile

/// A live or upcoming drop with a ticking countdown badge; tap opens the drop.
struct HomeDropTile: View {
    let drop: Drop

    var body: some View {
        NavigationLink(value: Route.drop(id: drop.slug.isEmpty ? drop.id : drop.slug)) {
            VStack(alignment: .leading, spacing: 6) {
                ZStack {
                    Color.yard.surface2
                    if drop.imageURL != nil {
                        RemoteImage(url: drop.imageURL, maxPixelSize: 700)
                    } else {
                        Text(drop.name)
                            .yardDisplay(28)
                            .foregroundStyle(Color.yard.ink3)
                            .multilineTextAlignment(.center)
                            .padding(Spacing.m)
                    }
                }
                .aspectRatio(1 / HomeShape.dropRatio, contentMode: .fit)
                .clipShape(.yardImage)
                .overlay(alignment: .topLeading) {
                    HStack(spacing: Spacing.xs) {
                        Tag(drop.isLive ? "Live" : "Drop", style: drop.isLive ? .acid : .onPhoto, systemImage: drop.isLive ? "dot.radiowaves.left.and.right" : "bolt.fill")
                        if drop.sponsored { Tag("Sponsored", style: .onPhoto) }
                    }
                    .padding(Spacing.s)
                }
                .overlay(alignment: .bottomLeading) {
                    HomeDropCountdown(drop: drop).padding(Spacing.s)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(drop.name)
                        .font(.yardCallout.weight(.semibold))
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    Text([drop.brand.name ?? "", drop.accessLabel].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(1)
                }
                .padding(.horizontal, 4)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
    }
}

/// "Starts in 2d 04:12:09" / "Entries open in …" / "Ends in …", ticking every second.
struct HomeDropCountdown: View {
    let drop: Drop

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            let label = HomeDropCountdown.label(for: drop, now: context.date)
            Text(label)
                .font(.yardNumber(12))
                .foregroundStyle(Color.yard.onPhoto)
                .padding(.horizontal, Spacing.s)
                .frame(height: 26)
                .background(.ultraThinMaterial, in: Capsule())
                .environment(\.colorScheme, .dark)
                .contentTransition(.numericText())
        }
        .accessibilityLabel(Text(HomeDropCountdown.label(for: drop, now: Date())))
    }

    /// Same next-moment rule as the site's upcoming-drops band: a draw that isn't open yet counts
    /// to entries opening, otherwise to the release; a live drop counts to its end.
    static func label(for drop: Drop, now: Date) -> String {
        if drop.isLive {
            guard let end = drop.endDate else { return "Live now" }
            return end > now ? "Ends in \(Formatters.countdown(end.timeIntervalSince(now)))" : "Ending"
        }
        if drop.isDraw, let opensISO = drop.entryOpensAt, let opens = YardDate.parse(opensISO), opens > now {
            return "Entries open in \(Formatters.countdown(opens.timeIntervalSince(now)))"
        }
        if drop.isDraw, let closesISO = drop.entryClosesAt, let closes = YardDate.parse(closesISO), closes > now {
            return "Entries close in \(Formatters.countdown(closes.timeIntervalSince(now)))"
        }
        guard let start = drop.startDate else { return "Coming soon" }
        return start > now ? "Starts in \(Formatters.countdown(start.timeIntervalSince(now)))" : "Live now"
    }
}

// MARK: - Founding brands row

/// "Founding brands" spotlight rail at the top of For you (GET /api/catalog/brands?founding=1).
@MainActor
struct HomeFoundingRow: View {
    let brands: [BrandCard]

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader("Founding brands", subtitle: "The first independent studios on Yard, set up with us from day one.")
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(spacing: Spacing.m) {
                    ForEach(brands) { brand in
                        NavigationLink(value: Route.brand(handle: brand.handle)) {
                            HomeFoundingCard(brand: brand)
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                }
                .scrollTargetLayout()
                .padding(.horizontal, Spacing.gutter)
            }
            .scrollTargetBehavior(.viewAligned)
        }
    }
}

struct HomeFoundingCard: View {
    let brand: BrandCard

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .bottomLeading) {
                Color.yard.surface2
                if brand.coverURL != nil {
                    RemoteImage(url: brand.coverURL, maxPixelSize: 900)
                }
                LinearGradient(colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.55)], startPoint: .center, endPoint: .bottom)
                BrandAvatar(name: brand.name, logoURL: brand.logoURL, size: 48, verified: brand.verified)
                    .padding(Spacing.m)
            }
            .frame(width: 260, height: 195)
            .clipped()
            .overlay(alignment: .topLeading) {
                if !brand.forSale {
                    Tag("Opening soon", style: .onPhoto).padding(Spacing.m)
                }
            }

            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(brand.name)
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                HStack(spacing: Spacing.s) {
                    if brand.foundingBadge {
                        Tag("Founding brand", style: .violet, systemImage: "seal.fill")
                    }
                    if !brand.locationText.isEmpty {
                        Text(brand.locationText)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink2)
                            .lineLimit(1)
                    }
                }
            }
            .padding(Spacing.m)
            .frame(width: 260, alignment: .leading)
        }
        .background(Color.yard.surface)
        .clipShape(.yardCard)
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.yard.line, lineWidth: 1))
    }
}

#Preview("Home tiles — dark") {
    HomeTilesPreview().yardPreviewEnvironment().preferredColorScheme(.dark)
}

#Preview("Home tiles — light") {
    HomeTilesPreview().yardPreviewEnvironment().preferredColorScheme(.light)
}

private struct HomeTilesPreview: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                HomeFoundingRow(brands: [PreviewFixtures.brandCard])
                HStack(alignment: .top, spacing: Spacing.gridGap) {
                    VStack(spacing: Spacing.gridGap) {
                        HomeProductTile(product: PreviewFixtures.products[0])
                        HomeBrandTile(brand: PreviewFixtures.brandCard)
                    }
                    VStack(spacing: Spacing.gridGap) {
                        HomeDropTile(drop: Drop(
                            id: "drp_preview",
                            slug: "drop-preview",
                            brand: Drop.BrandRef(id: "brd_preview", handle: "acme", name: "Acme Studio"),
                            name: "Third Mainland",
                            phase: "scheduled",
                            startsAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(90_000)),
                            endsAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(200_000))
                        ))
                        HomeProductTile(product: PreviewFixtures.products[1])
                    }
                }
                .padding(.horizontal, Spacing.gridGap)
            }
            .background(Color.yard.bg)
        }
    }
}
