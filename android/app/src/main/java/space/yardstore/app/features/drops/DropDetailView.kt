package space.yardstore.app.features.drops

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.EmojiEvents
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.Casino
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.DropEntry
import space.yardstore.app.core.models.DropViewerState
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Duration
import java.time.Instant

/**
 * One drop: hero image, brand, name, release timing with a big live countdown, the reminder /
 * draw-entry action, facts, description and the drop's pieces (masonry). When the drop is live
 * the pieces open the product page to buy, and a "Shop this drop" bar sits at the bottom.
 * Mirrors DropDetailView.swift.
 */
@Composable
fun DropDetailView(id: String) {
    val appContext = LocalContext.current.applicationContext
    val model: DropDetailViewModel = viewModel(key = "drop-$id") { DropDetailViewModel(id, appContext) }
    DropDetailScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropDetailScreen(model: DropDetailViewModel) {
    val session = LocalSessionStore.current
    val context = LocalContext.current
    val signedIn = session.isSignedIn

    LaunchedEffect(Unit) { model.loadIfNeeded() }
    LaunchedEffect(signedIn) {
        // .onChange(of: session.isSignedIn): the viewer state depends on who is signed in.
        if (model.drop != null) model.reload()
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(null) {
            val drop = model.drop
            if (drop != null) {
                GlassIconButton(Icons.Outlined.Share, "Share drop") {
                    val send = Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, drop.name)
                        .putExtra(Intent.EXTRA_TEXT, "${drop.name} by ${drop.brandName} on Yard\n${Config.webUrl(drop.webPath)}")
                    context.startActivity(Intent.createChooser(send, null))
                }
            }
        }
        when (val state = model.state) {
            DropDetailViewModel.LoadState.Loading -> DropDetailSkeleton()
            is DropDetailViewModel.LoadState.Failed -> EmptyState.Error(state.error) { model.load() }
            DropDetailViewModel.LoadState.Loaded -> {
                val drop = model.drop
                if (drop == null) {
                    EmptyState("Drop not found", message = "We couldn't find that drop.", icon = Icons.Outlined.EventBusy)
                } else {
                    PullToRefreshBox(isRefreshing = model.isRefreshing, onRefresh = { model.refresh() }, modifier = Modifier.fillMaxSize()) {
                        DropDetailLoaded(model, drop)
                    }
                }
            }
        }
    }
}

@Composable
private fun DropDetailLoaded(model: DropDetailViewModel, drop: Drop) {
    val router = LocalRouter.current
    // The page's clock for phase changes (the countdowns tick on their own every second).
    val now by rememberDropsNow(2000)
    val phase = drop.livePhase(now)
    val shopNow = phase == DropLivePhase.Live && !drop.isDraw
    val grid = rememberLazyStaggeredGridState()
    val scope = rememberCoroutineScope()
    LaunchedEffect(phase) { model.phaseDidChange(phase) }

    val piecesIndex = 4 + (if (drop.description.isNotEmpty()) 1 else 0)
    val scrollToPieces: () -> Unit = { scope.launch { grid.animateScrollToItem(piecesIndex) } }
    val showsBar = shopNow && model.products.isNotEmpty()
    val bleed = Modifier.dropsBleed(Spacing.gridGap)
    val full = StaggeredGridItemSpan.FullLine
    val navBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    Column(Modifier.fillMaxSize()) {
        MasonryGrid(
            products = model.products,
            modifier = Modifier.weight(1f),
            state = grid,
            contentPadding = PaddingValues(
                start = Spacing.gridGap,
                end = Spacing.gridGap,
                bottom = Spacing.xxxl + if (showsBar) 0.dp else navBottom,
            ),
            header = {
                item(key = "hero", span = full) { DropHero(drop, phase) }
                item(key = "title", span = full) {
                    Box(bleed.padding(top = Spacing.xl - Spacing.gridGap)) {
                        DropTitleBlock(drop) { handle -> router.push(Route.Brand(handle)) }
                    }
                }
                item(key = "release", span = full) {
                    Box(bleed.padding(horizontal = Spacing.gutter).padding(top = Spacing.xl - Spacing.gridGap)) {
                        DropReleaseCard(model, drop, phase, now, scrollToPieces)
                    }
                }
                if (drop.description.isNotEmpty()) {
                    item(key = "description", span = full) {
                        Text(
                            drop.description,
                            style = YardFonts.body,
                            color = Color.yard.ink2,
                            modifier = bleed.padding(horizontal = Spacing.gutter).padding(top = Spacing.xl - Spacing.gridGap),
                        )
                    }
                }
                item(key = "facts", span = full) {
                    Box(bleed.padding(horizontal = Spacing.gutter).padding(top = Spacing.xl - Spacing.gridGap)) { DropFacts(drop, phase) }
                }
                item(key = "pieces", span = full) {
                    Column(bleed.padding(top = Spacing.xl - Spacing.gridGap, bottom = Spacing.s), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                        SectionHeader("In this drop", subtitle = "Checkout confirms availability and enforces the drop's purchase rules.", display = true)
                        if (phase == DropLivePhase.Upcoming) {
                            DropNote("Pieces can be bought once the drop opens. Set a reminder so you don't miss it.", Modifier.padding(horizontal = Spacing.gutter))
                        }
                        if (model.products.isEmpty()) {
                            Text(
                                "The pieces in this drop aren't available to view right now.",
                                style = YardFonts.callout,
                                color = Color.yard.ink2,
                                modifier = Modifier.padding(horizontal = Spacing.gutter),
                            )
                        }
                    }
                }
            },
        ) { product ->
            ProductTile(product, Modifier.pressableClick { router.push(Route.Product(product.slug)) }, showsBrand = false)
        }
        if (showsBar) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(Color.yard.surface)
                    .navigationBarsPadding()
                    .padding(horizontal = Spacing.gutter, vertical = Spacing.s),
            ) {
                YardButton("Shop this drop", icon = Icons.Outlined.ArrowDownward, onClick = scrollToPieces)
            }
        }
    }
}

