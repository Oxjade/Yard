import SwiftUI

/// One drop: hero image, brand, name, release timing with a big live countdown, the reminder /
/// draw-entry action, facts, description and the drop's pieces (masonry). When the drop is live
/// the pieces open the product page to buy, and a "Shop this drop" bar sits at the bottom.
@MainActor
struct DropDetailView: View {
    let id: String

    @Environment(Router.self) private var router
    @Environment(SessionStore.self) private var session
    @Environment(ToastCenter.self) private var toast

    @State private var model: DropDetailViewModel
    /// The page's clock for phase changes (the countdown ticks on its own every second).
    @State private var now = Date()

    init(id: String) {
        self.id = id
        _model = State(initialValue: DropDetailViewModel(id: id))
    }

    /// Previews only.
    fileprivate init(model: DropDetailViewModel) {
        self.id = model.id
        _model = State(initialValue: model)
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                DropDetailSkeleton()
            case .failed(let error):
                EmptyState.error(error) { await model.load() }
            case .loaded:
                if let drop = model.drop {
                    loaded(drop)
                } else {
                    EmptyState(title: "Drop not found", message: "We couldn't find that drop.", systemImage: "calendar.badge.exclamationmark")
                }
            }
        }
        .yardScreenBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if let drop = model.drop {
                    ShareLink(
                        item: Config.webURL(drop.webPath),
                        subject: Text(drop.name),
                        message: Text("\(drop.name) by \(drop.brandName) on Yard")
                    ) {
                        Image(systemName: "square.and.arrow.up")
                            .foregroundStyle(Color.yard.ink)
                    }
                    .accessibilityLabel(Text("Share drop"))
                }
            }
        }
        .task {
            if model.drop == nil { await model.load() }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                now = Date()
            }
        }
        .onChange(of: session.isSignedIn) { _, _ in
            Task { @MainActor in await model.load() }
        }
    }

    // MARK: Loaded

    @ViewBuilder
    private func loaded(_ drop: Drop) -> some View {
        let phase = drop.livePhase(at: now)
        let shopNow = phase == .live && !drop.isDraw
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xl) {
                    hero(drop, phase: phase)
                    titleBlock(drop)
                    releaseCard(drop, phase: phase, proxy: proxy)
                        .padding(.horizontal, Spacing.gutter)
                    if !drop.description.isEmpty {
                        Text(drop.description)
                            .font(.yardBody)
                            .foregroundStyle(Color.yard.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, Spacing.gutter)
                    }
                    facts(drop, phase: phase)
                        .padding(.horizontal, Spacing.gutter)
                    pieces(drop, phase: phase)
                        .id("pieces")
                }
                .padding(.bottom, Spacing.xxxl)
            }
            .refreshable { await model.load() }
            .safeAreaInset(edge: .bottom) {
                if shopNow && !model.products.isEmpty {
                    YardButton("Shop this drop", systemImage: "arrow.down") {
                        withAnimation(Motion.spring) { proxy.scrollTo("pieces", anchor: .top) }
                    }
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.top, Spacing.s)
                    .padding(.bottom, Spacing.s)
                    .background(.ultraThinMaterial)
                }
            }
        }
        .onChange(of: phase) { _, newPhase in
            model.phaseDidChange(to: newPhase)
        }
    }

    private func hero(_ drop: Drop, phase: DropLivePhase) -> some View {
        Color.clear
            .aspectRatio(4.0 / 5.0, contentMode: .fit)
            .overlay { RemoteImage(url: drop.imageURL, maxPixelSize: 1600) }
            .overlay(alignment: .topLeading) {
                HStack(spacing: Spacing.xs) {
                    DropStatusBadge(drop: drop, phase: phase, onPhoto: true)
                    Tag(drop.accessLabel, style: .onPhoto)
                    if drop.sponsored { Tag("Sponsored", style: .onPhoto) }
                }
                .padding(Spacing.m)
            }
            .clipShape(.yardImage)
            .padding(.horizontal, Spacing.gridGap)
            .accessibilityLabel(Text(drop.name))
    }

    private func titleBlock(_ drop: Drop) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            Button {
                if let handle = drop.brand.handle { router.push(.brand(handle: handle)) }
            } label: {
                HStack(spacing: Spacing.s) {
                    BrandAvatar(name: drop.brandName, size: 28)
                    Text(drop.brandName)
                        .font(.yardBodyEmphasis)
                        .foregroundStyle(Color.yard.ink)
                    if drop.brand.handle != nil {
                        Image(systemName: "chevron.right")
                            .font(.yardMicro)
                            .foregroundStyle(Color.yard.ink3)
                    }
                }
            }
            .buttonStyle(.plain)
            .disabled(drop.brand.handle == nil)

            Text(drop.name)
                .yardDisplay(46)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, Spacing.gutter)
    }

    // MARK: Release card

    private func releaseCard(_ drop: Drop, phase: DropLivePhase, proxy: ScrollViewProxy) -> some View {
        let me = model.me
        let entry = me?.entry
        let winner = entry?.status == "won"
        let mode = drop.actionMode(phase)
        let drawWaiting = drop.isDrawWaiting(phase, now: now)
        return VStack(alignment: .leading, spacing: Spacing.m) {
            if winner, let me {
                winnerCard(drop, me: me, entry: entry, proxy: proxy)
            }
            Card {
                VStack(alignment: .leading, spacing: Spacing.m) {
                    Text(drop.releaseKindLabel.uppercased())
                        .font(.yardMicro)
                        .foregroundStyle(Color.yard.ink3)
                    Text(drop.timingText(phase, now: now))
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    if let target = drop.countdownTarget(phase, now: now) {
                        DropCountdown(label: target.label, target: target.date, hot: drop.isHot(phase))
                    }

                    if let mode {
                        actionButton(drop, mode: mode)
                    }
                    if drawWaiting {
                        note("Set a reminder now; you can enter once entries open.")
                    }
                    if phase == .live && !drop.isDraw {
                        YardButton("Shop this drop", systemImage: "arrow.down") {
                            withAnimation(Motion.spring) { proxy.scrollTo("pieces", anchor: .top) }
                        }
                    }
                    if phase == .earlyAccess {
                        note("Early access is available to eligible followers. Open a piece to check your access.")
                    }
                    if drop.isWinnersWindow(phase) && !winner {
                        note("Entries are closed. Drawn winners are buying now.")
                    }
                    if let me, !me.canBuy, let reason = me.reason, !winner, phase == .live || phase == .earlyAccess {
                        HStack(alignment: .top, spacing: Spacing.s) {
                            Rectangle().fill(Color.yard.line).frame(width: 2)
                            Text(reason)
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    if let entry, !winner {
                        let status = DropText.entryStatus(entry.status)
                        HStack(spacing: Spacing.xs) {
                            Text("Your draw entry:")
                                .font(.yardCaption)
                                .foregroundStyle(Color.yard.ink3)
                            Tag(status.label, style: status.style)
                            if let rank = entry.rank {
                                Text("position \(rank)")
                                    .font(.yardCaption)
                                    .foregroundStyle(Color.yard.ink3)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private func winnerCard(_ drop: Drop, me: DropViewerState, entry: DropEntry?, proxy: ScrollViewProxy) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Spacing.s) {
                HStack(spacing: Spacing.s) {
                    Image(systemName: "trophy.fill")
                        .foregroundStyle(Color.yard.acid)
                    Text("You won the draw")
                        .yardDisplay(26)
                        .foregroundStyle(Color.yard.ink)
                }
                if me.canBuy, let ends = YardDate.parse(entry?.windowEndsAt) {
                    Text("Buy your piece by \(Formatters.dateTime(ends)) (your time). After that, your place goes to the next person on the waitlist.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    YardButton("Buy now", systemImage: "arrow.down") {
                        withAnimation(Motion.spring) { proxy.scrollTo("pieces", anchor: .top) }
                    }
                } else if let opens = YardDate.parse(entry?.windowOpensAt), opens > now {
                    let closing: String = YardDate.parse(entry?.windowEndsAt).map { " and closes \(Formatters.dateTime($0))" } ?? ""
                    Text("Your purchase window opens \(Formatters.dateTime(opens))\(closing) (your time).")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                } else if let reason = me.reason {
                    Text(reason)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Color.yard.acid.opacity(0.5), lineWidth: 1)
        )
    }

    @ViewBuilder
    private func actionButton(_ drop: Drop, mode: DropActionMode) -> some View {
        switch mode {
        case .reminder:
            let on = model.me?.reminder ?? false
            let title: String = on ? "Reminder set" : (drop.isDraw ? "Remind me to enter" : "Remind me")
            YardButton(title, systemImage: on ? "bell.fill" : "bell", style: on ? .secondary : .primary, isLoading: model.isWorking) {
                toggleReminder()
            }
            .sensoryFeedback(.success, trigger: on)
        case .entry:
            let entered = model.isEntered
            YardButton(entered ? "Entered" : "Enter the draw", systemImage: entered ? "checkmark.seal.fill" : "dice", style: entered ? .secondary : .primary, isLoading: model.isWorking) {
                toggleEntry()
            }
            .sensoryFeedback(.success, trigger: entered)
            if entered {
                note("Tap again to withdraw before the draw.")
            }
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.yardCaption)
            .foregroundStyle(Color.yard.ink3)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: Facts

    private func facts(_ drop: Drop, phase: DropLivePhase) -> some View {
        let columns: [GridItem] = [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)]
        return LazyVGrid(columns: columns, alignment: .leading, spacing: Spacing.m) {
            fact("Run", drop.runText)
            fact("Limit", "\(drop.limitPerCustomer) per customer")
            if phase == .live, let left = drop.unitsAvailable {
                fact("Left", left > 0 ? Formatters.grouped(left) : "Sold out")
            }
            if drop.isDraw, let winners = drop.winners {
                fact("Winners", Formatters.grouped(winners))
            }
            if drop.isDraw, let minutes = drop.purchaseWindowMinutes {
                fact("Winner window", DropText.windowLength(minutes))
            }
            if drop.isDraw, let entries = drop.entries {
                fact("Entries", Formatters.grouped(entries))
            }
        }
        .padding(Spacing.l)
        .background(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Color.yard.line, lineWidth: 1)
        )
    }

    private func fact(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.yardCaption)
                .foregroundStyle(Color.yard.ink3)
            Text(value)
                .font(.yardBodyEmphasis)
                .foregroundStyle(Color.yard.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Pieces

    private func pieces(_ drop: Drop, phase: DropLivePhase) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            SectionHeader("In this drop", subtitle: "Checkout confirms availability and enforces the drop's purchase rules.", display: true)
            if phase == .upcoming {
                note("Pieces can be bought once the drop opens. Set a reminder so you don't miss it.")
                    .padding(.horizontal, Spacing.gutter)
            }
            if model.products.isEmpty {
                Text("The pieces in this drop aren't available to view right now.")
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .padding(.horizontal, Spacing.gutter)
            } else {
                MasonryGrid(model.products) { product in
                    NavigationLink(value: Route.product(slug: product.slug)) {
                        ProductTile(product: product, showsBrand: false)
                    }
                    .buttonStyle(PressableButtonStyle())
                }
                .padding(.horizontal, Spacing.gridGap)
            }
        }
    }

    // MARK: Actions

    private func toggleReminder() {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        Task { @MainActor in
            do {
                let message = try await model.toggleReminder()
                if !message.text.isEmpty { toast.show(message.text, style: message.style) }
            } catch {
                toast.show(error)
            }
        }
    }

    private func toggleEntry() {
        guard session.isSignedIn else {
            router.present(.signIn)
            return
        }
        Task { @MainActor in
            do {
                let text = try await model.toggleEntry()
                if !text.isEmpty { toast.show(text, style: .success) }
            } catch {
                toast.show(error)
            }
        }
    }
}

/// The big ticking countdown ("Opens in 2d 04:12:09").
struct DropCountdown: View {
    let label: String
    let target: Date
    var hot: Bool = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: Spacing.xs) {
                    if hot { DropLivePulse(color: Color.yard.violet, size: 6).frame(width: 14, height: 14) }
                    Text(label)
                        .font(.yardCaptionEmphasis)
                        .foregroundStyle(Color.yard.ink2)
                }
                Text(Formatters.countdown(target.timeIntervalSince(context.date)))
                    .font(.yardNumber(44))
                    .monospacedDigit()
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .contentTransition(.numericText(countsDown: true))
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// Loading placeholder for the drop page.
struct DropDetailSkeleton: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                Skeleton(cornerRadius: Radius.image)
                    .aspectRatio(4.0 / 5.0, contentMode: .fit)
                    .padding(.horizontal, Spacing.gridGap)
                VStack(alignment: .leading, spacing: Spacing.m) {
                    Skeleton(cornerRadius: Radius.small).frame(width: 120, height: 18)
                    Skeleton(cornerRadius: Radius.small).frame(height: 44)
                    Skeleton(cornerRadius: Radius.card).frame(height: 180)
                }
                .padding(.horizontal, Spacing.gutter)
            }
        }
        .scrollDisabled(true)
        .accessibilityLabel(Text("Loading drop"))
    }
}

#Preview("DropDetailView — dark") {
    NavigationStack {
        DropDetailView(model: DropDetailViewModel(previewDrop: DropsPreviewFixtures.live, products: Array(PreviewFixtures.products.prefix(4))))
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("DropDetailView — light") {
    NavigationStack {
        DropDetailView(model: DropDetailViewModel(previewDrop: DropsPreviewFixtures.upcoming, products: Array(PreviewFixtures.products.prefix(3))))
    }
    .yardPreviewEnvironment(signedIn: false)
    .preferredColorScheme(.light)
}
