import SwiftUI

/// Shopper onboarding (the website's /welcome, welcome-flow.tsx): what you shop for, which looks
/// feel like you, then brands to start with. Every step can be skipped. Answers are kept on this
/// device (`AuthOnboarding` keys), like the website keeps them per browser.
///
/// Shown inside the sign-in sheet after a first sign-in on this device, or pushed as `.welcome`.
@MainActor
struct WelcomeView: View {
    init() {}

    @Environment(SessionStore.self) private var session
    @Environment(FollowStore.self) private var follows
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss

    @AppStorage(AuthOnboarding.onboardedKey) private var onboarded: Bool = false
    @AppStorage(AuthOnboarding.interestsKey) private var storedInterests: String = ""
    @AppStorage(AuthOnboarding.aestheticsKey) private var storedAesthetics: String = ""

    @State private var model: WelcomeModel = WelcomeModel()
    @State private var step: Int = 0
    @State private var forward: Bool = true
    @State private var cats: [String] = []
    @State private var looks: [String] = []
    @State private var didSeed: Bool = false
    @State private var followingAtStart: Int = 0
    @State private var followBusy: Set<String> = []
    @State private var pickTick: Int = 0
    @State private var followTick: Int = 0

    fileprivate init(model: WelcomeModel, step: Int) {
        _model = State(initialValue: model)
        _step = State(initialValue: step)
    }

    private struct StepCopy {
        let title: String
        let body: String
    }

    private let steps: [StepCopy] = [
        StepCopy(title: "What do you shop for?", body: "Pick as many as you like. We use them to order Discover and suggest brands."),
        StepCopy(title: "Which looks feel like you?", body: "Looks cut across categories. Pick any that fit, or skip."),
        StepCopy(title: "Brands to start with", body: "Picked from your answers. Follow a few and their new pieces, drops and stories fill your Following feed."),
    ]