@Composable
private fun DropHero(drop: Drop, phase: DropLivePhase) {
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(4f / 5f)
            .clip(YardShapes.image)
            .semantics { contentDescription = drop.name },
    ) {
        RemoteImage(drop.imageUrl, Modifier.fillMaxSize(), maxPixelSize = 1600)
        Row(Modifier.align(Alignment.TopStart).padding(Spacing.m), horizontalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            DropStatusBadge(drop, phase, onPhoto = true)
            Tag(drop.accessLabel, style = TagStyle.OnPhoto)
            if (drop.sponsored) Tag("Sponsored", style = TagStyle.OnPhoto)
        }
    }
}

@Composable
private fun DropTitleBlock(drop: Drop, onBrand: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        val handle = drop.brand.handle
        Row(
            Modifier.pressableClick(enabled = handle != null) { if (handle != null) onBrand(handle) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            BrandAvatar(drop.brandName, size = 28.dp)
            Text(drop.brandName, style = YardFonts.bodyEmphasis, color = Color.yard.ink)
            if (handle != null) {
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(16.dp))
            }
        }
        YardDisplayText(drop.name, size = 46.sp)
    }
}

@Composable
private fun DropReleaseCard(model: DropDetailViewModel, drop: Drop, phase: DropLivePhase, now: Instant, scrollToPieces: () -> Unit) {
    val me = model.me
    val entry = me?.entry
    val winner = entry?.status == "won"
    val mode = drop.actionMode(phase)
    val drawWaiting = drop.isDrawWaiting(phase, now)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        if (winner && me != null) DropWinnerCard(me, entry, now, scrollToPieces)
        Card {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Text(drop.releaseKindLabel.uppercase(), style = YardFonts.micro, color = Color.yard.ink3)
                Text(drop.timingText(phase, now), style = YardFonts.headline, color = Color.yard.ink)
                drop.countdownTarget(phase, now)?.let { DropCountdown(it.label, it.date, hot = drop.isHot(phase)) }
                if (mode != null) DropActionButton(model, drop, mode)
                if (drawWaiting) DropNote("Set a reminder now; you can enter once entries open.")
                if (phase == DropLivePhase.Live && !drop.isDraw) {
                    YardButton("Shop this drop", icon = Icons.Outlined.ArrowDownward, onClick = scrollToPieces)
                }
                if (phase == DropLivePhase.EarlyAccess) {
                    DropNote("Early access is available to eligible followers. Open a piece to check your access.")
                }
                if (drop.isWinnersWindow(phase) && !winner) DropNote("Entries are closed. Drawn winners are buying now.")
                val reason = me?.reason
                if (me != null && !me.canBuy && reason != null && !winner && (phase == DropLivePhase.Live || phase == DropLivePhase.EarlyAccess)) {
                    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        Box(Modifier.width(2.dp).fillMaxHeight().background(Color.yard.line))
                        Text(reason, style = YardFonts.callout, color = Color.yard.ink2)
                    }
                }
                if (entry != null && !winner) {
                    val status = DropText.entryStatus(entry.status)
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        Text("Your draw entry:", style = YardFonts.caption, color = Color.yard.ink3)
                        Tag(status.label, style = status.style)
                        entry.rank?.let { Text("position $it", style = YardFonts.caption, color = Color.yard.ink3) }
                    }
                }
            }
        }
    }
}

@Composable
private fun DropWinnerCard(me: DropViewerState, entry: DropEntry?, now: Instant, scrollToPieces: () -> Unit) {
    Card(Modifier.border(1.dp, Color.yard.acid.copy(alpha = 0.5f), YardShapes.card)) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.EmojiEvents, contentDescription = null, tint = Color.yard.acid)
                YardDisplayText("You won the draw", size = 26.sp)
            }
            val ends = YardDate.parse(entry?.windowEndsAt)
            val opens = YardDate.parse(entry?.windowOpensAt)
            when {
                me.canBuy && ends != null -> {
                    Text(
                        "Buy your piece by ${Formatters.dateTime(ends)} (your time). After that, your place goes to the next person on the waitlist.",
                        style = YardFonts.callout,
                        color = Color.yard.ink2,
                    )
                    YardButton("Buy now", icon = Icons.Outlined.ArrowDownward, onClick = scrollToPieces)
                }
                opens != null && opens > now -> {
                    val closing = ends?.let { " and closes ${Formatters.dateTime(it)}" } ?: ""
                    Text("Your purchase window opens ${Formatters.dateTime(opens)}$closing (your time).", style = YardFonts.callout, color = Color.yard.ink2)
                }
                me.reason != null -> Text(me.reason!!, style = YardFonts.callout, color = Color.yard.ink2)
            }
        }
    }
}

