package space.yardstore.app.features.you

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Email
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.yard

// Account sheets opened from Settings (mirrors YouAccountSheets.swift):
//   YouAccountDetailsSheet   name + email (read-only: the API has no profile-update endpoint yet)
//   YouChangePasswordSheet   POST /api/auth/password/change?as=shopper { currentPassword?, newPassword }
//   YouDeleteAccountSheet    POST /api/auth/reauth?as=shopper { password } when needed, then
//                            POST /api/auth/account/delete { confirm: "DELETE" }
// Delete is an irreversible destructive action, so it gets a modal confirmation.

// MARK: - Your details

@Composable
fun YouAccountDetailsSheet(security: YouSecurity?, onHelp: () -> Unit, onDismiss: () -> Unit) {
    val session = LocalSessionStore.current
    YouSheet(onDismiss = onDismiss, skipPartiallyExpanded = false) { close ->
        YardSheetHeader("Your details", subtitle = "Your name goes on your orders.", onClose = close)
        Column(
            Modifier
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.s, bottom = Spacing.xl)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(Spacing.l),
        ) {
            Card(padding = Spacing.xs) {
                SettingsRow("Name", Icons.Outlined.Person, value = session.shopper?.name ?: "", showsChevron = false)
                SettingsRow("Email", Icons.Outlined.Email, value = session.shopper?.email ?: "", showsChevron = false)
                if (security != null && !security.demo) {
                    SettingsRow(
                        "Email verified",
                        if (security.emailVerified) Icons.Outlined.Verified else Icons.Outlined.ErrorOutline,
                        value = if (security.emailVerified) "Yes" else "Not yet",
                        showsChevron = false,
                    )
                }
            }
            Text(youManagedNote(security), style = YardFonts.caption, color = Color.yard.ink3)
            YardButton("Contact support", icon = Icons.AutoMirrored.Outlined.HelpOutline, style = YardButtonStyle.Secondary, size = YardButtonSize.Medium) {
                close()
                onHelp()
            }
        }
    }
}

private fun youManagedNote(security: YouSecurity?): String =
    if (security != null && !security.hasPassword && security.identities.any { it.provider == "google" })
        "Signed in with Google. Change this email in your Google account. To change your name, contact support."
    else
        "Changing your name or email isn't available in the app yet. Contact support and we'll update it for you."

// MARK: - Change password

/** Client-side checks before POST /api/auth/password/change (field name → message). */
internal fun youPasswordErrors(hasPassword: Boolean, current: String, newPassword: String, confirm: String): Map<String, String> {
    val next = mutableMapOf<String, String>()
    if (hasPassword && current.isEmpty()) next["currentPassword"] = "Enter your password."
    if (newPassword.length < 10) next["newPassword"] = "Use at least 10 characters."
    else if (newPassword.length > 200) next["newPassword"] = "Keep it to 200 characters."
    if (confirm != newPassword) next["confirm"] = "The passwords don't match."
    return next
}

@Serializable
private data class YouChangePasswordBody(val currentPassword: String? = null, val newPassword: String)

@Composable
fun YouChangePasswordSheet(hasPassword: Boolean, onChanged: () -> Unit, onDismiss: () -> Unit) {
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    var current by rememberSaveable { mutableStateOf("") }
    var newPassword by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var formError by remember { mutableStateOf<String?>(null) }
    var isSaving by remember { mutableStateOf(false) }

    YouSheet(onDismiss = onDismiss, presentAsDialogOnWide = true, canDismiss = { !isSaving }) { close ->
        fun save() {
            val next = youPasswordErrors(hasPassword, current, newPassword, confirm)
            errors = next
            formError = null
            if (next.isNotEmpty()) return

            isSaving = true
            scope.launch {
                try {
                    val body = YouChangePasswordBody(currentPassword = if (hasPassword) current else null, newPassword = newPassword)
                    APIClient.shared.send(HTTPMethod.POST, "/api/auth/password/change", body = body, query = youAsShopper)
                    haptics.performHapticFeedback(HapticFeedbackType.Confirm)
                    toast.show(if (hasPassword) "Password changed." else "Password set.", Toast.Style.Success)
                    onChanged()
                    close()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: APIError) {
                    if (e.isCancelled) return@launch
                    when {
                        e.youNeedsReauth -> formError = "For your security, sign out and sign back in with Google, then set a password within 5 minutes."
                        e.fields.isNotEmpty() -> {
                            errors = e.fields
                            if (e.fields["currentPassword"] == null && e.fields["newPassword"] == null) formError = e.message
                        }
                        else -> formError = e.message
                    }
                } catch (e: Exception) {
                    formError = APIError.messageFor(e)
                } finally {
                    isSaving = false
                }
            }
        }

        Column(Modifier.verticalScroll(rememberScrollState()).imePadding()) {
            YardSheetHeader(
                if (hasPassword) "Change password" else "Set a password",
                subtitle = "Use at least 10 characters. Your other sessions end when it changes.",
                onClose = { if (!isSaving) close() },
            )
            Column(
                Modifier
                    .padding(horizontal = Spacing.gutter)
                    .padding(top = Spacing.s, bottom = Spacing.xl)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                if (hasPassword) {
                    YouTextField("Current password", current, { current = it }, isSecure = true, error = errors["currentPassword"])
                }
                YouTextField("New password", newPassword, { newPassword = it }, isSecure = true, error = errors["newPassword"])
                YouTextField("Confirm new password", confirm, { confirm = it }, isSecure = true, error = errors["confirm"])
                formError?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
                YardButton(
                    if (hasPassword) "Change password" else "Set password",
                    isLoading = isSaving,
                    enabled = newPassword.isNotEmpty() && (!hasPassword || current.isNotEmpty()),
                ) { save() }
            }
        }
    }
}