    var body: some View {
        Group {
            if session.isSignedIn {
                flow
            } else {
                EmptyState.signedOut(
                    title: "Make it yours",
                    message: "Sign in and tell us what you shop for. Three quick picks, under a minute, and Discover starts with your kind of brands."
                ) {
                    router.present(.signIn)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .yardScreenBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(session.isSignedIn)
        .toolbar {
            if session.isSignedIn {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Skip setup") { finish(save: false) }
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                }
            }
        }
        .sensoryFeedback(.selection, trigger: pickTick)
        .sensoryFeedback(.success, trigger: followTick)
        .onAppear(perform: seed)
        .task {
            if !model.categoriesLoaded { await model.loadCategories() }
        }
        .task(id: step) {
            if step == 2 { await model.loadSuggestions(categories: cats) }
        }
    }

    // MARK: Flow

    private var flow: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                progressHeader
                VStack(alignment: .leading, spacing: Spacing.m) {
                    Text(steps[step].title)
                        .yardDisplay(40)
                        .foregroundStyle(Color.yard.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    Text(steps[step].body)
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                stepContent
                    .id(step)
                    .transition(.asymmetric(
                        insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                        removal: .opacity
                    ))
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.s)
            .padding(.bottom, Spacing.xl)
        }
        .safeAreaInset(edge: .bottom) { bottomBar }
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            if let shopper = session.shopper {
                Text("Welcome, \(shopper.firstName)")
                    .font(.yardCallout.weight(.semibold))
                    .foregroundStyle(Color.yard.violet)
            }
            HStack(spacing: Spacing.s) {
                ForEach(0..<3, id: \.self) { index in
                    Capsule()
                        .fill(index <= step ? Color.yard.violet : Color.yard.line)
                        .frame(height: 4)
                }
            }
            .animation(Motion.spring, value: step)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Setup progress"))
            .accessibilityValue(Text("Step \(step + 1) of 3"))
            Text("Step \(step + 1) of 3, about a minute in all")
                .font(.yardCaption.monospacedDigit())
                .foregroundStyle(Color.yard.ink3)
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch step {
        case 0:
            categoriesStep
        case 1:
            WelcomeFlowLayout(spacing: Spacing.s) {
                ForEach(WelcomeLook.all) { look in
                    WelcomePickChip(title: look.label, imageURL: nil, showsImage: false, isSelected: looks.contains(look.slug)) {
                        toggle(look.slug, in: &looks)
                    }
                }
            }
        default:
            brandsStep
        }
    }

    @ViewBuilder
    private var categoriesStep: some View {
        if !model.categoriesLoaded && model.categoriesError == nil {
            WelcomeFlowLayout(spacing: Spacing.s) {
                ForEach(0..<8, id: \.self) { index in
                    Skeleton(shape: .capsule)
                        .frame(width: CGFloat([120, 96, 140, 110, 88, 130, 104, 118][index]), height: 48)
                }
            }
        } else if let error = model.categoriesError, model.categories.isEmpty {
            EmptyState.error(error) { await model.loadCategories() }
        } else if model.categories.isEmpty {
            EmptyState(
                title: "No categories yet",
                message: "Categories appear as brands list their pieces. Skip this step for now.",
                systemImage: "square.grid.2x2"
            )
        } else {
            WelcomeFlowLayout(spacing: Spacing.s) {
                ForEach(model.categories) { category in
                    WelcomePickChip(title: category.name, imageURL: category.imageURL, showsImage: true, isSelected: cats.contains(category.slug)) {
                        toggle(category.slug, in: &cats)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var brandsStep: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            if let suggestions = model.suggestions {
                if suggestions.isEmpty {
                    EmptyState(
                        title: "Brands are joining Yard — follow along",
                        message: "Independent studios are setting up their storefronts now. Their pieces, drops and stories appear here the day they open.",
                        systemImage: "storefront"
                    )
                    .yardCard()
                } else {
                    ForEach(suggestions) { brand in
                        WelcomeBrandRow(
                            brand: brand,
                            isFollowing: follows.isFollowing(brand.id),
                            isBusy: followBusy.contains(brand.id)
                        ) {
                            follow(brand)
                        }
                    }
                }
            } else {
                ForEach(0..<3, id: \.self) { _ in
                    Skeleton(cornerRadius: Radius.card)
                        .frame(height: 84)
                }
            }
            Text(followingText)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .padding(.top, Spacing.xs)
        }
    }

    private var followingText: String {
        let n = follows.followedIds.count
        if n == 0 { return "Not following anyone yet. You can always follow brands later." }
        return "Following \(n) \(n == 1 ? "brand" : "brands")."
    }

    private var picks: Int {
        switch step {
        case 0: return cats.count
        case 1: return looks.count
        default: return 0
        }
    }

    private var bottomBar: some View {
        VStack(spacing: Spacing.s) {
            if step < 2 && picks == 0 {
                Text("Pick at least one to continue, or skip this step.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
            HStack(spacing: Spacing.s) {
                if step > 0 {
                    Button {
                        go(to: step - 1)
                    } label: {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 17, weight: .semibold))
                            .frame(width: YardButton.Size.large.height, height: YardButton.Size.large.height)
                    }
                    .buttonStyle(AuthPillButtonStyle(style: .secondary))
                    .accessibilityLabel(Text("Back"))
                }
                YardButton(step == 2 ? "Skip and finish" : "Skip", style: .secondary, fullWidth: false) {
                    skip()
                }
                if step < 2 {
                    YardButton(picks > 0 ? "Continue with \(picks) \(picks == 1 ? "pick" : "picks")" : "Continue") {
                        go(to: step + 1)
                    }
                    .disabled(picks == 0)
                } else {
                    YardButton("Finish") {
                        finish(save: true)
                    }
                }
            }
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

    // MARK: Actions

    private func seed() {
        guard !didSeed else { return }
        didSeed = true
        cats = AuthOnboarding.split(storedInterests)
        looks = AuthOnboarding.split(storedAesthetics)
        followingAtStart = follows.followedIds.count
    }

    private func toggle(_ value: String, in list: inout [String]) {
        if let index = list.firstIndex(of: value) {
            list.remove(at: index)
        } else {
            list.append(value)
        }
        pickTick += 1
    }

    private func go(to newStep: Int) {
        let clamped = min(max(newStep, 0), 2)
        forward = clamped > step
        withAnimation(Motion.spring) { step = clamped }
    }

    /// Skipping a step leaves that answer as it was before onboarding.
    private func skip() {
        switch step {
        case 0:
            cats = AuthOnboarding.split(storedInterests)
            go(to: 1)
        case 1:
            looks = AuthOnboarding.split(storedAesthetics)
            go(to: 2)
        default:
            finish(save: true)
        }
    }

    private func follow(_ brand: BrandCard) {
        guard !followBusy.contains(brand.id) else { return }
        followBusy.insert(brand.id)
        Task { @MainActor in
            defer { followBusy.remove(brand.id) }
            do {
                let result = try await follows.toggle(brandId: brand.id)
                if result.following { followTick += 1 }
            } catch {
                toast.show(error)
            }
        }
    }

    private func finish(save: Bool) {
        if save {
            storedInterests = AuthOnboarding.join(cats)
            storedAesthetics = AuthOnboarding.join(looks)
        }
        onboarded = true
        let newFollows = max(0, follows.followedIds.count - followingAtStart)
        if save {
            var message = "You're set. "
            message += (cats.count + looks.count) > 0 ? "Discover now leads with what you picked." : "Discover shows a bit of everything for now."
            if newFollows > 0 {
                message += " Following \(newFollows) new \(newFollows == 1 ? "brand" : "brands")."
            }
            toast.show(message, style: .success)
        } else {
            toast.show("Setup skipped. You can add interests any time in Settings.", style: .info)
        }
        if router.sheet != nil {
            router.dismissSheet()
        } else {
            dismiss()
        }
    }
}

// MARK: - Pieces

/// A large pick chip with an optional round photo at its start.
private struct WelcomePickChip: View {
    let title: String
    let imageURL: URL?
    let showsImage: Bool
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: Spacing.s) {
                if showsImage {
                    RemoteImage(url: imageURL, maxPixelSize: 120)
                        .frame(width: 36, height: 36)
                        .clipShape(Circle())
                        .accessibilityHidden(true)
                }
                Text(title)
                    .font(.yardCallout.weight(.semibold))
                    .lineLimit(1)
                if isSelected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 12, weight: .bold))
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .foregroundStyle(isSelected ? Color.yard.bg : Color.yard.ink)
            .padding(.leading, showsImage ? 6 : Spacing.l)
            .padding(.trailing, Spacing.l)
            .frame(height: 48)
            .background(isSelected ? Color.yard.ink : Color.yard.surface2, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.yard.line, lineWidth: isSelected ? 0 : 1))
            .contentShape(Capsule())
        }
        .buttonStyle(PressableButtonStyle())
        .animation(Motion.snappy, value: isSelected)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// A suggested brand: cover (when it has one), avatar, name, place, Follow.
private struct WelcomeBrandRow: View {
    let brand: BrandCard
    let isFollowing: Bool
    let isBusy: Bool
    let onFollow: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            if brand.coverURL != nil {
                RemoteImage(url: brand.coverURL, maxPixelSize: 900)
                    .frame(maxWidth: .infinity)
                    .frame(height: 120)
                    .clipped()
            }
            HStack(spacing: Spacing.m) {
                BrandAvatar(name: brand.name, logoURL: brand.logoURL, size: 44, verified: brand.verified)
                VStack(alignment: .leading, spacing: 2) {
                    Text(brand.name)
                        .font(.yardHeadline)
                        .foregroundStyle(Color.yard.ink)
                        .lineLimit(1)
                    if !brand.locationText.isEmpty {
                        Text(brand.locationText)
                            .font(.yardCaption)
                            .foregroundStyle(Color.yard.ink2)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: Spacing.s)
                YardButton(
                    isFollowing ? "Following" : "Follow",
                    style: isFollowing ? .inverted : .primary,
                    size: .small,
                    isLoading: isBusy,
                    fullWidth: false,
                    action: onFollow
                )
                .accessibilityLabel(Text(isFollowing ? "Following \(brand.name)" : "Follow \(brand.name)"))
            }
            .padding(Spacing.m)
        }
        .yardCard()
        .clipShape(.yardCard)
    }
}

// MARK: - Previews

#Preview("WelcomeView — dark") {
    NavigationStack {
        WelcomeView(
            model: WelcomeModel(
                previewCategories: [
                    WelcomeCategory(slug: "tops", name: "Tops"),
                    WelcomeCategory(slug: "outerwear", name: "Outerwear"),
                    WelcomeCategory(slug: "bottoms", name: "Bottoms"),
                    WelcomeCategory(slug: "accessories", name: "Accessories"),
                ],
                suggestions: nil
            ),
            step: 0
        )
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.dark)
}

#Preview("WelcomeView — light") {
    NavigationStack {
        WelcomeView(
            model: WelcomeModel(previewCategories: [], suggestions: [PreviewFixtures.brandCard]),
            step: 2
        )
    }
    .yardPreviewEnvironment()
    .preferredColorScheme(.light)
}

#Preview("WelcomeView signed out — dark") {
    NavigationStack { WelcomeView() }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.dark)
}
