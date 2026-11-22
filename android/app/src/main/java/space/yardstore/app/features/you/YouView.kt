package space.yardstore.app.features.you

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.unit.em
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.YardWindow
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.People
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.SupportAgent
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LegalPage
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.app.tabPillScrollSensor
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Shopper
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.features.sell.YouSellerCard
import space.yardstore.app.features.studio.LocalStudioStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardLogo
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.time.LocalTime

/**
 * The You tab root. Mirrors YouView.swift.
 * - Signed out: an invite card (Sign in / Create account, both present SignInView) plus help and legal links.
 * - Signed in: profile header (photo or initials avatar, greeting, name, email), one quick-links panel
 *   (Orders, Saved, Following, Inbox, Drop reminders, Updates, with their live counts), links (Settings, Sell on Yard), Help (Message Yard Support,
 *   Help centre) and legal (Terms, Privacy, Refunds).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YouView() {
    val session = LocalSessionStore.current
    val studio = LocalStudioStore.current
    val router = LocalRouter.current
    val context = LocalContext.current
    val dark = Color.yard.isDark
    val scope = rememberCoroutineScope()
    var isRefreshing by remember { mutableStateOf(false) }
    val shopper = session.shopper
    val badges: YouBadgesModel = viewModel { YouBadgesModel() }
    val signedIn = session.isSignedIn
    // Live link state: on sign-in changes and whenever You comes back into view: the You tab is
    // selected (hidden tabs stay composed and RESUMED, so a tab switch fires no ON_RESUME), back
    // from Inbox / Orders within You's stack, or back from the app switcher while You is showing.
    val youSelected = router.selectedTab == AppTab.You
    LaunchedEffect(shopper?.id) { if (shopper == null) badges.reset() }
    LaunchedEffect(youSelected) { if (youSelected) badges.refresh(signedIn) }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { if (youSelected) badges.refresh(signedIn) }

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            scope.launch {
                isRefreshing = true
                try {
                    session.refresh()
                    badges.refresh(session.isSignedIn, force = true)
                } finally { isRefreshing = false }
            }
        },
        modifier = Modifier.fillMaxSize().yardScreenBackground(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .tabPillScrollSensor()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding(),
        ) {
          // The whole width scrolls; the readable column is capped on wide windows (Tablet rule 2).
          Column(
            Modifier
                .adaptiveContentWidth()
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.s, bottom = Spacing.xl + LocalTabPillClearance.current),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
          ) {
            YouTopBar { router.push(Route.Settings) }
            when {
                session.isSignedIn && shopper != null -> {
                    YouProfileHeader(shopper)
                    LaunchedEffect(shopper.id) { badges.refresh(true) }
                    // "{Brand}: in review", or "Switch to Studio" for brand members.
                    YouSellerCard()
                    YouQuickLinks(badges)
                }
                !session.hasLoaded -> YouLoadingHeader()
                else -> YouInviteCard(onSignIn = { router.present(Route.SignIn) })
            }

            YouSettingsGroup(null) {
                SettingsRow("Settings", Icons.Outlined.Settings, Modifier.youRowClick { router.push(Route.Settings) })
                when {
                    // Brand members switch to Studio; everyone else applies in the app.
                    studio.canOpenStudio -> SettingsRow("Switch to Studio", Icons.Outlined.Storefront, Modifier.youRowClick { studio.enter() })
                    shopper?.brands.isNullOrEmpty() && signedIn -> SettingsRow("Sell on Yard", Icons.Outlined.Storefront, Modifier.youRowClick { studio.openApplication() })
                    !signedIn -> SettingsRow("Sell on Yard", Icons.Outlined.Storefront, Modifier.youRowClick { YouWebPage.Sell.open(context, dark) })
                }
            }

            // Help: the native Yard Support thread, and the website's help centre.
            YouSettingsGroup(
                "Help",
                footer = "Questions about an order, a payment or your account? Yard's team replies in the app and in your notifications.",
            ) {
                SettingsRow("Message Yard Support", Icons.Outlined.SupportAgent, Modifier.youRowClick { router.push(Route.YardSupport()) })
                SettingsRow("Help centre", Icons.AutoMirrored.Outlined.HelpOutline, Modifier.youRowClick { YouWebPage.Help.open(context, dark) })
            }

            YouSettingsGroup("Legal") {
                listOf(LegalPage.Terms, LegalPage.Privacy, LegalPage.Refunds).forEach { page ->
                    SettingsRow(page.title, YouLegalIcon.icon(page), Modifier.youRowClick { router.push(Route.Legal(page)) })
                }
            }
          }
        }
    }
}

@Composable
private fun YouTopBar(onSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        YardDisplayText("You", size = 40.sp, color = Color.yard.ink)
        Spacer(Modifier.weight(1f))
        GlassIconButton(Icons.Outlined.Settings, "Settings", size = 40.dp, onClick = onSettings)
    }
}

private fun youGreeting(hour: Int = LocalTime.now().hour): String = when {
    hour < 5 -> "Up late"
    hour < 12 -> "Good morning"
    hour < 18 -> "Good afternoon"
    else -> "Good evening"
}

@Composable
private fun YouProfileHeader(shopper: Shopper) {
    val name = shopper.name.ifEmpty { "Your World" }
    Row(
        Modifier.fillMaxWidth().semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        // The profile photo, or the acid disc with the initials in the display face.
        YouAvatar(shopper.photoSrc, shopper.initials, 64.dp, initialsSize = 26.sp)
        Column(Modifier.weight(1f)) {
            // An editorial kicker: small caps, tracked out, above the name.
            Text(
                youGreeting().uppercase(),
                style = YardFonts.micro.copy(letterSpacing = 0.14.em),
                color = Color.yard.violet,
            )
            YardDisplayText(
                name,
                size = if (name.length > 18) 24.sp else 30.sp,
                color = Color.yard.ink,
                maxLines = 2,
                modifier = Modifier.padding(top = 3.dp),
            )
            if (shopper.email.isNotEmpty()) {
                Text(
                    shopper.email,
                    style = YardFonts.caption,
                    color = Color.yard.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.MiddleEllipsis,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
        }
    }
}

@Composable
private fun YouLoadingHeader() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
        Skeleton(Modifier.size(64.dp), shape = SkeletonShape.Circle)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Skeleton(Modifier.size(width = 160.dp, height = 20.dp), cornerRadius = 4.dp)
            Skeleton(Modifier.size(width = 120.dp, height = 12.dp), cornerRadius = 4.dp)
        }
    }
}

@Composable
private fun YouInviteCard(onSignIn: () -> Unit) {
    Card(padding = Spacing.xl) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            YardLogo(Modifier.height(28.dp), color = Color.yard.acid)
            YardDisplayText("Your World", size = 36.sp, color = Color.yard.ink)
            Text(
                "Sign in to see drops from the brands you follow, everything you've saved and every order, across every brand, in one place.",
                style = YardFonts.callout,
                color = Color.yard.ink2,
            )
            Column(Modifier.padding(top = Spacing.xs), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                YardButton("Sign in", onClick = onSignIn)
                YardButton("Create account", style = YardButtonStyle.Secondary, onClick = onSignIn)
            }
        }
    }
}

@Preview(name = "YouView — dark")
@Composable
private fun YouViewDark() = YardPreview(darkTheme = true) { YouView() }

@Preview(name = "YouView — light")
@Composable
private fun YouViewLight() = YardPreview(darkTheme = false, signedIn = false) { YouView() }

@YardTabletPreviews
@Composable
private fun YouViewTablet() = YardPreview(darkTheme = true) { YouView() }
