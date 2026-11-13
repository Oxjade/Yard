import SwiftUI

// Account sheets opened from Settings:
//   YouAccountDetailsSheet   name + email (read-only: the API has no profile-update endpoint yet)
//   YouChangePasswordSheet   POST /api/auth/password/change?as=shopper { currentPassword?, newPassword }
//   YouDeleteAccountSheet    POST /api/auth/reauth?as=shopper { password } when needed, then
//                            POST /api/auth/account/delete { confirm: "DELETE" }
// Delete is an irreversible destructive action, so it gets a modal confirmation (AGENTS rule).

// MARK: - Your details

@MainActor
struct YouAccountDetailsSheet: View {
    let security: YouSecurity?
    let onHelp: () -> Void

    @Environment(SessionStore.self) private var session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            YardSheetHeader("Your details", subtitle: "Your name goes on your orders.") { dismiss() }
            VStack(alignment: .leading, spacing: Spacing.l) {
                Card(padding: Spacing.xs) {
                    VStack(spacing: 0) {
                        SettingsRow("Name", systemImage: "person", value: session.shopper?.name ?? "", showsChevron: false)
                        SettingsRow("Email", systemImage: "envelope", value: session.shopper?.email ?? "", showsChevron: false)
                        if let s = security, !s.demo {
                            SettingsRow(
                                "Email verified",
                                systemImage: s.emailVerified ? "checkmark.seal" : "exclamationmark.circle",
                                value: s.emailVerified ? "Yes" : "Not yet",
                                showsChevron: false
                            )
                        }
                    }
                }
                Text(managedNote)
                    .font(.yardCaption)
                    .foregroundStyle(Color.yard.ink3)
                    .fixedSize(horizontal: false, vertical: true)
                YardButton("Contact support", systemImage: "questionmark.circle", style: .secondary, size: .medium) {
                    dismiss()
                    onHelp()
                }
            }
            .padding(.horizontal, Spacing.gutter)
            Spacer(minLength: 0)
        }
        .yardSheet(detents: [.medium, .large])
    }

    private var managedNote: String {
        if let s = security, !s.hasPassword, s.identities.contains(where: { $0.provider == "google" }) {
            return "Signed in with Google. Change this email in your Google account. To change your name, contact support."
        }
        return "Changing your name or email isn't available in the app yet. Contact support and we'll update it for you."
    }
}

// MARK: - Change password

@MainActor
struct YouChangePasswordSheet: View {
    let hasPassword: Bool
    let onChanged: () -> Void

    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss

