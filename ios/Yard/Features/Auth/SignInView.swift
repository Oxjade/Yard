import SwiftUI
import SafariServices

/// Sign in or join (presented as a sheet by `router.present(.signIn)`, or pushed).
///
/// - "Continue with Google" (and any other provider the server lists at GET /api/auth/providers)
///   → POST /api/auth/oauth/{provider}/start → in-app web sheet → /auth/complete (AuthWebSheet).
///   After a social sign-in the shopper picks "I’m here to shop" / "I want to sell on Yard"
///   (the website's /auth/complete choice; selling opens /studio/onboarding in Safari).
/// - Email + password: POST /api/auth/sign-in (handles `verify_email`).
/// - Create account: POST /api/auth/sign-up → "check your email".
/// - "Email me a sign-in link": POST /api/auth/magic-link. "Forgot password?": POST /api/auth/password/forgot.
/// - On success: `session.didSignIn()`, then Welcome (first time on this device) or close.
@MainActor
struct SignInView: View {
    init() {}

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @AppStorage(AuthOnboarding.onboardedKey) private var onboarded: Bool = false

    @State private var model: SignInModel = SignInModel()
    @State private var showWelcome: Bool = false
    /// True from a successful sign-in until the sheet closes (hides the "already signed in" panel).
    @State private var justSignedIn: Bool = false
    @State private var signingOut: Bool = false
    @State private var signedInTick: Int = 0
    /// After a social sign-in: "What brings you to Yard?" (shop / sell).
    @State private var showIntentChoice: Bool = false
    /// The seller application (/studio/onboarding) in Safari, from the shop / sell choice.
    @State private var showSellOnboarding: Bool = false
    @FocusState private var focus: SignInModel.Field?

