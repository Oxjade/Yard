package space.yardstore.app.features.drops

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridScope
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDownward
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.yardScreenBackground
import java.time.Instant

/**
 * Drops: Live now (big cards with the live pulse), Entries open, Upcoming (a calendar grouped by
 * day, each row with a countdown and a reminder bell) and Past drops.
 * Data: GET /api/drops?phase=live|upcoming|ended&limit=&cursor= (three pages, like the website).
 * Mirrors DropsView.swift.
 */
@Composable
fun DropsView() {
    val model: DropsViewModel = viewModel { DropsViewModel() }
    DropsScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DropsScreen(model: DropsViewModel) {
    val router = LocalRouter.current
    val session = LocalSessionStore.current
    val signedIn = session.isSignedIn

    LaunchedEffect(Unit) { model.loadIfNeeded(signedIn) }
    LaunchedEffect(signedIn) {
        // .onChange(of: session.isSignedIn): reload the bells (the first load already does it).
        if (model.state is DropsViewModel.LoadState.Loaded) model.participationChanged(signedIn)
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Drops") {
            GlassIconButton(Icons.Outlined.NotificationsActive, "Your drops") { router.push(Route.MyDrops) }
        }
        // Regroup every 30 s so a drop moves section when it opens or closes.
        val now by rememberDropsNow(30_000)
        when (val state = model.state) {
            DropsViewModel.LoadState.Loading -> DropsSkeleton()
            is DropsViewModel.LoadState.Failed -> EmptyState.Error(state.error) { model.reload(session.isSignedIn) }
            DropsViewModel.LoadState.Loaded -> PullToRefreshBox(
                isRefreshing = model.isRefreshing,
                onRefresh = { model.refresh(session.isSignedIn) },
                modifier = Modifier.fillMaxSize(),
            ) {
                DropsLoaded(model, model.groups(now), now)
            }
        }
    }
}

@Composable
private fun DropsLoaded(model: DropsViewModel, groups: DropsViewModel.Groups, now: Instant) {
    val router = LocalRouter.current
    val session = LocalSessionStore.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val permission = rememberDropNotificationPermission()
    val bottom = Spacing.xxxl + LocalTabPillClearance.current + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    fun toggleReminder(drop: Drop) {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        scope.launch {
            try {
                val message = model.toggleReminder(drop, context, permission)
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

    if (groups.isEmpty && model.feed(DropsViewModel.Source.Upcoming).cursor == null && model.feed(DropsViewModel.Source.Live).cursor == null) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = bottom)) {
            item(key = "header") { DropsHeader() }
            item(key = "empty") {
                EmptyState(
                    "No drops scheduled",
                    message = "New releases will appear here when brands schedule them.",
                    icon = Icons.Outlined.EventAvailable,
                )
            }
        }
        return
    }

    val bleed = Modifier.dropsBleed(Spacing.gridGap)
    val full = StaggeredGridItemSpan.FullLine
    MasonryGrid(
        items = groups.past,
        key = { "past-${it.id}" },
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = Spacing.gridGap, end = Spacing.gridGap, bottom = bottom),
        header = {
            item(key = "header", span = full) { Box(bleed) { DropsHeader() } }

            if (groups.live.isNotEmpty()) {
                bigCardSection(
                    key = "live",
                    title = "Live now",
                    subtitle = "Releases open now, and draws whose winners are buying.",
                    drops = groups.live,
                    now = now,
                    more = DropsViewModel.Source.Live,
                    model = model,
                    bleed = bleed,
                    onOpen = { router.push(Route.Drop(it.slug)) },
                )
            }
            if (groups.entriesOpen.isNotEmpty()) {
                bigCardSection(
                    key = "entries",
                    title = "Entries open",
                    subtitle = "Enter before the draw closes.",
                    drops = groups.entriesOpen,
                    now = now,
                    more = null,
                    model = model,
                    bleed = bleed,
                    onOpen = { router.push(Route.Drop(it.slug)) },
                )
            }
            if (groups.upcoming.isNotEmpty() || model.feed(DropsViewModel.Source.Upcoming).cursor != null) {
                item(key = "upcoming-title", span = full) {
                    Box(bleed.padding(top = Spacing.xxl - Spacing.gridGap, bottom = Spacing.xs)) {
                        SectionHeader("Upcoming", subtitle = "Set a reminder for the next release.", display = true)
                    }
                }
                for (day in model.days(groups.upcoming, now)) {
                    item(key = "day-${day.day}", span = full) {
                        Row(
                            bleed.padding(horizontal = Spacing.gutter).padding(top = Spacing.s),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                        ) {
                            Text(DropText.dayTitle(day.day, now).uppercase(), style = YardFonts.captionEmphasis, color = Color.yard.ink)
                            Box(Modifier.weight(1f).height(1.dp).background(Color.yard.line))
                        }
                    }
                    for (drop in day.drops) {
                        item(key = "up-${drop.id}", span = full) {
                            DropCalendarRow(
                                drop = drop,
                                now = now,
                                reminderOn = drop.id in model.reminderIds,
                                isBusy = drop.id in model.busyIds,
                                onOpen = { router.push(Route.Drop(drop.slug)) },
                                onToggleReminder = { toggleReminder(drop) },
                                modifier = bleed.padding(horizontal = Spacing.gutter),
                            )
                        }
                    }
                }
                loadMoreItem(model, DropsViewModel.Source.Upcoming, "Load more drops", bleed)
            }
            if (groups.past.isNotEmpty()) {
                item(key = "past-title", span = full) {
                    Box(bleed.padding(top = Spacing.xxl - Spacing.gridGap, bottom = Spacing.xs)) {
                        SectionHeader("Past drops", subtitle = "Previous releases and draws.", display = true)
                    }
                }
            }
        },
        footer = {
            if (groups.past.isNotEmpty()) loadMoreItem(model, DropsViewModel.Source.Ended, "Load more past drops", bleed)
            item(key = "how", span = full) { Box(bleed.padding(top = Spacing.xxl - Spacing.gridGap)) { HowDropsWork() } }
        },
    ) { drop ->
        DropPastTile(drop, Modifier.pressableClick { router.push(Route.Drop(drop.slug)) })
    }
}

