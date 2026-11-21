import SwiftUI
import Observation

/// Data and actions for the short application.
@Observable
@MainActor
final class SellerApplicationModel {
    var form = SellerApplicationForm(regionCode: Locale.current.region?.identifier)
    var step: SellerApplicationForm.Step = .name
    /// A problem shown under the current step (local check or the server's field message).
    var problem: String?

    private(set) var categories: [WelcomeCategory] = []
    private(set) var categoriesLoading: Bool = false
    private(set) var categoriesError: String?

    private(set) var submitting: Bool = false
    private(set) var result: StudioApplyResult?
    /// A refusal for the whole application (409 on the website, 422 rule), with what to do.
    private(set) var refusal: Refusal?
    /// An application already waiting (GET /api/studio/apply).
    private(set) var waiting: StudioApplication?

    struct Refusal: Equatable {
        enum Action: Equatable { case openWebsite, openStudio, none }
        let message: String
        let action: Action
    }

    var progress: Double { Double(step.index + 1) / Double(SellerApplicationForm.Step.count) }

    func loadCategories() async {
        guard categories.isEmpty, !categoriesLoading else { return }
        categoriesLoading = true
        categoriesError = nil
        defer { categoriesLoading = false }
        do {
            categories = try await StudioAPI.categories()
        } catch {
            if (error as? APIError)?.isCancelled != true {
                categoriesError = APIError.message(for: error)
            }
        }
    }

    func checkExisting() async {
        guard let existing = try? await StudioAPI.application() else { return }
        if existing.isWaiting { waiting = existing }
    }

    /// Validates the current step and moves on. Returns false when it stays.
    @discardableResult
    func next() -> Bool {
        if let p = form.problem(at: step) {
            problem = p
            return false
        }
        problem = nil
        if let nextStep = SellerApplicationForm.Step(rawValue: step.rawValue + 1) {
            step = nextStep
        }
        return true
    }

    func back() {
        problem = nil
        refusal = nil
        if let previous = SellerApplicationForm.Step(rawValue: step.rawValue - 1) {
            step = previous
        }
    }

    /// POST /api/studio/apply. Returns true when submitted (or one was already waiting).
    func submit() async -> Bool {
        if let invalid = form.firstInvalidStep {
            step = invalid
            problem = form.problem(at: invalid)
            return false
        }
        guard let body = form.body() else { return false }
        submitting = true
        refusal = nil
        problem = nil
        defer { submitting = false }
        do {
            result = try await StudioAPI.apply(body)
            return true
        } catch let error as APIError {
            handle(error)
            return false
        } catch {
            problem = APIError.message(for: error)
            return false
        }
    }

    private func handle(_ error: APIError) {
        switch error.status {
        case 400:
            if let entry = error.fields.first(where: { !$0.value.isEmpty }) {
                step = SellerApplicationForm.step(forField: entry.key)
                problem = entry.value
            } else {
                problem = error.message
            }
        case 409:
            refusal = Refusal(message: error.message, action: .openWebsite)
        case 422:
            let approved = error.message.lowercased().contains("approved")
            refusal = Refusal(message: error.message, action: approved ? .openStudio : .none)
        default:
            problem = error.message
        }
    }
}

/// The short application, one question per screen with a progress bar (~30–45 s):
/// name (live label preview) → Instagram or website → category → city/country → slide to submit
/// → celebration. Used from the role screen and from You › Sell on Yard.
@MainActor
struct SellerApplicationView: View {
    /// Leave the flow (closed, or finished and "Done").
    let onClose: () -> Void

    @Environment(SessionStore.self) private var session
    @Environment(StudioStore.self) private var studio
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var model = SellerApplicationModel()
    @State private var webPage: YouWebPage?
    @FocusState private var focused: Bool