    fileprivate init(model: SignInModel) {
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.xl) {
                header
                if showIntentChoice {
                    intentChoice
                } else if session.isSignedIn && !justSignedIn {
                    signedInPanel
                } else if justSignedIn {
                    statusLine("Signed in. Taking you there now.")
                } else if let sentTo = model.signUpSentTo {
                    signUpSentPanel(sentTo)
                } else {
                    socialSection
                    formCard
                    modeSwitch
                }
            }
            .padding(.horizontal, Spacing.gutter)
            .padding(.top, Spacing.l)
            .padding(.bottom, Spacing.xxxl)
            .animation(Motion.spring, value: model.mode)
            .animation(Motion.spring, value: model.signUpSentTo)
        }
        .scrollDismissesKeyboard(.interactively)
        .yardScreenBackground()
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if router.sheet != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    GlassIconButton(systemImage: "xmark", accessibilityLabel: "Close", size: 34) { close() }
                }
            }
        }
        .navigationDestination(isPresented: $showWelcome) {
            WelcomeView()
        }
        .onChange(of: showWelcome) { _, isShowing in
            // Welcome closed itself (pushed case): leave sign-in too.
            if !isShowing && justSignedIn { close() }
        }
        .fullScreenCover(isPresented: $showSellOnboarding) {
            SignInSafariView(url: Config.webURL(signInSellOnboardingPath))
                .ignoresSafeArea()
        }
        .sheet(item: $model.webFlow) { flow in
            AuthWebSheet(flow: flow) { outcome in
                handleWebOutcome(outcome)
            }
        }
        .sensoryFeedback(.success, trigger: signedInTick)
        .task {
            await model.loadProviders()
        }
    }

    // MARK: Sections

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            YardLogo(color: colorScheme == .dark ? Color.yard.acid : Color.yard.ink)
                .frame(height: 40)
                .frame(maxWidth: 110, alignment: .leading)
                .accessibilityLabel(Text("Yard"))
            Text(titleText)
                .yardDisplay(44)
                .foregroundStyle(Color.yard.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(bodyText)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, Spacing.s)
    }

    private var titleText: String {
        if showIntentChoice { return "You're signed in" }
        if session.isSignedIn && !justSignedIn { return "You're signed in" }
        if model.signUpSentTo != nil { return "Check your email" }
        return model.mode == .signUp ? "Create your account" : "Sign in or join"
    }

    private var bodyText: String {
        if showIntentChoice { return "Your account is connected." }
        if let shopper = session.shopper, !justSignedIn {
            let demo = shopper.demo ? " This is the shared demo shopper account." : ""
            return "Signed in as \(shopper.name), \(shopper.email).\(demo)"
        }
        return "One account for every brand: follow studios, save pieces, get drop alerts and track each brand's order from one place."
    }

    @ViewBuilder
    private var socialSection: some View {
        let buttons = model.socialButtons
        let showDemo = model.demoEnabled
        if !model.providersLoaded {
            VStack(spacing: Spacing.m) {
                Skeleton(shape: .capsule).frame(height: YardButton.Size.large.height)
                AuthDividerLabel(text: "or with email")
            }
        } else if !buttons.isEmpty || showDemo {
            VStack(spacing: Spacing.m) {
                if showDemo {
                    YardButton("Continue as demo shopper", style: .secondary, isLoading: model.busy == .demo) {
                        Task { @MainActor in
                            if await model.signInDemo() { await completeSignIn(social: false) }
                        }
                    }
                    .disabled(model.busy != nil && model.busy != .demo)
                }
                ForEach(buttons) { button in
                    AuthSocialButtonView(button: button, isLoading: model.busy == .social(button.key)) {
                        Task { @MainActor in await model.startSocial(button) }
                    }
                    .disabled(model.busy != nil && model.busy != .social(button.key))
                }
                AuthDividerLabel(text: "or with email")
            }
        }
    }

    private var formCard: some View {
        Card(padding: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if model.mode == .signUp {
                    AuthTextField(label: "Name", text: $model.name, error: model.nameError, contentType: .name, capitalization: .words)
                        .focused($focus, equals: .name)
                        .submitLabel(.next)
                        .onSubmit { focus = .email }
                        .onChange(of: model.name) { _, _ in model.revalidate(.name) }
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                VStack(alignment: .leading, spacing: Spacing.xs) {
                    AuthTextField(label: "Email", text: $model.email, error: model.emailError, contentType: .emailAddress, keyboard: .emailAddress)
                        .focused($focus, equals: .email)
                        .submitLabel(.next)
                        .onSubmit { focus = .password }
                        .onChange(of: model.email) { _, _ in model.revalidate(.email) }
                    if model.mode == .signIn && model.magicLinkEnabled {
                        AuthTextLink(model.busy == .magic ? "Sending sign-in link…" : "Email me a sign-in link") {
                            Task { @MainActor in await model.requestMagicLink(focus: setFocus) }
                        }
                        .disabled(model.busy != nil)
                    }
                }

                AuthPasswordField(
                    label: "Password",
                    text: $model.password,
                    error: model.passwordError,
                    isNewPassword: model.mode == .signUp,
                    isRevealed: $model.isPasswordRevealed
                )
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit { submit() }
                .onChange(of: model.password) { _, _ in model.revalidate(.password) }

                YardButton(
                    model.mode == .signUp ? "Create account" : "Sign in",
                    isLoading: model.busy == .email || model.busy == .signUp
                ) {
                    submit()
                }
                .disabled(model.busy != nil && model.busy != .email && model.busy != .signUp)

                if model.mode == .signIn {
                    AuthTextLink(model.busy == .forgot ? "Sending reset link…" : "Forgot password?") {
                        Task { @MainActor in await model.requestPasswordReset(focus: setFocus) }
                    }
                    .disabled(model.busy != nil)
                    .frame(maxWidth: .infinity)
                }

                if let failure = model.failure {
                    Label {
                        Text(failure)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "exclamationmark.circle")
                    }
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.danger)
                    .accessibilityAddTraits(.isStaticText)
                }
                if let notice = model.notice {
                    Label {
                        Text(notice)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "envelope")
                    }
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                }
                if model.demoEnabled {
                    Text("Demo sign-in uses the shared shopper account; email sign-in creates or opens your own account.")
                        .font(.yardCaption)
                        .foregroundStyle(Color.yard.ink3)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var modeSwitch: some View {
        AuthTextLink(model.mode == .signUp ? "I already have an account" : "Create an account") {
            withAnimation(Motion.spring) { model.toggleMode() }
            focus = nil
        }
        .frame(maxWidth: .infinity)
    }

    private func signUpSentPanel(_ email: String) -> some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            Card {
                HStack(alignment: .top, spacing: Spacing.m) {
                    Image(systemName: "envelope.badge")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Color.yard.onAcid)
                        .frame(width: 40, height: 40)
                        .background(Color.yard.acid, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    Text("We sent a verification link to \(email). Open it to finish creating your account.")
                        .font(.yardBody)
                        .foregroundStyle(Color.yard.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            YardButton("Back to sign in", style: .secondary) {
                withAnimation(Motion.spring) { model.backToSignIn() }
            }
        }
    }

    private var signedInPanel: some View {
        VStack(spacing: Spacing.m) {
            YardButton("Continue") { close() }
            YardButton("Sign out", style: .secondary, isLoading: signingOut) {
                Task { @MainActor in
                    signingOut = true
                    await session.signOut()
                    signingOut = false
                    toast.show("Signed out", style: .info)
                }
            }
        }
    }

    /// The website's choice after a social sign-in (auth-oauth-completion.tsx): "What brings you to
    /// Yard?" — shop (Welcome or close) or sell (the seller application in Safari).
    private var intentChoice: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("What brings you to Yard?")
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink)
            intentCard(
                title: "I’m here to shop",
                body: "Discover independent brands, follow them and catch their drops."
            ) {
                if onboarded {
                    close()
                } else {
                    showWelcome = true
                }
            }
            intentCard(
                title: "I want to sell on Yard",
                body: "Apply with your brand, set up your storefront and start selling. You can still shop with this account."
            ) {
                showSellOnboarding = true
            }
        }
    }

    private func intentCard(title: String, body: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.yardHeadline)
                    .foregroundStyle(Color.yard.ink)
                Text(body)
                    .font(.yardCallout)
                    .foregroundStyle(Color.yard.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(Spacing.l)
            .yardCard()
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableButtonStyle())
        .accessibilityHint(Text(body))
    }

    private func statusLine(_ text: String) -> some View {
        HStack(spacing: Spacing.s) {
            ProgressView().tint(Color.yard.ink)
            Text(text)
                .font(.yardCallout)
                .foregroundStyle(Color.yard.ink2)
        }
        .padding(Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .yardCard()
    }

    // MARK: Actions

    private func setFocus(_ field: SignInModel.Field) {
        focus = field
    }

    private func submit() {
        Task { @MainActor in
            if await model.submit(focus: setFocus) {
                await completeSignIn(social: false)
            }
        }
    }

    private func handleWebOutcome(_ outcome: AuthWebOutcome) {
        let signedIn = model.finishSocial(outcome)
        guard signedIn else { return }
        Task { @MainActor in await completeSignIn(social: true) }
    }

    /// The server says signed in: re-read the session, confirm a shopper is there, then go on.
    /// A social sign-in first asks "What brings you to Yard?" (as the website does), so a brand
    /// signing in with Google isn't left in a shopper account with no way to start selling.
    private func completeSignIn(social: Bool) async {
        focus = nil
        await session.didSignIn()
        guard let shopper = session.shopper else {
            model.reportUnconfirmedSignIn()
            return
        }
        justSignedIn = true
        signedInTick += 1
        if social && !shopper.demo {
            showIntentChoice = true
        } else if onboarded {
            close()
        } else {
            showWelcome = true
        }
    }

    private func close() {
        if router.sheet != nil {
            router.dismissSheet()
        } else {
            dismiss()
        }
    }
}

/// The website's seller application (opened in Safari from the shop / sell choice).
private let signInSellOnboardingPath: String = "/studio/onboarding"

/// SFSafariViewController in SwiftUI (the seller application after a social sign-in).
private struct SignInSafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        let controller = SFSafariViewController(url: url)
        controller.dismissButtonStyle = .close
        controller.preferredControlTintColor = UIColor(Color.yard.ink)
        return controller
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

#Preview("SignInView — dark") {
    NavigationStack { SignInView(model: SignInModel(previewProviders: AuthProviders())) }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.dark)
}

#Preview("SignInView — light") {
    NavigationStack { SignInView(model: SignInModel(previewProviders: AuthProviders(demoShopper: true))) }
        .yardPreviewEnvironment(signedIn: false)
        .preferredColorScheme(.light)
}

#Preview("SignInView signed in — dark") {
    NavigationStack { SignInView() }
        .yardPreviewEnvironment(signedIn: true)
        .preferredColorScheme(.dark)
}
