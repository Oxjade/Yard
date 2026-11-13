package space.yardstore.app.features.auth

import android.content.SharedPreferences
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import space.yardstore.app.core.Config
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardPillSurface
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard

// Small pieces shared by SignInView and WelcomeView (auth package only). Mirrors AuthComponents.swift.

private val AuthFieldShape = RoundedCornerShape(Radius.small)

/** A labelled text field on `surface2` with an error line under it. */
@Composable
fun AuthTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    imeAction: ImeAction = ImeAction.Next,
    onImeAction: () -> Unit = {},
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(label, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = YardFonts.body.copy(color = Color.yard.ink),
            cursorBrush = SolidColor(Color.yard.ink),
            keyboardOptions = KeyboardOptions(capitalization = capitalization, autoCorrectEnabled = false, keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onImeAction() }),
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
            decorationBox = { inner ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(AuthFieldShape)
                        .background(Color.yard.surface2, AuthFieldShape)
                        .border(1.dp, if (error == null) Color.yard.line else Color.yard.danger, AuthFieldShape)
                        .padding(horizontal = 14.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { inner() }
            },
        )
        AuthFieldError(error)
    }
}

/** A password field with a show/hide eye. */
@Composable
fun AuthPasswordField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    isRevealed: Boolean,
    onRevealedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    error: String? = null,
    imeAction: ImeAction = ImeAction.Go,
    onImeAction: () -> Unit = {},
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(label, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = YardFonts.body.copy(color = Color.yard.ink),
            cursorBrush = SolidColor(Color.yard.ink),
            visualTransformation = if (isRevealed) VisualTransformation.None else PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onImeAction() }),
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = label },
            decorationBox = { inner ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .clip(AuthFieldShape)
                        .background(Color.yard.surface2, AuthFieldShape)
                        .border(1.dp, if (error == null) Color.yard.line else Color.yard.danger, AuthFieldShape)
                        .padding(start = 14.dp, end = 1.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                ) {
                    Box(Modifier.weight(1f)) { inner() }
                    val eyeLabel = if (isRevealed) "Hide password" else "Show password"
                    Box(
                        Modifier
                            .size(48.dp)
                            .semantics { contentDescription = eyeLabel }
                            .pressableClick(pressedScale = 0.9f) { onRevealedChange(!isRevealed) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (isRevealed) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            contentDescription = null,
                            tint = Color.yard.ink2,
                            modifier = Modifier.size(20.dp),
                        )
                    }
                }
            },
        )
        AuthFieldError(error)
    }
}

/** The red line under a field (nothing when null). */
@Composable
fun AuthFieldError(message: String?) {
    AnimatedVisibility(visible = message != null, enter = fadeIn(), exit = fadeOut()) {
        Text(message.orEmpty(), style = YardFonts.caption, color = Color.yard.danger)
    }
}

/** A violet text link ("Forgot password?", "Email me a sign-in link"). */
@Composable
fun AuthTextLink(title: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Text(
        title,
        style = YardFonts.callout.copy(fontWeight = FontWeight.Medium),
        color = Color.yard.violet,
        modifier = modifier
            .alpha(if (enabled) 1f else 0.4f)
            .pressableClick(enabled = enabled, onClick = onClick)
            // 48dp touch target; the text stays centred in it.
            .heightIn(min = 48.dp)
            .wrapContentHeight(Alignment.CenterVertically),
    )
}

/** "—— or with email ——". */
@Composable
fun AuthDividerLabel(text: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Box(Modifier.weight(1f).height(1.dp).background(Color.yard.line))
        Text(text, style = YardFonts.caption, color = Color.yard.ink3, maxLines = 1)
        Box(Modifier.weight(1f).height(1.dp).background(Color.yard.line))
    }
}