    init(onClose: @escaping () -> Void) {
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            if let result = model.result {
                celebration(result)
                    .transition(.opacity)
            } else if let waiting = model.waiting {
                waitingView(waiting)
                    .transition(.opacity)
            } else {
                flow
                    .transition(.opacity)
            }
        }
        .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: model.result != nil)
        .yardScreenBackground()
        .toolbar(.hidden, for: .navigationBar)
        .youWebPage($webPage)
        .task {
            await model.checkExisting()
            await model.loadCategories()
        }
        .sensoryFeedback(.error, trigger: model.problem) { _, new in new != nil }
        .sensoryFeedback(.selection, trigger: model.step)
    }

    // MARK: Flow

    private var flow: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    Text(question)
                        .yardDisplay(40)
                        .foregroundStyle(Color.yard.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    stepContent
                        .id(model.step)
                        .transition(.asymmetric(
                            insertion: reduceMotion ? .opacity : .move(edge: .trailing).combined(with: .opacity),
                            removal: .opacity
                        ))
                    if let problem = model.problem {
                        Label(problem, systemImage: "exclamationmark.circle.fill")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let refusal = model.refusal {
                        refusalCard(refusal)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                .padding(.top, Spacing.l)
                .padding(.bottom, Spacing.xxl)
                .animation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion), value: model.step)
            }
            .scrollDismissesKeyboard(.interactively)
            footer
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            HStack(spacing: Spacing.s) {
                GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close", size: 40) {
                    Haptics.impact(.light)
                    onClose()
                }
                if model.step != .name {
                    GlassIconButton(systemImage: "chevron.left", accessibilityLabel: "Back", size: 40) {
                        Haptics.selection()
                        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { model.back() }
                    }
                }
                Spacer()
                Text("\(model.step.index + 1) of \(SellerApplicationForm.Step.count)")
                    .font(.yardCaptionEmphasis)
                    .monospacedDigit()
                    .foregroundStyle(Color.yard.ink2)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.yard.surface2)
                    Capsule()
                        .fill(Color.yard.studio)
                        .frame(width: max(8, geo.size.width * model.progress))
                }
            }
            .frame(height: 6)
            .animation(Motion.resolved(.spring(response: 0.5, dampingFraction: 0.8), reduceMotion: reduceMotion), value: model.progress)
            .accessibilityElement()
            .accessibilityLabel(Text("Step \(model.step.index + 1) of \(SellerApplicationForm.Step.count)"))
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
    }

    private var question: String {
        switch model.step {
        case .name: return "What's your shop called?"
        case .link: return "Where can Yard see your work?"
        case .category: return "What do you sell?"
        case .location: return "Where are you based?"
        case .submit: return "Ready to send?"
        }
    }

    @ViewBuilder
    private var stepContent: some View {
        switch model.step {
        case .name: nameStep
        case .link: linkStep
        case .category: categoryStep
        case .location: locationStep
        case .submit: submitStep
        }
    }

    private var footer: some View {
        VStack(spacing: Spacing.s) {
            if model.step == .submit {
                SlideToConfirm("Slide to submit", systemImage: "paperplane.fill", isLoading: model.submitting) {
                    Task { @MainActor in
                        let ok = await model.submit()
                        if !ok { Haptics.error() }
                    }
                }
            } else {
                Button {
                    advance()
                } label: {
                    HStack(spacing: Spacing.s) {
                        Text("Continue").font(.yardBodyEmphasis)
                        Image(systemName: "arrow.right").font(.system(size: 15, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 56)
                }
                .buttonStyle(YardPillButtonStyle(style: .inverted))
            }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.top, Spacing.s)
        .padding(.bottom, Spacing.s)
        .yardGlassBar()
    }

    private func advance() {
        withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) {
            if model.next() {
                Haptics.impact(.light)
            } else {
                Haptics.error()
            }
        }
    }

    // MARK: Steps

    private var nameStep: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            TextField("Your shop's name", text: $model.form.brandName)
                .font(.system(size: 28, weight: .bold))
                .foregroundStyle(Color.yard.ink)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()
                .submitLabel(.next)
                .focused($focused)
                .onSubmit { advance() }
                .padding(Spacing.l)
                .yardCard()
                .onAppear { focused = true }
            labelPreview
        }
    }

    /// The live label: the name set in Yard's display face, as it will read on the shop.
    private var labelPreview: some View {
        let name = model.form.trimmedName
        return VStack(alignment: .leading, spacing: Spacing.s) {
            HStack {
                Circle().fill(Color.yard.acid).frame(width: 10, height: 10)
                Text("YARD").font(.yardMicro).tracking(2).foregroundStyle(Color.yard.onPhoto.opacity(0.7))
                Spacer()
                Text("NEW SHOP").font(.yardMicro).tracking(1).foregroundStyle(Color.yard.acid)
            }
            Text(name.isEmpty ? "Your shop" : name)
                .yardDisplay(46)
                .foregroundStyle(name.isEmpty ? Color.yard.onPhoto.opacity(0.35) : Color.yard.onPhoto)
                .lineLimit(2)
                .minimumScaleFactor(0.6)
                .contentTransition(.interpolate)
            Text("yardstore.space/brands/\(SellerApplicationForm.handlePreview(name))")
                .font(.yardCaption.monospaced())
                .foregroundStyle(Color.yard.onPhoto.opacity(0.6))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.yard.scrim, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Radius.card, style: .continuous).strokeBorder(Color.yard.glassEdge, lineWidth: 0.75))
        .rotation3DEffect(.degrees(reduceMotion ? 0 : -4), axis: (x: 1, y: 0, z: 0))
        .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: name)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text("Preview: \(name.isEmpty ? "Your shop" : name)"))
    }

    private var linkStep: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Add one or both. Yard's team looks at them to review your shop.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            field("Instagram, like @yourshop", text: $model.form.instagram, icon: "at", keyboard: .twitter)
            field("Website, like yourshop.com", text: $model.form.website, icon: "globe", keyboard: .URL)
            if model.form.hasWebsite {
                HStack(alignment: .top, spacing: Spacing.m) {
                    Image(systemName: "sparkle.magnifyingglass")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(Color.yard.studio)
                    Text("Yard will scan your website so reviewers see your products ready. Nothing is created or published by the scan.")
                        .font(.yardCallout)
                        .foregroundStyle(Color.yard.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(Spacing.l)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.yard.studio.opacity(0.12), in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
                .transition(.opacity.combined(with: .scale(scale: 0.97)))
            }
        }
        .animation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion), value: model.form.hasWebsite)
    }

    private func field(_ placeholder: String, text: Binding<String>, icon: String, keyboard: UIKeyboardType) -> some View {
        HStack(spacing: Spacing.m) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.yard.ink2)
                .frame(width: 24)
            TextField(placeholder, text: text)
                .font(.yardBody)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .padding(.horizontal, Spacing.l)
        .frame(height: 56)
        .yardCard()
    }

    private var categoryStep: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Pick the one that fits most of what you sell.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
            if model.categoriesLoading && model.categories.isEmpty {
                WelcomeFlowLayout(spacing: Spacing.s) {
                    ForEach(0..<8, id: \.self) { i in
                        Skeleton(cornerRadius: 18, shape: .capsule)
                            .frame(width: CGFloat(80 + (i % 3) * 30), height: 40)
                    }
                }
            } else if let error = model.categoriesError, model.categories.isEmpty {
                EmptyState.error(message: error) { await model.loadCategories() }
            } else {
                WelcomeFlowLayout(spacing: Spacing.s) {
                    ForEach(model.categories) { category in
                        Chip(category.name, isSelected: model.form.category == category.slug) {
                            Haptics.selection()
                            withAnimation(Motion.resolved(Motion.snappy, reduceMotion: reduceMotion)) {
                                model.form.category = category.slug
                                model.problem = nil
                            }
                        }
                    }
                }
            }
        }
    }

    private var locationStep: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            field("City", text: $model.form.city, icon: "mappin.and.ellipse", keyboard: .default)
                .textInputAutocapitalization(.words)
            VStack(alignment: .leading, spacing: Spacing.s) {
                Text("Country")
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink2)
                Text("Your prices and payouts use its currency.")
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                WelcomeFlowLayout(spacing: Spacing.s) {
                    ForEach(SellerApplicationForm.countries, id: \.self) { code in
                        Chip(Self.countryName(code), isSelected: model.form.country == code) {
                            Haptics.selection()
                            model.form.country = code
                        }
                    }
                }
            }
        }
    }

    private var submitStep: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Yard reviews every shop. You can add products while you wait; they go live once you're approved.")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
            VStack(spacing: 0) {
                summaryRow("Shop", model.form.trimmedName, step: .name)
                summaryRow("Instagram", model.form.instagram.isEmpty ? "–" : model.form.instagram, step: .link)
                summaryRow("Website", model.form.website.isEmpty ? "–" : model.form.website, step: .link)
                summaryRow("Category", categoryName, step: .category)
                summaryRow("Based in", "\(model.form.trimmedCity), \(Self.countryName(model.form.country))", step: .location)
            }
            .padding(.vertical, Spacing.xs)
            .yardCard()
        }
    }

    private var categoryName: String {
        guard let slug = model.form.category else { return "–" }
        return model.categories.first { $0.slug == slug }?.name ?? slug
    }

    private func summaryRow(_ title: String, _ value: String, step: SellerApplicationForm.Step) -> some View {
        Button {
            Haptics.selection()
            withAnimation(Motion.resolved(Motion.spring, reduceMotion: reduceMotion)) { model.step = step }
        } label: {
            HStack(spacing: Spacing.m) {
                Text(title)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .frame(width: 92, alignment: .leading)
                Text(value)
                    .font(.yardBodyEmphasis)
                    .foregroundStyle(Color.yard.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: "pencil")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.yard.ink3)
            }
            .padding(.horizontal, Spacing.l)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(Text("Edit"))
    }

    private func refusalCard(_ refusal: SellerApplicationModel.Refusal) -> some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(refusal.message)
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
            switch refusal.action {
            case .openWebsite:
                YardButton("Open the website", systemImage: "safari", style: .secondary, size: .medium) {
                    webPage = YouWebPage(url: Config.webURL("/studio/onboarding"))
                }
            case .openStudio:
                YardButton("Open Studio", systemImage: "storefront", style: .primary, size: .medium) {
                    Task { @MainActor in
                        await session.refresh()
                        studio.enterStudio()
                        onClose()
                    }
                }
            case .none:
                EmptyView()
            }
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .yardCard()
    }

    // MARK: Done

    private func celebration(_ result: StudioApplyResult) -> some View {
        let name = result.application.brand?.name ?? model.form.trimmedName
        return ZStack {
            VStack(spacing: Spacing.xl) {
                Spacer()
                Image(systemName: "checkmark")
                    .font(.system(size: 44, weight: .black))
                    .foregroundStyle(Color.yard.onAcid)
                    .frame(width: 112, height: 112)
                    .background(Color.yard.acid, in: Circle())
                    .shadow(color: Color.yard.acid.opacity(0.45), radius: 30)
                    .symbolEffect(.bounce, value: reduceMotion ? 0 : 1)
                    .accessibilityHidden(true)
                VStack(spacing: Spacing.m) {
                    Text("You're on the list.")
                        .yardDisplay(52)
                        .foregroundStyle(Color.yard.ink)
                        .multilineTextAlignment(.center)
                        .accessibilityAddTraits(.isHeader)
                    Text("We'll review \(name) and let you know.")
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink2)
                        .multilineTextAlignment(.center)
                    if result.websiteScan?.status == "started" {
                        Text("We're scanning your website so your products are ready for review.")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink3)
                            .multilineTextAlignment(.center)
                    }
                }
                .padding(.horizontal, Spacing.gutter)
                Spacer()
                YardButton("Done") { finish() }
                    .padding(.horizontal, Spacing.gutter)
                    .padding(.bottom, Spacing.l)
            }
            ConfettiView()
                .ignoresSafeArea()
        }
        .onAppear { Haptics.success() }
    }

    private func waitingView(_ application: StudioApplication) -> some View {
        VStack(spacing: Spacing.l) {
            Spacer()
            Image(systemName: "hourglass")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(Color.yard.onPhoto)
                .frame(width: 100, height: 100)
                .background(Color.yard.studio, in: Circle())
                .accessibilityHidden(true)
            Text("You're already on the list")
                .yardDisplay(44)
                .foregroundStyle(Color.yard.ink)
                .multilineTextAlignment(.center)
            Text("Yard is reviewing \(application.brand?.name ?? "your shop"). We'll let you know.")
                .font(.yardBody)
                .foregroundStyle(Color.yard.ink2)
                .multilineTextAlignment(.center)
            Spacer()
            YardButton("Done") { finish() }
        }
        .padding(.horizontal, Spacing.gutter)
        .padding(.bottom, Spacing.l)
    }

    /// Back to shopping with the pending shop on the You tab.
    private func finish() {
        Haptics.impact(.light)
        studio.rememberMode(.shopping)
        Task { @MainActor in
            await session.refresh()
            onClose()
        }
    }

    static func countryName(_ code: String) -> String {
        Locale.current.localizedString(forRegionCode: code) ?? code
    }
}

#Preview("Application — dark") {
    NavigationStack { SellerApplicationView(onClose: {}) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Application — light") {
    NavigationStack { SellerApplicationView(onClose: {}) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
