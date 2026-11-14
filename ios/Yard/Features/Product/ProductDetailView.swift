import SwiftUI

/// Product detail (`Route.product(slug:)`), mirroring the website's product page
/// (src/app/(market)/products/[slug]/page.tsx + src/components/market/product/product-view.tsx):
/// photo pager + thumbnails, brand row with Follow, title and price, option chips, quantity,
/// stock line, a sticky bar with Save + Choose size + Add to bag (Notify me while the brand is
/// opening or a size is sold out), description, details, delivery estimate, returns, and the
/// "More from <brand>" / "You might also like" rails.
@MainActor
struct ProductDetailView: View {
    let slug: String

    @State private var model: ProductDetailModel
    @State private var galleryIndex: Int = 0
    @State private var viewerStart: ProductViewerStart?
    @State private var showsSizeSheet: Bool = false
    @State private var showsSizePrompt: Bool = false
    @State private var isAdding: Bool = false
    @State private var addedCount: Int = 0
    @State private var descriptionExpanded: Bool = false

    @Environment(SessionStore.self) private var session
    @Environment(CartStore.self) private var cart
    @Environment(FollowStore.self) private var follows
    @Environment(SavedStore.self) private var saved
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast

    init(slug: String) {
        self.slug = slug
        self._model = State(initialValue: ProductDetailModel(slug: slug))
    }

    /// Previews only: starts with a product already loaded.
    init(previewProduct: Product) {
        self.slug = previewProduct.slug
        self._model = State(initialValue: ProductDetailModel(preview: previewProduct))
    }