private fun LazyStaggeredGridScope.bigCardSection(
    key: String,
    title: String,
    subtitle: String,
    drops: List<Drop>,
    now: Instant,
    more: DropsViewModel.Source?,
    model: DropsViewModel,
    bleed: Modifier,
    onOpen: (Drop) -> Unit,
) {
    val full = StaggeredGridItemSpan.FullLine
    item(key = "$key-title", span = full) {
        Box(bleed.padding(top = Spacing.xxl - Spacing.gridGap, bottom = Spacing.xs)) {
            SectionHeader(title, subtitle = subtitle, display = true)
        }
    }
    for (drop in drops) {
        item(key = "$key-${drop.id}", span = full) {
            DropLiveCard(
                drop,
                drop.livePhase(now),
                bleed.padding(horizontal = Spacing.gutter).padding(top = Spacing.m - Spacing.gridGap).pressableClick { onOpen(drop) },
            )
        }
    }
    if (more != null) loadMoreItem(model, more, "Load more drops", bleed)
}

private fun LazyStaggeredGridScope.loadMoreItem(model: DropsViewModel, source: DropsViewModel.Source, title: String, bleed: Modifier) {
    val feed = model.feed(source)
    if (feed.cursor == null) return
    item(key = "more-${source.wire}", span = StaggeredGridItemSpan.FullLine) {
        Box(bleed.padding(top = Spacing.m), contentAlignment = Alignment.Center) {
            YardButton(
                title,
                icon = Icons.Outlined.ArrowDownward,
                style = YardButtonStyle.Secondary,
                size = YardButtonSize.Medium,
                isLoading = feed.isLoadingMore,
                fullWidth = false,
            ) { model.loadMore(source) }
        }
    }
}

@Composable
private fun DropsHeader() {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter).padding(top = Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        YardDisplayText("Drops", size = 56.sp)
        Text(
            "Limited releases from independent brands, on a schedule. Small runs, clear rules, and a reminder when each one opens.",
            style = YardFonts.callout,
            color = Color.yard.ink2,
        )
    }
}

@Composable
private fun HowDropsWork() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        SectionHeader(
            "How drops work",
            subtitle = "The rules are on every drop before it opens, and they don't change once it's scheduled.",
            display = true,
        )
        Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            HowRow("First come", "Opens to everyone at release. Pieces go to whoever checks out first.")
            HowRow("Draw", "Enter before release. Winners are picked at random and only winners pay.")
            HowRow("Early access", "Followers who were following before early access opened get the first window. Everyone can buy at the public release.")
        }
    }
}

@Composable
private fun HowRow(title: String, body: String) {
    Card {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            YardDisplayText(title, size = 22.sp)
            Text(body, style = YardFonts.callout, color = Color.yard.ink2)
        }
    }
}

@Preview(name = "DropsView — dark")
@Composable
private fun DropsViewDarkPreview() = YardPreview(darkTheme = true) {
    DropsScreen(
        DropsViewModel(
            previewDrops = listOf(
                DropsPreviewFixtures.live, DropsPreviewFixtures.draw, DropsPreviewFixtures.upcoming,
                DropsPreviewFixtures.tomorrow, DropsPreviewFixtures.past,
            ),
        ),
    )
}

@Preview(name = "DropsView — light")
@Composable
private fun DropsViewLightPreview() = YardPreview(darkTheme = false) {
    DropsScreen(
        DropsViewModel(
            previewDrops = listOf(DropsPreviewFixtures.live, DropsPreviewFixtures.upcoming, DropsPreviewFixtures.tomorrow, DropsPreviewFixtures.past),
        ),
    )
}

@Preview(name = "DropsView — loading (network)")
@Composable
private fun DropsViewLoadingPreview() = YardPreview(darkTheme = true, signedIn = false) { DropsView() }