@Composable
private fun DropActionButton(model: DropDetailViewModel, drop: Drop, mode: DropActionMode) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val permission = rememberDropNotificationPermission()

    fun run(block: suspend () -> DropToastMessage) {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        scope.launch {
            try {
                val message = block()
                if (message.text.isNotEmpty()) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    toast.show(message.text, message.style)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    when (mode) {
        DropActionMode.Reminder -> {
            val on = model.me?.reminder ?: false
            val title = if (on) "Reminder set" else if (drop.isDraw) "Remind me to enter" else "Remind me"
            YardButton(
                title,
                icon = if (on) Icons.Filled.Notifications else Icons.Outlined.Notifications,
                style = if (on) YardButtonStyle.Secondary else YardButtonStyle.Primary,
                isLoading = model.isWorking,
            ) { run { model.toggleReminder(context, permission) } }
        }
        DropActionMode.Entry -> {
            val entered = model.isEntered
            YardButton(
                if (entered) "Entered" else "Enter the draw",
                icon = if (entered) Icons.Filled.Verified else Icons.Outlined.Casino,
                style = if (entered) YardButtonStyle.Secondary else YardButtonStyle.Primary,
                isLoading = model.isWorking,
            ) { run { DropToastMessage(model.toggleEntry(), Toast.Style.Success) } }
            if (entered) DropNote("Tap again to withdraw before the draw.")
        }
    }
}

@Composable
private fun DropNote(text: String, modifier: Modifier = Modifier) {
    Text(text, style = YardFonts.caption, color = Color.yard.ink3, modifier = modifier)
}

@Composable
private fun DropFacts(drop: Drop, phase: DropLivePhase) {
    val facts = buildList {
        add("Run" to drop.runText)
        add("Limit" to "${drop.limitPerCustomer} per customer")
        val left = drop.unitsAvailable
        if (phase == DropLivePhase.Live && left != null) add("Left" to if (left > 0) Formatters.grouped(left) else "Sold out")
        if (drop.isDraw) {
            drop.winners?.let { add("Winners" to Formatters.grouped(it)) }
            drop.purchaseWindowMinutes?.let { add("Winner window" to DropText.windowLength(it)) }
            drop.entries?.let { add("Entries" to Formatters.grouped(it)) }
        }
    }
    Column(
        Modifier
            .fillMaxWidth()
            .border(1.dp, Color.yard.line, YardShapes.card)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        for (row in facts.chunked(2)) {
            Row(Modifier.fillMaxWidth()) {
                for ((title, value) in row) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(title, style = YardFonts.caption, color = Color.yard.ink3)
                        Text(value, style = YardFonts.bodyEmphasis, color = Color.yard.ink)
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

/** The big ticking countdown ("Opens in 2d 04:12:09"). */
@Composable
fun DropCountdown(label: String, target: Instant, hot: Boolean = false) {
    val now by rememberDropsNow(1000)
    val text = Formatters.countdown(Duration.between(now, target))
    Column(Modifier.semantics(mergeDescendants = true) { }, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
            if (hot) Box(Modifier.size(14.dp), contentAlignment = Alignment.Center) { DropLivePulse(Color.yard.violet, 5.dp) }
            Text(label, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        }
        Text(text, style = YardFonts.number(44.sp).monospacedDigits(), color = Color.yard.ink, maxLines = 1)
    }
}

/** Loading placeholder for the drop page. */
@Composable
fun DropDetailSkeleton() {
    Column(
        Modifier.fillMaxWidth().semantics { contentDescription = "Loading drop" },
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        Skeleton(Modifier.padding(horizontal = Spacing.gridGap).fillMaxWidth().aspectRatio(4f / 5f), cornerRadius = Radius.image)
        Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Skeleton(Modifier.size(width = 120.dp, height = 18.dp), cornerRadius = Radius.small)
            Skeleton(Modifier.fillMaxWidth().height(44.dp), cornerRadius = Radius.small)
            Skeleton(Modifier.fillMaxWidth().height(180.dp), cornerRadius = Radius.card)
        }
    }
}

@Preview(name = "DropDetailView — dark")
@Composable
private fun DropDetailDarkPreview() = YardPreview(darkTheme = true) {
    DropDetailScreen(DropDetailViewModel(previewDrop = DropsPreviewFixtures.live, products = PreviewFixtures.products.take(4)))
}

@Preview(name = "DropDetailView — light")
@Composable
private fun DropDetailLightPreview() = YardPreview(darkTheme = false, signedIn = false) {
    DropDetailScreen(DropDetailViewModel(previewDrop = DropsPreviewFixtures.upcoming, products = PreviewFixtures.products.take(3)))
}