/** The Google "G" (the website's GoogleMark path, 24×24 viewBox), drawn in [color]. */
@Composable
fun AuthGoogleMark(color: Color, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val s = minOf(size.width, size.height) / 24f
        val dx = (size.width - 24f * s) / 2f
        val dy = (size.height - 24f * s) / 2f
        translate(dx, dy) {
            scale(s, s, pivot = androidx.compose.ui.geometry.Offset.Zero) {
                drawPath(AuthGoogleMarkPath, color)
            }
        }
    }
}

private const val AUTH_GOOGLE_MARK_DATA = "M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.84 0 3.07.78 3.77 1.45l2.57-2.47C16.73 3.74 14.6 2.8 12 2.8 6.98 2.8 2.9 6.88 2.9 11.9S6.98 21 12 21c5.25 0 8.73-3.69 8.73-8.88 0-.6-.07-1.05-.15-1.5z"
private val AuthGoogleMarkPath = PathParser().parsePathString(AUTH_GOOGLE_MARK_DATA).toPath()

/** A "Continue with …" pill (secondary style) with the provider's mark and a loading state. */
@Composable
fun AuthSocialButtonView(
    button: AuthSocialButton,
    modifier: Modifier = Modifier,
    isLoading: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val fg = YardButtonStyle.Secondary.foreground
    YardPillSurface(
        style = YardButtonStyle.Secondary,
        enabled = enabled,
        modifier = modifier
            .fillMaxWidth()
            .border(1.dp, Color.yard.line, YardShapes.pill)
            .semantics { contentDescription = "Continue with ${button.label}" },
        onClick = { if (!isLoading) onClick() },
    ) {
        Box(
            Modifier.height(YardButtonSize.Large.height).padding(horizontal = Spacing.xl),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                Modifier.alpha(if (isLoading) 0f else 1f),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                when (button.mark) {
                    AuthSocialButton.Mark.Google -> AuthGoogleMark(fg, Modifier.size(18.dp))
                    // No Apple logo in the Material icon set (SF Symbol "apple.logo" on iOS).
                    AuthSocialButton.Mark.Apple -> Icon(Icons.Outlined.PhoneIphone, null, tint = fg, modifier = Modifier.size(19.dp))
                    AuthSocialButton.Mark.Generic -> Icon(Icons.Outlined.AccountCircle, null, tint = fg, modifier = Modifier.size(19.dp))
                }
                Text("Continue with ${button.label}", style = YardFonts.bodyEmphasis, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (isLoading) {
                CircularProgressIndicator(color = fg, strokeWidth = 2.dp, modifier = Modifier.size(20.dp))
            }
        }
    }
}

/**
 * Local onboarding answers (the website keeps these per browser too: `interests`, `aesthetics`,
 * `onboarded` in its session store). Stored in the app's SharedPreferences (`Config.preferences`,
 * file "yard"), the Android stand-in for iOS `@AppStorage`. Other features may read them with the
 * same keys.
 */
object AuthOnboarding {
    /** Boolean: the Welcome flow was finished or skipped on this device. */
    const val ONBOARDED_KEY = "yard.onboarded"
    /** String: comma-separated category slugs picked in Welcome. */
    const val INTERESTS_KEY = "yard.interests"
    /** String: comma-separated looks (aesthetics) picked in Welcome. */
    const val AESTHETICS_KEY = "yard.aesthetics"

    private val prefs: SharedPreferences? get() = Config.preferences

    var onboarded: Boolean
        get() = prefs?.getBoolean(ONBOARDED_KEY, false) ?: false
        set(value) { prefs?.edit()?.putBoolean(ONBOARDED_KEY, value)?.apply() }

    var interests: String
        get() = prefs?.getString(INTERESTS_KEY, "") ?: ""
        set(value) { prefs?.edit()?.putString(INTERESTS_KEY, value)?.apply() }

    var aesthetics: String
        get() = prefs?.getString(AESTHETICS_KEY, "") ?: ""
        set(value) { prefs?.edit()?.putString(AESTHETICS_KEY, value)?.apply() }

    fun split(raw: String): List<String> = raw.split(',').filter { it.isNotEmpty() }

    fun join(values: List<String>): String = values.joinToString(",")
}