// MARK: - Delete account

/** The delete route needs a re-auth within 10 minutes: a password account confirms with its password. */
internal fun youDeleteNeedsPassword(security: YouSecurity?): Boolean =
    security?.let { it.hasPassword && !it.isRecentlyConfirmed(600) } ?: true

/** An OAuth-only account with no recent re-auth can't confirm in the app. */
internal fun youDeleteCannotConfirm(security: YouSecurity?): Boolean =
    security?.let { !it.hasPassword && !it.isRecentlyConfirmed(600) } ?: false

internal fun youCanSubmitDelete(security: YouSecurity?, confirmText: String, password: String): Boolean =
    confirmText.trim().uppercase() == "DELETE" && (!youDeleteNeedsPassword(security) || password.isNotEmpty())

@Serializable
private data class YouDeleteBody(val confirm: String)

@Composable
fun YouDeleteAccountSheet(security: YouSecurity?, onDeleted: () -> Unit, onDismiss: () -> Unit) {
    val scope = rememberCoroutineScope()

    var confirmText by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }
    var formError by remember { mutableStateOf<String?>(null) }
    var isDeleting by remember { mutableStateOf(false) }

    val needsPassword = youDeleteNeedsPassword(security)
    val cannotConfirm = youDeleteCannotConfirm(security)
    val canSubmit = youCanSubmitDelete(security, confirmText, password) && !isDeleting

    YouSheet(onDismiss = onDismiss, presentAsDialogOnWide = true, canDismiss = { !isDeleting }) { close ->
        fun delete() {
            if (!canSubmit) return
            passwordError = null
            formError = null
            isDeleting = true
            scope.launch {
                try {
                    if (needsPassword) {
                        APIClient.shared.send(HTTPMethod.POST, "/api/auth/reauth", body = YouReauthBody(password), query = youAsShopper)
                    }
                    APIClient.shared.send(HTTPMethod.POST, "/api/auth/account/delete", body = YouDeleteBody(confirm = "DELETE"))
                    isDeleting = false
                    close()
                    // Refresh, pop to You and toast happen in the caller's scope: this sheet's
                    // scope is cancelled as soon as it leaves the composition.
                    onDeleted()
                } catch (e: CancellationException) {
                    throw e
                } catch (e: APIError) {
                    if (e.isCancelled) return@launch
                    val p = e.fields["password"]
                    val c = e.fields["confirm"]
                    when {
                        p != null -> passwordError = p
                        e.youNeedsReauth -> formError = if (security?.hasPassword == true)
                            "Confirm with your password and try again."
                        else
                            "Sign out and sign back in with Google or Apple, then delete your account within 10 minutes."
                        c != null -> formError = c
                        else -> formError = e.message
                    }
                } catch (e: Exception) {
                    formError = APIError.messageFor(e)
                } finally {
                    isDeleting = false
                }
            }
        }

        Column(Modifier.verticalScroll(rememberScrollState()).imePadding()) {
            YardSheetHeader("Delete account", onClose = { if (!isDeleting) close() })
            Column(
                Modifier
                    .padding(horizontal = Spacing.gutter)
                    .padding(top = Spacing.s, bottom = Spacing.xl)
                    .navigationBarsPadding(),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                Card {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                            Icon(Icons.Filled.Warning, contentDescription = null, tint = Color.yard.danger, modifier = Modifier.size(20.dp))
                            Text("This can't be undone", style = YardFonts.headline, color = Color.yard.danger)
                        }
                        Text(
                            "Your account is closed and every session ends at once. Your name, email, saved pieces, follows and messages are then erased. Orders brands still need to fulfil are kept without your details.",
                            style = YardFonts.callout,
                            color = Color.yard.ink2,
                        )
                    }
                }

                if (security?.demo == true) {
                    Text("Demo accounts can't be deleted.", style = YardFonts.callout, color = Color.yard.ink2)
                } else {
                    if (cannotConfirm) {
                        Text(
                            "To confirm it's you, sign out and sign back in with Google or Apple, then delete your account within 10 minutes.",
                            style = YardFonts.callout,
                            color = Color.yard.ink2,
                        )
                    }
                    if (needsPassword) {
                        YouTextField("Your password", password, { password = it }, isSecure = true, error = passwordError)
                    }
                    YouTextField("Type DELETE to confirm", confirmText, { confirmText = it })
                    formError?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }
                    YardButton(
                        "Delete my account",
                        icon = Icons.Outlined.Delete,
                        style = YardButtonStyle.Destructive,
                        isLoading = isDeleting,
                        enabled = canSubmit,
                    ) { delete() }
                }
                YardButton("Keep my account", style = YardButtonStyle.Ghost, size = YardButtonSize.Medium, enabled = !isDeleting) { close() }
            }
        }
    }
}

// Sheets are ModalBottomSheets (their own window), so previews show their content in a column.

@Preview(name = "Delete account — dark")
@Composable
private fun DeleteAccountDark() = YardPreview(darkTheme = true) {
    Column(Modifier.fillMaxWidth()) { YouDeleteAccountSheet(security = null, onDeleted = {}, onDismiss = {}) }
}

@Preview(name = "Change password — light")
@Composable
private fun ChangePasswordLight() = YardPreview(darkTheme = false) {
    Column(Modifier.fillMaxWidth()) { YouChangePasswordSheet(hasPassword = true, onChanged = {}, onDismiss = {}) }
}
