package space.yardstore.app.features.you

import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Undo
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.FolderDelete
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material.icons.outlined.VpnKey
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.serialization.Serializable
import space.yardstore.app.app.LegalPage
import space.yardstore.app.core.Config
import space.yardstore.app.core.WebPages
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.YardSwitch
import space.yardstore.app.designsystem.yard

// Shared pieces for the You feature (profile hub + settings). Mirrors YouSupport.swift. Every
// top-level name is prefixed `You…` so it never clashes with another feature's helpers.

// MARK: - Markets (src/config/markets.ts)

/** A ship-to country, exactly as the website lists them (`countries` in src/config/markets.ts). */
data class YouCountry(
    val code: String,
    val name: String,
    /** The currency the country pays in; the display currency follows it until the shopper picks one. */
    val currency: String,
)

/** A display currency (`currencies` in src/config/markets.ts). */
data class YouCurrency(val code: String, val symbol: String) {
    val label: String get() = "$code $symbol"
}

object YouMarkets {
    val countries: List<YouCountry> = listOf(
        YouCountry("NG", "Nigeria", "NGN"),
        YouCountry("GH", "Ghana", "GHS"),
        YouCountry("KE", "Kenya", "KES"),
        YouCountry("ZA", "South Africa", "ZAR"),
        YouCountry("GB", "United Kingdom", "GBP"),
        YouCountry("FR", "France", "EUR"),
        YouCountry("DE", "Germany", "EUR"),
        YouCountry("US", "United States", "USD"),
        YouCountry("MX", "Mexico", "MXN"),
        YouCountry("JP", "Japan", "JPY"),
        YouCountry("KR", "South Korea", "KRW"),
    )

    val currencies: List<YouCurrency> = listOf(
        YouCurrency("USD", "$"),
        YouCurrency("NGN", "₦"),
        YouCurrency("GBP", "£"),
        YouCurrency("EUR", "€"),
        YouCurrency("GHS", "GH₵"),
        YouCurrency("KES", "KSh"),
        YouCurrency("ZAR", "R"),
        YouCurrency("JPY", "¥"),
        YouCurrency("KRW", "₩"),
        YouCurrency("MXN", "MX$"),
    )

    fun country(code: String?): YouCountry? = code?.let { c -> countries.firstOrNull { it.code == c.uppercase() } }

    fun currency(code: String?): YouCurrency? = code?.let { c -> currencies.firstOrNull { it.code == c.uppercase() } }
}

/**
 * The ship-to country lives here (CartStore only keeps it in memory), in the app's shared
 * preferences (`Config.preferences`). Anyone may call [restore] at launch.
 */
object YouRegion {
    /** Key of the ship-to country code ("NG", "US", …). */
    const val SHIP_TO_KEY = "yard.shipTo"
    /** True once the shopper picked a currency themselves (then it no longer follows the country). */
    const val CURRENCY_CHOSEN_KEY = "yard.currencyChosen"

    val storedShipTo: String? get() = Config.preferences?.getString(SHIP_TO_KEY, null)

    val currencyChosen: Boolean get() = Config.preferences?.getBoolean(CURRENCY_CHOSEN_KEY, false) ?: false

    /** Changes the ship-to country; the currency follows it unless the shopper chose one (site rule). */
    suspend fun setShipTo(country: YouCountry, cart: CartStore) {
        Config.preferences?.edit()?.putString(SHIP_TO_KEY, country.code)?.apply()
        cart.destinationCountry = country.code
        if (!currencyChosen && cart.currency != country.currency) {
            cart.setCurrency(country.currency)
        } else {
            cart.load()
        }
    }

    /** The shopper's own currency choice: from now on it no longer follows the country. */
    suspend fun setCurrency(currency: YouCurrency, cart: CartStore) {
        Config.preferences?.edit()?.putBoolean(CURRENCY_CHOSEN_KEY, true)?.apply()
        cart.setCurrency(currency.code)
    }

    /** Fills `cart.destinationCountry` from the stored choice when nothing set it yet. */
    fun restore(cart: CartStore) {
        val code = storedShipTo
        if (cart.destinationCountry == null && code != null) cart.destinationCountry = code
    }
}

// MARK: - Web pages (Custom Tabs; iOS SFSafariViewController)

/** A web page opened in-app (Help, Sell on Yard, the web settings page). */
enum class YouWebPage {
    Help, Sell, WebSettings;

    val url: String
        get() = when (this) {
            Help -> "https://yardstore.space/support"
            Sell -> Config.webUrl("/sell")
            WebSettings -> Config.webUrl("/you/settings")
        }

    fun open(context: Context, darkTheme: Boolean) = WebPages.open(context, url, darkTheme)
}

/** Legal page icons (iOS `YouLegalIcon`). */
object YouLegalIcon {
    fun icon(page: LegalPage): ImageVector = when (page) {
        LegalPage.Terms -> Icons.Outlined.Description
        LegalPage.Privacy -> Icons.Outlined.PanTool
        LegalPage.Refunds -> Icons.AutoMirrored.Outlined.Undo
        LegalPage.DataDeletion -> Icons.Outlined.FolderDelete
    }
}

// MARK: - Grouped settings cards (reference 08-settings)

