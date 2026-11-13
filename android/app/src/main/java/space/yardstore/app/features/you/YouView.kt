package space.yardstore.app.features.you

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
 * - Signed in: profile header (initials avatar, name, email), quick tiles (Orders, Saved, Following,
 *   Inbox, Drop reminders, Updates) and links (Settings, Help, Sell on Yard, Terms, Privacy, Refunds).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun YouView() {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val context = LocalContext.current
    val dark = Color.yard.isDark
    val scope = rememberCoroutineScope()
    var isRefreshing by remember { mutableStateOf(false) }
    val shopper = session.shopper

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            scope.launch {
                isRefreshing = true
                try { session.refresh() } finally { isRefreshing = false }
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
                    YouTiles()
                }
                !session.hasLoaded -> YouLoadingHeader()
                else -> YouInviteCard(onSignIn = { router.present(Route.SignIn) })
            }

            YouSettingsGroup(null) {
                SettingsRow("Settings", Icons.Outlined.Settings, Modifier.youRowClick { router.push(Route.Settings) })
                SettingsRow("Help", Icons.AutoMirrored.Outlined.HelpOutline, Modifier.youRowClick { YouWebPage.Help.open(context, dark) })
                SettingsRow("Sell on Yard", Icons.Outlined.Storefront, Modifier.youRowClick { YouWebPage.Sell.open(context, dark) })
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
        Box(
            Modifier.size(72.dp).background(Color.yard.acid, CircleShape).clearAndSetSemantics {},
            contentAlignment = Alignment.Center,
        ) {
            Text(shopper.initials, style = YardFonts.display(30.sp), color = Color.yard.onAcid)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            Text("${youGreeting()},", style = YardFonts.caption, color = Color.yard.violet)
            YardDisplayText(name, size = if (name.length > 18) 24.sp else 30.sp, color = Color.yard.ink, maxLines = 2)
            if (shopper.email.isNotEmpty()) {
                Text(shopper.email, style = YardFonts.callout, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
            }
        }
    }
}

@Composable
private fun YouLoadingHeader() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
        Skeleton(Modifier.size(72.dp), shape = SkeletonShape.Circle)
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Skeleton(Modifier.size(width = 160.dp, height = 20.dp), cornerRadius = 4.dp)
            Skeleton(Modifier.size(width = 120.dp, height = 12.dp), cornerRadius = 4.dp)
        }
    }
}

/** Quick tiles per row: 3 on phones (iOS), all 6 in one row on wide windows. */
internal fun youTileColumns(window: YardWindow): Int = if (window.isWide) 6 else 3

private data class YouTileItem(val title: String, val icon: ImageVector, val count: Int?, val route: Route)

@Composable
private fun YouTiles() {
    val saved = LocalSavedStore.current
    val follows = LocalFollowStore.current
    val tiles = listOf(
        YouTileItem("Orders", Icons.Outlined.Inventory2, null, Route.Orders),
        YouTileItem("Saved", Icons.Outlined.FavoriteBorder, saved.items.size, Route.Saved),
        YouTileItem("Following", Icons.Outlined.People, follows.items.size, Route.Following),
        YouTileItem("Inbox", Icons.Outlined.Forum, null, Route.Inbox),
        YouTileItem("Drop reminders", Icons.Outlined.NotificationsActive, null, Route.MyDrops),
        YouTileItem("Updates", Icons.Outlined.Notifications, null, Route.Notifications),
    )
    val columns = youTileColumns(LocalYardWindow.current)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        tiles.chunked(columns).forEach { row ->
            Row(Modifier.height(IntrinsicSize.Max), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                row.forEach { YouTile(it, Modifier.weight(1f).fillMaxHeight()) }
            }
        }
    }
}

/** A quick tile: icon, title, optional real count. */
@Composable
private fun YouTile(item: YouTileItem, modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    val label = item.count?.let { "${item.title}, $it" } ?: item.title
    Column(
        modifier
            .yardCard()
            .pressableClick(onClickLabel = label) { router.push(item.route) }
            .semantics(mergeDescendants = true) { contentDescription = label }
            .padding(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Box(
                Modifier.size(36.dp).background(Color.yard.surface2, RoundedCornerShape(10.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(item.icon, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(19.dp))
            }
            Spacer(Modifier.weight(1f))
            val count = item.count
            if (count != null && count > 0) {
                Text(Formatters.count(count), style = YardFonts.number(15.sp), color = Color.yard.ink)
            }
        }
        Text(
            item.title,
            style = YardFonts.captionEmphasis,
            color = Color.yard.ink,
            maxLines = 2,
            modifier = Modifier.fillMaxWidth().heightIn(min = 32.dp),
        )
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