    var body: some View {
        content
            .background(Color.yard.bg.ignoresSafeArea())
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.yard.bg, for: .navigationBar)
            .toolbar { toolbarContent }
            .task(id: slug) {
                if model.product == nil {
                    _ = await model.load(destinationCountry: cart.destinationCountry, currency: cart.currency)
                }
            }
            .sheet(isPresented: $showsSizeSheet) {
                ProductSizeSheet(model: model, isAdding: isAdding, onAdd: { addToBag() }, onNotify: { toggleWatch() })
                    .yardSheet(detents: [.medium, .large])
                    .yardToastHost(toast)
            }
            .fullScreenCover(item: $viewerStart) { start in
                ProductPhotoViewer(images: model.product?.images ?? [], startIndex: start.index)
            }
            .sensoryFeedback(.success, trigger: addedCount)
            // Back-in-stock state for the selected variant: also for a variant selected from the
            // start (single-size / no-option products) and again after signing in.
            .task(id: "\(model.variant?.id ?? "")-\(session.isSignedIn)") {
                guard let id = model.variant?.id, session.isSignedIn else { return }
                await model.loadWatch(variantId: id)
            }
    }

    // MARK: Phases

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            ProductDetailSkeleton()
        case .notFound:
            EmptyState(title: "Product not found",
                       message: "This piece may have been removed, or the link is wrong.",
                       systemImage: "questionmark.square.dashed",
                       actionTitle: "Go back") { router.pop() }
        case .failed(let message):
            EmptyState.error(message: message) {
                _ = await model.load(destinationCountry: cart.destinationCountry, currency: cart.currency)
            }
        case .loaded:
            if let product = model.product {
                loaded(product)
            } else {
                ProductDetailSkeleton()
            }
        }
    }

    private func loaded(_ product: Product) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                ProductGallery(images: product.images, index: $galleryIndex, onOpen: { i in
                    viewerStart = ProductViewerStart(index: i)
                }) {
                    galleryTag(product)
                }

                VStack(alignment: .leading, spacing: Spacing.l) {
                    if let brand = product.brand {
                        brandRow(brand)
                    }
                    titleBlock(product)
                }
                .padding(.horizontal, Spacing.gutter)

                optionsBlock(product)

                if let dropId = product.dropId {
                    dropCard(dropId: dropId)
                        .padding(.horizontal, Spacing.gutter)
                }

                if !product.description.isEmpty {
                    descriptionBlock(product.description)
                        .padding(.horizontal, Spacing.gutter)
                }

                if !product.details.isEmpty || model.variant != nil {
                    detailsCard(product)
                        .padding(.horizontal, Spacing.gutter)
                }

                deliveryCard(product)
                    .padding(.horizontal, Spacing.gutter)

                rails(product)
            }
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xxl)
        }
        .scrollIndicators(.hidden)
        .refreshable {
            if let message = await model.load(destinationCountry: cart.destinationCountry, currency: cart.currency) {
                toast.show(message, style: .error)
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomBar(product)
        }
    }

    // MARK: Gallery tag

    @ViewBuilder
    private func galleryTag(_ product: Product) -> some View {
        if product.isNotForSale {
            Tag("Opening soon", style: .onPhoto)
        } else if product.isSoldOut {
            Tag("Sold out", style: .onPhoto)
        } else if product.isNew {
            Tag("New Arrival", style: .acid)
        } else if product.badges.contains(where: { $0.lowercased() == "limited" }) {
            Tag("Limited", style: .onPhoto)
        }
    }

    // MARK: Brand row

    private func brandRow(_ brand: BrandSummary) -> some View {
        let following = follows.isFollowing(brand.id)
        return HStack(spacing: Spacing.m) {
            Button {
                router.push(.brand(handle: brand.handle))
            } label: {
                HStack(spacing: Spacing.m) {
                    BrandAvatar(name: brand.name, size: 44, verified: brand.verified)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: Spacing.xs) {
                            Text(brand.name)
                                .font(.yardHeadline)
                                .foregroundStyle(Color.yard.ink)
                                .lineLimit(1)
                            if brand.verified {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(Color.yard.violet)
                                    .accessibilityLabel(Text("Verified brand"))
                            }
                        }
                        HStack(spacing: Spacing.s) {
                            if let place = placeText(brand) {
                                Text(place)
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.ink2)
                                    .lineLimit(1)
                            }
                            if brand.foundingBadge {
                                Tag("Founding", style: .violet)
                            }
                        }
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint(Text("Opens the brand"))

            Spacer(minLength: Spacing.s)

            Button {
                messageBrand(brand)
            } label: {
                Image(systemName: "bubble.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.yard.ink)
                    .frame(width: 40, height: 40)
                    .background(Color.yard.surface2, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(PressableButtonStyle())
            .accessibilityLabel(Text("Message \(brand.name)"))

            YardButton(following ? "Following" : "Follow",
                       style: following ? .secondary : .inverted,
                       size: .small,
                       fullWidth: false) {
                toggleFollow(brand)
            }
            .sensoryFeedback(.impact(weight: .medium), trigger: following)
        }
    }

    private func placeText(_ brand: BrandSummary) -> String? {
        let country = brand.country.map { ProductDetailView.countryName($0) }
        let parts = [brand.city, country].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }

    // MARK: Title + price

    private func titleBlock(_ product: Product) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Text(product.title)
                .yardDisplay(36)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)

            HStack(alignment: .center, spacing: Spacing.s) {
                PriceText(minor: model.priceMinor,
                          currency: product.currency,
                          compareAtMinor: product.compareAtMinor,
                          font: .yardNumber(22))
                if product.compareAt != nil, model.priceMinor < (product.compareAtMinor ?? 0) {
                    Tag("Sale", style: .acid)
                }
                if product.isNew && !product.isNotForSale && !product.isSoldOut {
                    Tag("New Arrival", style: .neutral)
                }
            }
            Text("Duties and taxes are confirmed at checkout.")
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
        }
    }

    // MARK: Options, quantity, stock

    @ViewBuilder
    private func optionsBlock(_ product: Product) -> some View {
        let action = model.action(cart: cart)
        let maxQty = model.maxQuantity(cart: cart)
        VStack(alignment: .leading, spacing: Spacing.l) {
            ForEach(model.otherOptions, id: \.name) { option in
                ProductOptionPicker(option: option, model: model)
            }
            if let size = model.sizeOption {
                ProductOptionPicker(option: size, model: model, showsInvalid: showsSizePrompt) { _ in
                    showsSizePrompt = false
                }
            }

            HStack(alignment: .center) {
                if !model.isOpening && (action == .ready || action == .chooseSize) {
                    QuantityStepper(value: effectiveQuantity, range: 1...max(1, maxQty)) { newValue in
                        model.quantity = max(1, newValue)
                    }
                }
                Spacer()
                ProductStockLineView(model: model)
            }
            .padding(.horizontal, Spacing.gutter)

            if let helper = helperText(product, action: action) {
                HStack(spacing: Spacing.xs) {
                    Text(helper)
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                    if model.inBag(cart) > 0 {
                        Button("View bag") { router.push(.bag) }
                            .font(.yardCaptionEmphasis)
                            .foregroundStyle(Color.yard.violet)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .transition(.opacity)
            }
        }
        .animation(Motion.snappy, value: action)
    }

    private var effectiveQuantity: Int {
        min(max(1, model.quantity), max(1, model.maxQuantity(cart: cart)))
    }

    /// The website's helper line under the buttons.
    private func helperText(_ product: Product, action: ProductBuyAction) -> String? {
        let brandName = product.brand?.name ?? "this brand"
        let inBag = model.inBag(cart)
        switch action {
        case .opening:
            let pick = model.sizeOption != nil && model.variant == nil
            return "\(brandName) is opening soon on Yard. \(pick ? "Choose your size and tap Notify me" : "Tap Notify me") to hear when it opens, or follow \(brandName)."
        case .limit:
            if let s = model.variantStock, s <= ProductDetailModel.maxPerLine {
                return "All \(s) available are already in your bag."
            }
            return "Your bag already holds the most you can buy at once (\(ProductDetailModel.maxPerLine))."
        case .ready:
            return inBag > 0 ? "\(inBag) already in your bag." : nil
        case .soldOut:
            return model.variant == nil ? "Sold out for now. Save it to keep it in your wishlist, or see more from \(brandName) below." : nil
        case .chooseSize:
            return nil
        }
    }

    // MARK: Drop

    private func dropCard(dropId: String) -> some View {
        Button {
            router.push(.drop(id: dropId))
        } label: {
            HStack(spacing: Spacing.m) {
                Image(systemName: "bolt.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(Color.yard.onAcid)
                    .frame(width: 36, height: 36)
                    .background(Color.yard.acid, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text("Part of a drop")
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                    Text("See the release time, access and limits.")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink2)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(Spacing.l)
            .yardCard()
        }
        .buttonStyle(PressableButtonStyle())
    }

    // MARK: Description + details

    private func descriptionBlock(_ text: String) -> some View {
        let long = text.count > 220
        return VStack(alignment: .leading, spacing: Spacing.s) {
            Text("Description")
                .font(.yardHeadline)
                .foregroundStyle(Color.yard.ink)
            Text(text)
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink2)
                .lineLimit(descriptionExpanded || !long ? nil : 4)
                .fixedSize(horizontal: false, vertical: true)
            if long {
                Button(descriptionExpanded ? "Show less" : "Read more") {
                    withAnimation(Motion.spring) { descriptionExpanded.toggle() }
                }
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.violet)
            }
        }
    }

    private func detailsCard(_ product: Product) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.m) {
                Text("Details")
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                ForEach(Array(product.details.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
                        Circle()
                            .fill(Color.yard.ink3)
                            .frame(width: 4, height: 4)
                            .offset(y: -4)
                        Text(line)
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let p = product.processingText {
                    detailRow(systemImage: "scissors", text: p)
                }
                if let v = model.variant, !v.sku.isEmpty {
                    Text("Reference \(v.sku)")
                        .font(.yardCaption)
                        .monospacedDigit()
                        .foregroundStyle(Color.yard.ink3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func detailRow(systemImage: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: Spacing.m) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.yard.ink2)
                .frame(width: 18)
            Text(text)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Delivery + returns

    private func deliveryCard(_ product: Product) -> some View {
        let action = model.action(cart: cart)
        let brandName = product.brand?.name ?? "The brand"
        return Card {
            VStack(alignment: .leading, spacing: Spacing.m) {
                Text("Delivery & returns")
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)

                deliveryEstimateRows(product, action: action, brandName: brandName)

                let origin = originText(product)
                detailRow(systemImage: "shippingbox", text: origin.map { "Sold and shipped by \(brandName) from \($0)." } ?? "Sold and shipped by \(brandName).")

                detailRow(systemImage: "arrow.uturn.backward", text: "Start a return from your orders. Once \(brandName) receives the piece, the refund goes back to the way you paid.")

                HStack(spacing: Spacing.s) {
                    YardButton("Returns policy", systemImage: "doc.text", style: .secondary, size: .small, fullWidth: false) {
                        router.push(.legal(.refunds))
                    }
                    if let brand = product.brand {
                        YardButton("Ask \(brand.name)", systemImage: "bubble.left", style: .secondary, size: .small, fullWidth: false) {
                            messageBrand(brand)
                        }
                    }
                }
                .padding(.top, Spacing.xs)

                if let e = model.estimate, !e.unavailable {
                    Text("Estimates, not guarantees. They skip weekends and public holidays.")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func deliveryEstimateRows(_ product: Product, action: ProductBuyAction, brandName: String) -> some View {
        let country = ProductDetailView.countryName(model.estimateCountry)
        if model.estimateLoading && model.estimate == nil {
            HStack(spacing: Spacing.m) {
                Image(systemName: "truck.box")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.yard.ink3)
                    .frame(width: 18)
                Skeleton(cornerRadius: 6)
                    .frame(width: 200, height: 14)
            }
        } else if model.estimateFailed {
            HStack(spacing: Spacing.s) {
                detailRow(systemImage: "truck.box", text: "Couldn't load a delivery estimate.")
                Button("Retry") {
                    Task { @MainActor in
                        await model.loadEstimate(for: product, destinationCountry: cart.destinationCountry, currency: cart.currency)
                    }
                }
                .font(.yardCallout.weight(.semibold))
                .foregroundStyle(Color.yard.violet)
            }
        } else if let e = model.estimate {
            if e.unavailable || e.standard == nil {
                detailRow(systemImage: "truck.box", text: e.reason ?? "Doesn't ship to \(country) yet.")
            } else if let std = e.standard {
                if action == .soldOut || action == .opening {
                    if let total = combinedDays(e.handling, std.transit) {
                        detailRow(systemImage: "truck.box", text: "Not available right now. When it is, \(brandName) usually delivers to \(country) in \(total).")
                    }
                } else {
                    if let from = std.estimate?.arrivalFrom, let to = std.estimate?.arrivalTo,
                       let range = ProductShippingFormat.range(from: from, to: to) {
                        detailRow(systemImage: "truck.box", text: "Estimated delivery to \(country): \(range)")
                    }
                    if let days = ProductShippingFormat.businessDays(e.handling) {
                        detailRow(systemImage: "clock", text: dispatchText(days: days, estimate: e))
                    }
                    if let ex = e.express, let from = ex.estimate?.arrivalFrom, let to = ex.estimate?.arrivalTo,
                       let range = ProductShippingFormat.range(from: from, to: to) {
                        let price = ex.free ? "free" : (ex.price?.formatted ?? "")
                        detailRow(systemImage: "bolt", text: price.isEmpty ? "Express: est. \(range)" : "Express: est. \(range), \(price)")
                    }
                }
            }
        }
    }

    private func dispatchText(days: String, estimate e: ProductEstimate) -> String {
        var text = "Usually dispatches in \(days)."
        if let cutoff = YardDate.parse(e.cutoffAt), cutoff > Date(), let local = e.brand?.cutoffLocal, !local.isEmpty {
            let city = e.brand?.originCity ?? ""
            text += city.isEmpty ? " Order by \(local) to count from today." : " Order by \(local) \(city) time to count from today."
        }
        return text
    }

    private func combinedDays(_ handling: [Int], _ transit: [Int]) -> String? {
        guard handling.count == 2, transit.count == 2 else { return nil }
        return ProductShippingFormat.businessDays([handling[0] + transit[0], handling[1] + transit[1]])
    }

    private func originText(_ product: Product) -> String? {
        if let b = model.estimate?.brand, !b.originCity.isEmpty {
            return "\(b.originCity), \(ProductDetailView.countryName(b.originCountry))"
        }
        guard let brand = product.brand else { return nil }
        return placeText(brand)
    }

    // MARK: Rails

    @ViewBuilder
    private func rails(_ product: Product) -> some View {
        if let brand = product.brand, !model.moreFromBrand.isEmpty {
            productRail(title: "More from \(brand.name)",
                        subtitle: "Independent pieces from \(brand.name).",
                        actionTitle: "Visit storefront",
                        products: model.moreFromBrand,
                        showsBrand: false) {
                router.push(.brand(handle: brand.handle))
            }
        }
        if !model.similar.isEmpty {
            productRail(title: "You might also like",
                        subtitle: "Pieces from other independent brands, close to this one.",
                        actionTitle: product.category.isEmpty ? nil : "See all",
                        products: model.similar,
                        showsBrand: true) {
                router.push(.category(slug: product.category))
            }
        }
        if !model.railsLoaded {
            VStack(alignment: .leading, spacing: Spacing.m) {
                Skeleton(cornerRadius: 6)
                    .frame(width: 180, height: 18)
                    .padding(.horizontal, Spacing.gutter)
                HStack(spacing: Spacing.m) {
                    ForEach(0..<3, id: \.self) { _ in
                        Skeleton()
                            .frame(width: 150, height: 190)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .accessibilityHidden(true)
        }
    }

    private func productRail(title: String, subtitle: String?, actionTitle: String?, products: [Product], showsBrand: Bool, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader(title, subtitle: subtitle, actionTitle: actionTitle, action: actionTitle == nil ? nil : action)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Spacing.m) {
                    ForEach(products) { p in
                        NavigationLink(value: Route.product(slug: p.slug)) {
                            ProductTile(product: p, showsBrand: showsBrand)
                                .frame(width: 150)
                        }
                        .buttonStyle(PressableButtonStyle())
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
    }

    // MARK: Bottom bar

    private func bottomBar(_ product: Product) -> some View {
        let action = model.action(cart: cart)
        let isSaved = saved.isSaved(product.id)
        return HStack(spacing: Spacing.s) {
            Button {
                toggleSave(product)
            } label: {
                Image(systemName: isSaved ? "heart.fill" : "heart")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(isSaved ? Color.yard.danger : Color.yard.ink)
                    .frame(width: 52, height: 52)
                    .background(Color.yard.surface2, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(PressableButtonStyle())
            .sensoryFeedback(.impact(weight: .light), trigger: isSaved)
            .accessibilityLabel(Text(isSaved ? "Remove from saved" : "Save"))

            if model.sizeOption != nil {
                YardButton(sizePillTitle, systemImage: "chevron.down", style: .secondary, fullWidth: false) {
                    showsSizeSheet = true
                }
                .accessibilityLabel(Text(sizePillTitle))
                .accessibilityHint(Text("Opens the size picker"))
            }

            primaryButton(action)
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.m)
        .padding(.bottom, Spacing.s)
        .background(
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(alignment: .top) {
                    Rectangle().fill(Color.yard.line).frame(height: 1)
                }
                .ignoresSafeArea(edges: .bottom)
        )
    }

    private var sizePillTitle: String {
        if let size = model.sizeOption, let chosen = model.selection[size.name] {
            return "Size \(chosen)"
        }
        return "Choose size"
    }

    @ViewBuilder
    private func primaryButton(_ action: ProductBuyAction) -> some View {
        switch action {
        case .ready, .chooseSize:
            YardButton("Add to bag", systemImage: "bag", isLoading: isAdding) {
                addToBag()
            }
        case .opening:
            notifyButton(prompt: true)
        case .soldOut:
            if model.variant != nil {
                notifyButton(prompt: false)
            } else {
                YardButton("Sold out", style: .secondary) {}
                    .disabled(true)
            }
        case .limit:
            YardButton("View bag", systemImage: "bag", style: .secondary) {
                router.push(.bag)
            }
        }
    }

    @ViewBuilder
    private func notifyButton(prompt: Bool) -> some View {
        if let v = model.variant {
            let active = model.isWatching(v.id)
            YardButton(active ? "Stop watching" : "Notify me",
                       systemImage: "bell",
                       style: active ? .secondary : .primary,
                       isLoading: model.watchBusy) {
                toggleWatch()
            }
        } else {
            YardButton("Notify me", systemImage: "bell") {
                if prompt { showsSizeSheet = true }
            }
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            if let product = model.product {
                ShareLink(item: Config.webURL("/products/\(product.slug)"),
                          subject: Text(product.title),
                          message: Text(product.brand.map { "\(product.title) by \($0.name) on Yard" } ?? product.title)) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel(Text("Share"))
            }
            Button {
                router.push(.bag)
            } label: {
                Image(systemName: "bag")
                    .symbolEffect(.bounce, value: cart.count)
                    .overlay(alignment: .topTrailing) {
                        if cart.count > 0 {
                            Text("\(min(cart.count, 99))")
                                .font(.yardMicro)
                                .monospacedDigit()
                                .foregroundStyle(Color.yard.onAcid)
                                .padding(.horizontal, 4)
                                .frame(minWidth: 16, minHeight: 16)
                                .background(Color.yard.acid, in: Capsule())
                                .offset(x: 9, y: -8)
                                .contentTransition(.numericText())
                        }
                    }
                    .animation(Motion.spring, value: cart.count)
            }
            .accessibilityLabel(Text(cart.count > 0 ? "Bag, \(cart.count) items" : "Bag"))
        }
    }

    // MARK: Actions

    private func addToBag() {
        let action = model.action(cart: cart)
        switch action {
        case .chooseSize:
            if showsSizeSheet {
                withAnimation(Motion.snappy) { showsSizePrompt = true }
            } else {
                showsSizeSheet = true
            }
            return
        case .limit:
            router.push(.bag)
            return
        case .opening, .soldOut:
            toggleWatch()
            return
        case .ready:
            break
        }
        guard !isAdding, let variant = model.variant else { return }
        let qty = effectiveQuantity
        let variantId = variant.id
        isAdding = true
        Task { @MainActor in
            defer { isAdding = false }
            do {
                try await cart.add(variantId: variantId, qty: qty)
                addedCount += 1
                model.quantity = 1
                showsSizeSheet = false
                toast.show(qty > 1 ? "\(qty) added to your bag" : "Added to your bag", style: .success, systemImage: "bag.fill")
            } catch {
                toast.show(error)
            }
        }
    }

    private func toggleWatch() {
        guard let variant = model.variant else {
            showsSizeSheet = true
            return
        }
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        let variantId = variant.id
        Task { @MainActor in
            do {
                let now = try await model.toggleWatch(variantId: variantId)
                toast.show(now ? "We'll let you know when it's available" : "Stopped watching this size",
                           style: now ? .success : .info,
                           systemImage: now ? "bell.fill" : "bell.slash")
            } catch {
                toast.show(error)
            }
        }
    }

    private func toggleSave(_ product: Product) {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        let productId = product.id
        Task { @MainActor in
            do {
                let nowSaved = try await saved.toggle(productId: productId)
                if nowSaved { toast.show("Saved", style: .success, systemImage: "heart.fill") }
            } catch {
                toast.show(error)
            }
        }
    }

    private func toggleFollow(_ brand: BrandSummary) {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        let brandId = brand.id
        Task { @MainActor in
            do {
                try await follows.toggle(brandId: brandId)
            } catch {
                toast.show(error)
            }
        }
    }

    private func messageBrand(_ brand: BrandSummary) {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        router.push(.messageBrand(brandId: brand.id))
    }

    // MARK: Countries

    /// The website's market names (src/config/markets.ts); other codes fall back to the system name.
    static func countryName(_ code: String) -> String {
        let names: [String: String] = [
            "NG": "Nigeria", "GH": "Ghana", "KE": "Kenya", "ZA": "South Africa", "GB": "United Kingdom",
            "FR": "France", "DE": "Germany", "US": "United States", "MX": "Mexico", "JP": "Japan", "KR": "South Korea",
        ]
        let upper = code.uppercased()
        if let n = names[upper] { return n }
        return Locale(identifier: "en_US").localizedString(forRegionCode: upper) ?? upper
    }
}

/// Identifies the photo the full-screen viewer opens on.
struct ProductViewerStart: Identifiable, Hashable {
    let index: Int
    var id: Int { index }
}

/// Loading placeholder shaped like the page.
struct ProductDetailSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                Skeleton()
                    .aspectRatio(0.8, contentMode: .fit)
                    .padding(.horizontal, Spacing.s)
                HStack(spacing: Spacing.s) {
                    ForEach(0..<4, id: \.self) { _ in
                        Skeleton(cornerRadius: Radius.small)
                            .frame(width: 56, height: 68)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                HStack(spacing: Spacing.m) {
                    Skeleton(shape: .circle).frame(width: 44, height: 44)
                    VStack(alignment: .leading, spacing: 6) {
                        Skeleton(cornerRadius: 6).frame(width: 140, height: 14)
                        Skeleton(cornerRadius: 6).frame(width: 90, height: 12)
                    }
                    Spacer()
                    Skeleton(shape: .capsule).frame(width: 84, height: 34)
                }
                .padding(.horizontal, Spacing.gutter)
                Skeleton(cornerRadius: 8).frame(height: 34).padding(.horizontal, Spacing.gutter)
                Skeleton(cornerRadius: 6).frame(width: 110, height: 22).padding(.horizontal, Spacing.gutter)
                HStack(spacing: Spacing.s) {
                    ForEach(0..<5, id: \.self) { _ in
                        Skeleton(shape: .capsule).frame(width: 52, height: 36)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .padding(.top, Spacing.s)
        }
        .scrollDisabled(true)
        .accessibilityLabel(Text("Loading product"))
    }
}

// MARK: - Previews (fixtures are preview-only)

private enum ProductDetailPreviewData {
    static let product = Product(
        id: "prd_preview",
        slug: "boxy-tee",
        brandId: PreviewFixtures.brand.id,
        title: "Boxy heavyweight tee",
        description: "Soft heavyweight jersey with a relaxed, boxy cut. Garment-dyed so every piece settles into its own shade. Designed for everyday wear and cut to layer.",
        details: ["100% cotton, 280 gsm", "Boxy fit, true to size", "Made in Lagos"],
        category: "tops",
        badges: ["new"],
        priceMinor: 4500,
        compareAtMinor: 6000,
        currency: "USD",
        images: PreviewFixtures.products.prefix(4).compactMap { $0.images.first },
        options: [
            ProductOption(name: "Colour", values: [.init(value: "Black", hex: "#111111"), .init(value: "Bone", hex: "#E8E2D4")]),
            ProductOption(name: "Size", values: [.init(value: "S", hex: nil), .init(value: "M", hex: nil), .init(value: "L", hex: nil), .init(value: "XL", hex: nil)]),
        ],
        variants: [
            ProductVariant(id: "v1", sku: "BT-BLK-S", options: ["Colour": "Black", "Size": "S"], label: "Black, S", priceMinor: 4500, available: 4, inStock: true),
            ProductVariant(id: "v2", sku: "BT-BLK-M", options: ["Colour": "Black", "Size": "M"], label: "Black, M", priceMinor: 4500, available: 2, inStock: true),
            ProductVariant(id: "v3", sku: "BT-BLK-L", options: ["Colour": "Black", "Size": "L"], label: "Black, L", priceMinor: 4500, available: 0, inStock: false),
            ProductVariant(id: "v4", sku: "BT-BLK-XL", options: ["Colour": "Black", "Size": "XL"], label: "Black, XL", priceMinor: 4500, available: 6, inStock: true),
            ProductVariant(id: "v5", sku: "BT-BON-M", options: ["Colour": "Bone", "Size": "M"], label: "Bone, M", priceMinor: 4500, available: 3, inStock: true),
        ],
        available: 15,
        processingDays: [2, 4],
        brand: PreviewFixtures.brand
    )
}

#Preview("ProductDetailView — dark") {
    NavigationStack { ProductDetailView(previewProduct: ProductDetailPreviewData.product) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("ProductDetailView — light") {
    NavigationStack { ProductDetailView(previewProduct: ProductDetailPreviewData.product) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}

#Preview("ProductDetailView — loading") {
    NavigationStack { ProductDetailView(slug: "preview") }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}