/** A titled group of rows in one rounded card, as in reference 08. */
@Composable
fun YouSettingsGroup(
    title: String?,
    modifier: Modifier = Modifier,
    footer: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        if (title != null) {
            Text(
                title,
                style = YardFonts.headline,
                color = Color.yard.ink2,
                modifier = Modifier.padding(horizontal = Spacing.xs).semantics { heading() },
            )
        }
        Card(padding = Spacing.xs) { content() }
        if (footer != null) {
            Text(footer, style = YardFonts.caption, color = Color.yard.ink3, modifier = Modifier.padding(horizontal = Spacing.xs))
        }
    }
}

/** A tappable row inside a [YouSettingsGroup]: rounded ripple that stays inside the card. */
@Composable
fun Modifier.youRowClick(enabled: Boolean = true, onClick: () -> Unit): Modifier =
    this.clip(RoundedCornerShape(Radius.card - Spacing.xs)).clickable(enabled = enabled, onClick = onClick)

/** A placeholder row while a group loads. */
@Composable
fun YouSkeletonRow() {
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.m, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Skeleton(Modifier.size(36.dp), cornerRadius = 10.dp)
        Skeleton(Modifier.size(width = 140.dp, height = 12.dp), cornerRadius = 4.dp)
    }
}

/** A row with a title, an explanation under it and a trailing switch (notification settings). */
@Composable
fun YouToggleRow(
    title: String,
    detail: String?,
    icon: ImageVector,
    isOn: Boolean,
    onChange: (Boolean) -> Unit,
    isEnabled: Boolean = true,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .youRowClick(enabled = isEnabled) { onChange(!isOn) }
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.m, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(
            Modifier.size(36.dp).background(Color.yard.surface2, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = YardFonts.body, color = Color.yard.ink)
            if (detail != null) Text(detail, style = YardFonts.caption, color = Color.yard.ink2)
        }
        Spacer(Modifier.width(Spacing.xs))
        YardSwitch(checked = isOn, onCheckedChange = onChange, enabled = isEnabled)
    }
}

/** A themed text field for the account sheets. */
@Composable
fun YouTextField(
    title: String,
    text: String,
    onTextChange: (String) -> Unit,
    isSecure: Boolean = false,
    error: String? = null,
) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
        Text(title, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        val shape = RoundedCornerShape(Radius.small)
        BasicTextField(
            value = text,
            onValueChange = onTextChange,
            singleLine = true,
            textStyle = YardFonts.body.copy(color = Color.yard.ink),
            cursorBrush = SolidColor(Color.yard.ink),
            visualTransformation = if (isSecure) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = if (isSecure) KeyboardType.Password else KeyboardType.Text,
            ),
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(Color.yard.surface2, shape)
                .border(1.dp, if (error == null) Color.yard.line else Color.yard.danger, shape)
                .semantics { contentDescription = title },
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().padding(horizontal = Spacing.m), contentAlignment = Alignment.CenterStart) { inner() }
            },
        )
        if (error != null) Text(error, style = YardFonts.caption, color = Color.yard.danger)
    }
}

// MARK: - API models (GET /api/auth/security?as=shopper)

/** A linked Google/Apple identity (src/server/auth/oauth/flow.ts listIdentities). */
@Serializable
data class YouIdentity(
    val id: String,
    val provider: String = "",
    val email: String? = null,
) {
    val providerName: String
        get() = when (provider) {
            "google" -> "Google"
            "apple" -> "Apple"
            "auth0" -> "Social sign-in"
            else -> provider.replaceFirstChar { it.uppercase() }
        }

    val icon: ImageVector
        get() = when (provider) {
            "apple" -> Icons.Outlined.PhoneIphone
            "google" -> Icons.Outlined.AccountCircle
            else -> Icons.Outlined.VpnKey
        }
}

@Serializable
data class YouProviders(val google: Boolean = false, val apple: Boolean = false)

@Serializable
data class YouDeletion(
    /** "pending" | "processing" | "completed" | … */
    val status: String = "pending",
    val requestedAt: String? = null,
)

/** GET /api/auth/security?as=shopper: how this account signs in. */
@Serializable
data class YouSecurity(
    /** How this session signed in: "password", "google", "magic_link", "demo", … */
    val method: String = "password",
    val demo: Boolean = false,
    val emailVerified: Boolean = false,
    val hasPassword: Boolean = false,
    val identities: List<YouIdentity> = emptyList(),
    val providers: YouProviders = YouProviders(),
    /** Seconds since the last re-auth on this session (null = never). */
    val reauthAgeSec: Int? = null,
    val deletion: YouDeletion? = null,
) {
    /** Whether a re-auth happened recently enough for an action that allows [maxAgeSec]. */
    fun isRecentlyConfirmed(maxAgeSec: Int): Boolean {
        val age = reauthAgeSec ?: return false
        return age < maxAgeSec - 30
    }

    val isDeletionPending: Boolean
        get() = deletion?.status == "pending" || deletion?.status == "processing"
}

/** POST /api/auth/reauth?as=shopper { password }. */
@Serializable
data class YouReauthBody(val password: String)

/** 403 with `fields.reauth = "required"`: confirm it's you, then retry. */
val APIError.youNeedsReauth: Boolean get() = status == 403 && fields["reauth"] == "required"

/** `?as=shopper` on the auth/preferences routes. */
internal val youAsShopper: List<Pair<String, String?>> = listOf("as" to "shopper")

