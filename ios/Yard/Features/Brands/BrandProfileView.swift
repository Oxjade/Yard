import SwiftUI
import UIKit

// A brand's profile (reference 02-brand-profile.jpg; website /brands/{handle}).
//
// Full-bleed hero from the storefront cover (else the first product photo) that stretches on
// pull-down and fades into a blurred copy of itself; huge name, @handle, founding badge and
// place; a wide white Follow pill, a round Message button and a "…" menu (Share, Report); real
// stats only (followers from /api/follows/counts, products from ProductsPage.total, drops when
// the drops list is complete); the story card; then Products / Collections / Drops.
// Data: BrandProfileModel.

@MainActor
struct BrandProfileView: View {
    let handle: String

    @Environment(SessionStore.self) private var session
    @Environment(FollowStore.self) private var follows
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var model: BrandProfileModel
    @State private var tab: BrandProfileTab = .products
    @State private var followBusy = false
    @State private var followTick = 0

    private let heroHeight: CGFloat = 470
    private let scrollSpace = "brandProfileScroll"

    init(handle: String) {
        self.handle = handle
        self._model = State(initialValue: BrandProfileModel(handle: handle))
    }

    /// Previews only.
    init(previewModel: BrandProfileModel) {
        self.handle = previewModel.handle
        self._model = State(initialValue: previewModel)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.yard.bg.ignoresSafeArea()
            content
            topBar
        }
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if model.storefront == nil { await model.load(follows: follows) }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            loadingView
        case .notFound(let message):
            EmptyState(
                title: "Brand not found",
                message: message.isEmpty ? "That brand isn't on Yard." : message,
                systemImage: "storefront",
                actionTitle: "Browse brands"
            ) {
                router.push(.brandsDirectory)
            }
            .padding(.top, 60)
        case .failed(let message):
            EmptyState.error(message: message) {
                await model.load(follows: follows)
            }
            .padding(.top, 60)
        case .loaded:
            if let brand = model.brand {
                loaded(brand)
            } else {
                loadingView
            }
        }
    }

    // MARK: - Top bar (× and …)

    private var topBar: some View {
        HStack {
            GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close") {
                dismiss()
            }
            Spacer()
            if let brand = model.brand {
                Menu {
                    ShareLink(
                        item: Config.webURL("/brands/\(brand.handle)"),
                        subject: Text(brand.name),
                        message: Text("\(brand.name) on Yard")
                    ) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        UIPasteboard.general.url = Config.webURL("/brands/\(brand.handle)")
                        toast.show("Link copied", style: .success, systemImage: "link")
                    } label: {
                        Label("Copy link", systemImage: "link")
                    }
                    Divider()
                    Button(role: .destructive) {
                        // POST /api/reports only accepts messages, conversations, posts and places
                        // (no brand subject), so brand reports go to Yard support.
                        openURL(Config.webURL("/support"))
                    } label: {
                        Label("Report brand", systemImage: "flag")
                    }
                } label: {
                    BrandsGlassCircle(systemImage: "ellipsis")
                }
                .accessibilityLabel("More")
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.xs)
    }

    // MARK: - Loaded

    private func loaded(_ brand: StorefrontBrand) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                identity(brand)
                    .padding(.top, heroHeight - 150)
                    .padding(.bottom, 64)
                    .frame(maxWidth: .infinity)
                    .background(alignment: .top) {
                        BrandHeroBackdrop(url: model.heroURL, heroHeight: heroHeight, scrollSpace: scrollSpace)
                    }

                sections(brand)
                    .padding(.bottom, Spacing.xxxl)
            }
        }
        .coordinateSpace(name: scrollSpace)
        .ignoresSafeArea(edges: .top)
        .refreshable { await model.load(follows: follows) }
    }

    // MARK: Identity block (on the photo)

    private func identity(_ brand: StorefrontBrand) -> some View {
        VStack(spacing: Spacing.m) {
            VStack(spacing: Spacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(brand.name)
                        .yardDisplay(58)
                        .foregroundStyle(Color.yard.onPhoto)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .minimumScaleFactor(0.5)
                    if brand.verified {
                        Image(systemName: "checkmark.seal.fill")
                            .font(.system(size: 22, weight: .semibold))
                            .foregroundStyle(Color.yard.onPhoto)
                            .accessibilityLabel("Verified brand")
                    }
                }
                .shadow(color: Color.yard.scrim.opacity(0.35), radius: 12, y: 2)

                Text("@\(brand.handle)")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.onPhoto.opacity(0.72))

                metaLine(brand)
                    .padding(.top, Spacing.xxs)
            }
            .padding(.horizontal, Spacing.gutter)

            actions(brand)
                .padding(.horizontal, Spacing.gutter)

            stats
                .padding(.horizontal, Spacing.gutter)

            if !brand.forSale {
                openingSoon(brand)
                    .padding(.horizontal, Spacing.gutter)
            }

            if let story = model.story {
                storyCard(story)
                    .padding(.horizontal, Spacing.gutter)
            }
        }
    }

    @ViewBuilder
    private func metaLine(_ brand: StorefrontBrand) -> some View {
        let place = BrandsPlace.text(city: brand.city, country: brand.country)
        let category = BrandsCategory.firstName(in: brand.categories)
        HStack(spacing: Spacing.s) {
            if brand.foundingBadge {
                BrandsFoundingBadge(onPhoto: true)
            }
            if !place.isEmpty {
                Label(place, systemImage: "mappin.and.ellipse")
                    .labelStyle(BrandsCompactLabelStyle())
            }
            if let category {
                Label(category, systemImage: "tag")
                    .labelStyle(BrandsCompactLabelStyle())
            }
        }
        .font(.yardCaption)
        .foregroundStyle(Color.yard.onPhoto.opacity(0.8))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }

    private func actions(_ brand: StorefrontBrand) -> some View {
        let following = follows.isFollowing(brand.id)
        return HStack(spacing: Spacing.m) {
            Button {
                toggleFollow(brand)
            } label: {
                HStack(spacing: Spacing.s) {
                    if followBusy {
                        ProgressView().tint(Color.yard.onPhotoInk)
                    } else if following {
                        Image(systemName: "checkmark")
                            .font(.system(size: 15, weight: .bold))
                    }
                    Text(following ? "Following" : "Follow")
                        .font(.yardBodyEmphasis)
                }
                .foregroundStyle(following ? Color.yard.onPhoto : Color.yard.onPhotoInk)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(
                    Capsule().fill(following ? Color.yard.onPhoto.opacity(0.16) : Color.yard.onPhoto)
                )
                .overlay(
                    Capsule().strokeBorder(Color.yard.onPhoto.opacity(following ? 0.4 : 0), lineWidth: 1)
                )
                .contentShape(Capsule())
            }
            .buttonStyle(PressableButtonStyle())
            .disabled(followBusy)
            .sensoryFeedback(.success, trigger: followTick)
            .accessibilityLabel(following ? "Following \(brand.name). Double-tap to unfollow." : "Follow \(brand.name)")
            .animation(Motion.spring, value: following)

            Button {
                guard session.isSignedIn else {
                    router.present(.signIn)
                    return
                }
                router.push(.messageBrand(brandId: brand.id))
            } label: {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(Color.yard.onPhoto)
                    .frame(width: 54, height: 54)
                    .background(Circle().fill(Color.yard.onPhoto.opacity(0.12)))
                    .overlay(Circle().strokeBorder(Color.yard.onPhoto.opacity(0.35), lineWidth: 1))
                    .contentShape(Circle())
            }
            .buttonStyle(PressableButtonStyle())
            .accessibilityLabel("Message \(brand.name)")
        }
    }

    private func toggleFollow(_ brand: StorefrontBrand) {
        guard !followBusy else { return }
        followBusy = true
        Task { @MainActor in
            let result = await BrandsFollow.toggle(brandId: brand.id, brandName: brand.name, session: session, follows: follows, router: router, toast: toast)
            if let result {
                model.apply(result)
                followTick += 1
            }
            followBusy = false
        }
    }

    // MARK: Stats (real numbers only)

    private struct Stat: Identifiable {
        let id: String
        let value: Int
        let label: String
    }

    private var statItems: [Stat] {
        var items: [Stat] = []
        if let followers = model.followers {
            items.append(Stat(id: "followers", value: followers, label: followers == 1 ? "Follower" : "Followers"))
        }
        if let total = model.productsTotal {
            items.append(Stat(id: "products", value: total, label: total == 1 ? "Product" : "Products"))
        }
        if let drops = model.dropsCount, drops > 0 {
            items.append(Stat(id: "drops", value: drops, label: drops == 1 ? "Drop" : "Drops"))
        }
        return items
    }

    @ViewBuilder
    private var stats: some View {
        let items = statItems
        if !items.isEmpty {
            HStack(spacing: 0) {
                ForEach(items) { item in
                    VStack(spacing: 2) {
                        Text(Formatters.count(item.value))
                            .font(.yardNumber(28))
                            .foregroundStyle(Color.yard.onPhoto)
                            .contentTransition(.numericText())
                        Text(item.label)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.onPhoto.opacity(0.68))
                    }
                    .frame(maxWidth: .infinity)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(item.label), \(Formatters.grouped(item.value))")
                }
            }
            .padding(.vertical, Spacing.xs)
            .animation(Motion.spring, value: model.followers)
        }
    }

    // MARK: Opening soon

    private func openingSoon(_ brand: StorefrontBrand) -> some View {
        let following = follows.isFollowing(brand.id)
        return HStack(alignment: .center, spacing: Spacing.m) {
            Image(systemName: "bell.badge")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Color.yard.onAcid)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Color.yard.acid))
            VStack(alignment: .leading, spacing: 2) {
                Text("Opening soon on Yard")
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.onPhoto)
                Text(following ? "You'll hear the day they open." : "Pieces aren't for sale yet. Get notified the day they open.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.onPhoto.opacity(0.72))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if !following {
                Button {
                    toggleFollow(brand)
                } label: {
                    Text("Notify me")
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.onAcid)
                        .padding(.horizontal, Spacing.m)
                        .frame(height: 34)
                        .background(Capsule().fill(Color.yard.acid))
                }
                .buttonStyle(PressableButtonStyle())
                .disabled(followBusy)
            }
        }
        .padding(Spacing.m)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Color.yard.onPhoto.opacity(0.1)))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.yard.onPhoto.opacity(0.18), lineWidth: 1))
    }

    // MARK: Story card

    private func storyCard(_ story: String) -> some View {
        BrandStoryCard(text: story)
    }

    // MARK: - Sections

    private func sections(_ brand: StorefrontBrand) -> some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            if let announcement = model.storefront?.storefront?.config.announcement, !announcement.text.isEmpty {
                announcementRow(announcement)
                    .padding(.horizontal, Spacing.gutter)
            }

            SegmentedPill(selection: $tab, options: BrandProfileTab.allCases) { $0.title }
                .padding(.horizontal, Spacing.gutter)

            switch tab {
            case .products:
                productsSection(brand)
            case .collections:
                collectionsSection(brand)
            case .drops:
                dropsSection(brand)
            }
        }
        .padding(.top, Spacing.xs)
    }

    private func announcementRow(_ announcement: StorefrontConfig.Announcement) -> some View {
        // An empty href is no link: no chevron, not tappable.
        let hasLink: Bool = !(announcement.href ?? "").trimmingCharacters(in: .whitespaces).isEmpty
        return Button {
            guard hasLink, let href = announcement.href else { return }
            if let route = Route(path: href) {
                router.push(route)
            } else if let url = Config.url(for: href) {
                openURL(url)
            }
        } label: {
            HStack(spacing: Spacing.s) {
                Image(systemName: "megaphone.fill")
                    .foregroundStyle(Color.yard.violet)
                Text(announcement.text)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if hasLink {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.yard.ink3)
                }
            }
            .padding(Spacing.m)
            .yardCard(background: Color.yard.surface)
        }
        .buttonStyle(PressableButtonStyle())
        .disabled(!hasLink)
    }

    // MARK: Products

    @ViewBuilder
    private func productsSection(_ brand: StorefrontBrand) -> some View {
        if model.productsLoading && model.products.isEmpty {
            MasonrySkeleton(count: 6)
                .padding(.horizontal, Spacing.gridGap)
        } else if let error = model.productsError, model.products.isEmpty {
            EmptyState.error(message: error) {
                await model.loadProducts(brandId: brand.id)
            }
            .frame(minHeight: 240)
        } else if model.products.isEmpty {
            EmptyState(
                title: brand.forSale ? "No pieces yet" : "Opening soon",
                message: brand.forSale ? "\(brand.name) hasn't listed anything yet. Follow to hear when they do." : "\(brand.name) is setting up. Follow to hear the day they open.",
                systemImage: "hanger"
            )
            .frame(minHeight: 240)
        } else {
            MasonryGrid(model.products) { product in
                NavigationLink(value: Route.product(slug: product.slug)) {
                    ProductTile(product: product, showsBrand: false)
                }
                .buttonStyle(PressableButtonStyle())
                .onAppear {
                    if product.id == model.products.last?.id {
                        Task { @MainActor in await model.loadMoreProducts() }
                    }
                }
            }
            .padding(.horizontal, Spacing.gridGap)

            if model.productsLoadingMore {
                ProgressView()
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, Spacing.l)
            } else if model.productsLoadMoreFailed {
                YardButton("Load more", style: .secondary, size: .medium, fullWidth: false) {
                    Task { @MainActor in await model.loadMoreProducts() }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, Spacing.l)
            }
        }
    }

    // MARK: Collections

    @ViewBuilder
    private func collectionsSection(_ brand: StorefrontBrand) -> some View {
        if model.collections.isEmpty {
            EmptyState(
                title: "No collections yet",
                message: "\(brand.name) hasn't published a collection.",
                systemImage: "square.stack"
            )
            .frame(minHeight: 240)
        } else {
            LazyVStack(spacing: Spacing.l) {
                ForEach(model.collections) { collection in
                    NavigationLink(value: Route.collection(brand: brand.handle, handle: collection.handle)) {
                        BrandCollectionCard(collection: collection, fallbackURL: model.heroURL)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }

    // MARK: Drops

    @ViewBuilder
    private func dropsSection(_ brand: StorefrontBrand) -> some View {
        let drops = model.visibleDrops
        if model.dropsLoading && drops.isEmpty {
            VStack(spacing: Spacing.m) {
                ForEach(0..<3, id: \.self) { _ in
                    Skeleton(cornerRadius: Radius.card).frame(height: 96)
                }
            }
            .padding(.horizontal, Spacing.gutter)
        } else if let error = model.dropsError, drops.isEmpty {
            EmptyState.error(message: error) {
                await model.loadDrops(brandId: brand.id)
            }
            .frame(minHeight: 240)
        } else if drops.isEmpty {
            EmptyState(
                title: "No drops yet",
                message: "Follow \(brand.name) to hear about their next drop.",
                systemImage: "flame"
            )
            .frame(minHeight: 240)
        } else {
            LazyVStack(spacing: Spacing.m) {
                ForEach(drops) { drop in
                    NavigationLink(value: Route.drop(id: drop.slug.isEmpty ? drop.id : drop.slug)) {
                        BrandDropRow(drop: drop)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
            }
            .padding(.horizontal, Spacing.gutter)
        }
    }

    // MARK: - Loading

    private var loadingView: some View {
        ScrollView {
            VStack(spacing: Spacing.m) {
                Skeleton(cornerRadius: 0)
                    .frame(height: heroHeight)
                Skeleton(cornerRadius: 8).frame(width: 220, height: 40)
                Skeleton(cornerRadius: 6).frame(width: 120, height: 16)
                Skeleton(shape: .capsule)
                    .frame(height: 54)
                    .padding(.horizontal, Spacing.gutter)
                Skeleton(cornerRadius: Radius.card)
                    .frame(height: 80)
                    .padding(.horizontal, Spacing.gutter)
            }
        }
        .scrollDisabled(true)
        .ignoresSafeArea(edges: .top)
        .accessibilityLabel("Loading brand")
    }
}

// MARK: - Hero backdrop

/// The sharp cover on top (stretches when pulled down, parallax when scrolled), fading into a
/// blurred copy of itself that fills the identity block, then into the page background.
@MainActor
struct BrandHeroBackdrop: View {
    let url: URL?
    let heroHeight: CGFloat
    let scrollSpace: String

    var body: some View {
        ZStack(alignment: .top) {
            // Blurred fill behind the whole identity block.
            Group {
                if url != nil {
                    Color.yard.scrim
                        .overlay {
                            RemoteImage(url: url, maxPixelSize: 300)
                                .blur(radius: 48, opaque: true)
                                .scaleEffect(1.4)
                        }
                        .overlay(Color.yard.scrim.opacity(0.38))
                } else {
                    LinearGradient(
                        colors: [Color.yard.purple, Color.yard.scrim.opacity(0.92)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
            }
            .clipped()

            // Sharp, stretchy hero.
            GeometryReader { geo in
                let minY = geo.frame(in: .named(scrollSpace)).minY
                let pull = max(minY, 0)
                let offset = minY > 0 ? -minY : -minY * 0.35
                Group {
                    if url != nil {
                        RemoteImage(url: url, maxPixelSize: 1600)
                    } else {
                        Color.clear
                    }
                }
                .frame(width: geo.size.width, height: heroHeight + pull)
                .clipped()
                .mask {
                    LinearGradient(
                        stops: [
                            Gradient.Stop(color: Color.yard.scrim, location: 0),
                            Gradient.Stop(color: Color.yard.scrim, location: 0.55),
                            Gradient.Stop(color: Color.yard.scrim.opacity(0), location: 1),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                }
                .offset(y: offset)
            }
            .frame(height: heroHeight)

            // Top scrim so the glass buttons and status bar read on bright photos.
            LinearGradient(colors: [Color.yard.scrim.opacity(0.35), Color.yard.scrim.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: 140)
                .allowsHitTesting(false)
        }
        .overlay(alignment: .bottom) {
            // Fade into the page background (light or dark).
            LinearGradient(colors: [Color.yard.bg.opacity(0), Color.yard.bg], startPoint: .top, endPoint: .bottom)
                .frame(height: 56)
                .allowsHitTesting(false)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Story card

/// The brand's story in a frosted card on the photo; long stories expand on tap.
@MainActor
struct BrandStoryCard: View {
    let text: String
    @State private var expanded = false

    private var isLong: Bool { text.count > 180 }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text(text)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.onPhoto)
                .lineLimit(expanded ? nil : 4)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
            if isLong {
                Button(expanded ? "Show less" : "Read more") {
                    withAnimation(Motion.spring) { expanded.toggle() }
                }
                .font(.yardCaptionEmphasis)
                .foregroundStyle(Color.yard.onPhoto.opacity(0.75))
            }
        }
        .padding(Spacing.l)
        .background(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).fill(Color.yard.onPhoto.opacity(0.1)))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.yard.onPhoto.opacity(0.18), lineWidth: 1))
    }
}

// MARK: - Collection card

@MainActor
struct BrandCollectionCard: View {
    let collection: StorefrontCollection
    let fallbackURL: URL?

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Color.yard.surface2
                .aspectRatio(16.0 / 10.0, contentMode: .fit)
                .overlay {
                    if let url = collection.imageURL ?? fallbackURL {
                        RemoteImage(url: url, maxPixelSize: 1000)
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    Text(collection.name)
                        .yardDisplay(30)
                        .foregroundStyle(Color.yard.onPhoto)
                        .lineLimit(2)
                        .padding(Spacing.l)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            LinearGradient(colors: [Color.yard.scrim.opacity(0), Color.yard.scrim.opacity(0.6)], startPoint: .top, endPoint: .bottom)
                        )
                }
                .clipShape(.yardImage)

            HStack(alignment: .firstTextBaseline) {
                if !collection.description.isEmpty {
                    Text(collection.description)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: Spacing.s)
                let count = collection.productIds.count
                Text("\(count) \(count == 1 ? "piece" : "pieces")")
                    .font(.yardCaptionEmphasis)
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(.horizontal, Spacing.xxs)
        }
    }
}

// MARK: - Drop row

@MainActor
struct BrandDropRow: View {
    let drop: Drop

    private var statusText: String {
        if drop.isLive {
            if let end = drop.endDate { return "Live now · ends \(Formatters.future(end))" }
            return "Live now"
        }
        if drop.isEnded { return drop.phase == "cancelled" ? "Cancelled" : "Ended" }
        if let start = drop.startDate { return "Starts \(Formatters.future(start))" }
        return "Upcoming"
    }

    var body: some View {
        HStack(spacing: Spacing.m) {
            Color.yard.surface2
                .frame(width: 72, height: 72)
                .overlay {
                    if drop.imageURL != nil {
                        RemoteImage(url: drop.imageURL, maxPixelSize: 300)
                    } else {
                        Image(systemName: "flame.fill")
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: Radius.small, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: Spacing.xs) {
                    if drop.isLive {
                        Tag("Live", style: .acid)
                    }
                    Tag(drop.accessLabel, style: .neutral)
                }
                Text(drop.name)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                Text(statusText)
                    .font(.yardCaption)
                    .foregroundStyle(drop.isLive ? Color.yard.success : Color.yard.ink2)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Color.yard.ink3)
        }
        .padding(Spacing.m)
        .yardCard(background: Color.yard.surface)
        .opacity(drop.isEnded ? 0.7 : 1)
    }
}

// MARK: - Label style

/// Icon + text tight together (meta line on the photo).
struct BrandsCompactLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) {
            configuration.icon
            configuration.title
        }
    }
}

// MARK: - Previews

@MainActor
private enum BrandProfilePreviewData {
    static func model() -> BrandProfileModel {
        let brand = StorefrontBrand(id: "brd_preview", handle: "acme", name: "Acme Studio", city: "Lagos", country: "NG", categories: ["streetwear"], verified: true, foundingBadge: true, forSale: true)
        let version = StorefrontVersion(version: 1, publishedAt: "2026-01-01T00:00:00Z", config: StorefrontConfig(intro: "Heavyweight basics cut in Lagos."))
        let storefront = PublicStorefront(
            brand: brand,
            storefront: version,
            collections: [StorefrontCollection(id: "c1", handle: "core", name: "Core", description: "The pieces we always make.", productIds: ["p1", "p2"])]
        )
        return BrandProfileModel(previewStorefront: storefront, story: "Heavyweight basics cut and sewn in Lagos, in small runs.", products: PreviewFixtures.products, followers: 1240)
    }
}

#Preview("BrandProfileView — dark") {
    NavigationStack { BrandProfileView(previewModel: BrandProfilePreviewData.model()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("BrandProfileView — light") {
    NavigationStack { BrandProfileView(previewModel: BrandProfilePreviewData.model()) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("BrandProfileView — live (light)") {
    NavigationStack { BrandProfileView(handle: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