    @State private var current = ""
    @State private var newPassword = ""
    @State private var confirm = ""
    @State private var errors: [String: String] = [:]
    @State private var formError: String? = nil
    @State private var isSaving = false
    @State private var didSave = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                YardSheetHeader(
                    hasPassword ? "Change password" : "Set a password",
                    subtitle: "Use at least 10 characters. Your other sessions end when it changes."
                ) { dismiss() }
                VStack(alignment: .leading, spacing: Spacing.l) {
                    if hasPassword {
                        YouTextField(title: "Current password", text: $current, isSecure: true, error: errors["currentPassword"], contentType: .password)
                    }
                    YouTextField(title: "New password", text: $newPassword, isSecure: true, error: errors["newPassword"], contentType: .newPassword)
                    YouTextField(title: "Confirm new password", text: $confirm, isSecure: true, error: errors["confirm"], contentType: .newPassword)
                    if let formError {
                        Text(formError)
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    YardButton(hasPassword ? "Change password" : "Set password", isLoading: isSaving) { save() }
                        .disabled(newPassword.isEmpty || (hasPassword && current.isEmpty))
                        .sensoryFeedback(.success, trigger: didSave)
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .padding(.bottom, Spacing.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .yardSheet(detents: [.large])
        .yardToastHost(toast)
    }

    private func save() {
        var next: [String: String] = [:]
        if hasPassword && current.isEmpty { next["currentPassword"] = "Enter your password." }
        if newPassword.count < 10 { next["newPassword"] = "Use at least 10 characters." }
        else if newPassword.count > 200 { next["newPassword"] = "Keep it to 200 characters." }
        if confirm != newPassword { next["confirm"] = "The passwords don't match." }
        errors = next
        formError = nil
        guard next.isEmpty else { return }

        isSaving = true
        Task { @MainActor in
            defer { isSaving = false }
            do {
                let body = YouChangePasswordBody(currentPassword: hasPassword ? current : nil, newPassword: newPassword)
                try await APIClient.shared.send(.post, "/api/auth/password/change", body: body, query: [URLQueryItem(name: "as", value: "shopper")])
                didSave = true
                toast.show(hasPassword ? "Password changed." : "Password set.", style: .success)
                onChanged()
                dismiss()
            } catch let error as APIError {
                if error.isCancelled { return }
                if error.youNeedsReauth {
                    formError = "For your security, sign out and sign back in with Google, then set a password within 5 minutes."
                } else if !error.fields.isEmpty {
                    errors = error.fields
                    if error.fields["currentPassword"] == nil && error.fields["newPassword"] == nil { formError = error.message }
                } else {
                    formError = error.message
                }
            } catch {
                formError = APIError.message(for: error)
            }
        }
    }
}

private struct YouChangePasswordBody: Encodable, Sendable {
    let currentPassword: String?
    let newPassword: String
}

// MARK: - Delete account

@MainActor
struct YouDeleteAccountSheet: View {
    let security: YouSecurity?

    @Environment(SessionStore.self) private var session
    @Environment(Router.self) private var router
    @Environment(ToastCenter.self) private var toast
    @Environment(\.dismiss) private var dismiss

    @State private var confirmText = ""
    @State private var password = ""
    @State private var passwordError: String? = nil
    @State private var formError: String? = nil
    @State private var isDeleting = false

    /// The delete route needs a re-auth within 10 minutes.
    private var needsPassword: Bool {
        guard let s = security else { return true }
        return s.hasPassword && !s.isRecentlyConfirmed(within: 600)
    }

    private var cannotConfirm: Bool {
        guard let s = security else { return false }
        return !s.hasPassword && !s.isRecentlyConfirmed(within: 600)
    }

    private var canSubmit: Bool {
        confirmText.trimmingCharacters(in: .whitespaces).uppercased() == "DELETE" && (!needsPassword || !password.isEmpty) && !isDeleting
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                YardSheetHeader("Delete account") { dismiss() }
                VStack(alignment: .leading, spacing: Spacing.l) {
                    Card {
                        VStack(alignment: .leading, spacing: Spacing.s) {
                            Label("This can't be undone", systemImage: "exclamationmark.triangle.fill")
                                .font(.yardHeadline)
                                .foregroundStyle(Color.yard.danger)
                            Text("Your account is closed and every session ends at once. Your name, email, saved pieces, follows and messages are then erased. Orders brands still need to fulfil are kept without your details.")
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    if security?.demo == true {
                        Text("Demo accounts can't be deleted.")
                            .font(.yardCallout)
                            .foregroundStyle(Color.yard.ink2)
                    } else {
                        if cannotConfirm {
                            Text("To confirm it's you, sign out and sign back in with Google or Apple, then delete your account within 10 minutes.")
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        if needsPassword {
                            YouTextField(title: "Your password", text: $password, isSecure: true, error: passwordError, contentType: .password)
                        }
                        YouTextField(title: "Type DELETE to confirm", text: $confirmText)
                        if let formError {
                            Text(formError)
                                .font(.yardCallout)
                                .foregroundStyle(Color.yard.danger)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        YardButton("Delete my account", systemImage: "trash", style: .destructive, isLoading: isDeleting) { delete() }
                            .disabled(!canSubmit)
                    }
                    YardButton("Keep my account", style: .ghost, size: .medium) { dismiss() }
                }
                .padding(.horizontal, Spacing.gutter)
            }
            .padding(.bottom, Spacing.xl)
        }
        .scrollDismissesKeyboard(.interactively)
        .interactiveDismissDisabled(isDeleting)
        .yardSheet(detents: [.large])
        .yardToastHost(toast)
    }

    private func delete() {
        guard canSubmit else { return }
        passwordError = nil
        formError = nil
        isDeleting = true
        Task { @MainActor in
            defer { isDeleting = false }
            let asShopper = [URLQueryItem(name: "as", value: "shopper")]
            do {
                if needsPassword {
                    try await APIClient.shared.send(.post, "/api/auth/reauth", body: YouReauthBody(password: password), query: asShopper)
                }
                try await APIClient.shared.send(.post, "/api/auth/account/delete", body: YouDeleteBody(confirm: "DELETE"))
                dismiss()
                await session.refresh()
                router.popToRoot(.you)
                toast.show("Your account is being deleted. Every session has ended.", style: .info)
            } catch let error as APIError {
                if error.isCancelled { return }
                if let p = error.fields["password"] {
                    passwordError = p
                } else if error.youNeedsReauth {
                    formError = security?.hasPassword == true
                        ? "Confirm with your password and try again."
                        : "Sign out and sign back in with Google or Apple, then delete your account within 10 minutes."
                } else if let c = error.fields["confirm"] {
                    formError = c
                } else {
                    formError = error.message
                }
            } catch {
                formError = APIError.message(for: error)
            }
        }
    }
}

private struct YouDeleteBody: Encodable, Sendable {
    let confirm: String
}

#Preview("Delete account — dark") {
    Color.clear
        .sheet(isPresented: .constant(true)) { YouDeleteAccountSheet(security: nil) }
        .yardPreviewEnvironment()
        .preferredColorScheme(.dark)
}

#Preview("Change password — light") {
    Color.clear
        .sheet(isPresented: .constant(true)) { YouChangePasswordSheet(hasPassword: true) {} }
        .yardPreviewEnvironment()
        .preferredColorScheme(.light)
}
