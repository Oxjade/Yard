package space.yardstore.app.features.charts

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.HourglassEmpty
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.LocationOff
import androidx.compose.material.icons.outlined.Public
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.isSpecified
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.ChipRow
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardCard
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

/**
 * Yard's Charts (website /charts): what's moving on Yard right now. A board rail (Top brands,
 * Trending, Emerging, Most followed, Most wishlisted, Top drops, City charts), Daily / Weekly /
 * Monthly editions, a location + category scope, then the board: podium for ranks 1–3 with big
 * display-face ranks, callouts, ranked rows with movement, and a separate Sponsored strip.
 * Tapping an entry opens the brand profile (or the drop on Top drops). Mirrors ChartsView.swift.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChartsView() {
    // The picked board/period/filters survive process death; the ViewModel starts from them.
    var savedQuery by rememberSaveable(stateSaver = ChartsQuerySaver) { mutableStateOf(ChartsQuery()) }
    val model: ChartsViewModel = viewModel { ChartsViewModel(savedQuery) }
    LaunchedEffect(model.query) { savedQuery = model.query }
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    var showsFilters by rememberSaveable { mutableStateOf(false) }
    var showsHowItWorks by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        model.loadScopes()
        model.resolveDefaultCity(shipToCity = cart.destinationCity, shipToCountry = cart.destinationCountry)
    }

    // Load this board, then keep it fresh while the screen is visible (website cadence:
    // daily 30 s, weekly 5 min, monthly 15 min). Paused while the app is in the background.
    val effective = model.effectiveQuery
    val lifecycleOwner = LocalLifecycleOwner.current
    LaunchedEffect(effective, lifecycleOwner) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.STARTED) {
            model.load()
            while (isActive) {
                delay(effective.period.refreshSeconds * 1_000)
                model.load()
            }
        }
    }

    val resolvedCity: ChartsResolvedCity? = run {
        if (model.query.chart != ChartSlug.City) return@run null
        model.currentBoard?.scope?.city?.let { return@run ChartsResolvedCity(it.slug, it.name) }
        model.defaultCity?.let { slug ->
            val name = model.scopes?.cities?.firstOrNull { it.slug == slug }?.name ?: slug
            ChartsResolvedCity(slug, name)
        }
    }

    val window = LocalYardWindow.current
    val bottomPadding = Spacing.xxxl + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + LocalTabPillClearance.current
    val refreshState = rememberPullToRefreshState()

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Charts")
        PullToRefreshBox(
            isRefreshing = model.isRefreshing,
            onRefresh = model::refresh,
            modifier = Modifier.fillMaxSize(),
            state = refreshState,
            indicator = {
                PullToRefreshDefaults.Indicator(
                    state = refreshState,
                    isRefreshing = model.isRefreshing,
                    modifier = Modifier.align(Alignment.TopCenter),
                    containerColor = Color.yard.surface,
                    color = Color.yard.ink,
                )
            },
        ) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = Spacing.s, bottom = bottomPadding),
            ) {
                item(key = "header", contentType = "header") {
                    ChartsHeader(model, Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter).padding(bottom = Spacing.l))
                }
                item(key = "rail", contentType = "rail") {
                    ChipRow(Modifier.adaptiveContentWidth().padding(bottom = Spacing.l)) {
                        ChartSlug.entries.forEach { slug ->
                            Chip(slug.label, isSelected = model.query.chart == slug) {
                                model.apply(model.query.copy(chart = slug))
                            }
                        }
                    }
                }
                item(key = "controls", contentType = "controls") {
                    ChartsControls(
                        model,
                        onOpenFilters = { showsFilters = true },
                        modifier = Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter).padding(bottom = Spacing.l),
                    )
                }
                item(key = "heading", contentType = "heading") {
                    ChartsBoardHeading(model, Modifier.adaptiveContentWidth().padding(horizontal = Spacing.gutter).padding(bottom = Spacing.l))
                }
                chartsBoardBody(model, maxWidth = window.contentMaxWidth, onEntry = { router.push(it.route) })
                item(key = "how", contentType = "how") {
                    ChartsHowItWorks(
                        expanded = showsHowItWorks,
                        onToggle = { showsHowItWorks = !showsHowItWorks },
                        modifier = Modifier.animateItem().adaptiveContentWidth().padding(horizontal = Spacing.gutter),
                    )
                }
            }
        }
    }

    if (showsFilters) {
        ChartsFiltersSheet(
            query = model.query,
            scopes = model.scopes,
            resolvedCity = resolvedCity,
            onDismiss = { showsFilters = false },
            onApply = { model.apply(it) },
        )
    }
}

// region Header

@Composable
private fun ChartsHeader(model: ChartsViewModel, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        YardDisplayText("Charts", size = 52.sp, color = Color.yard.ink)
        Text("What's moving on Yard right now.", style = YardFonts.callout, color = Color.yard.ink2)
        val edition = model.currentBoard?.edition
        if (edition != null) {
            ChartsEditionLine(edition, model.query.period, Modifier.padding(top = Spacing.xs))
        } else if (model.isLoading) {
            Row(Modifier.padding(top = Spacing.xs), horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.CenterVertically) {
                Skeleton(Modifier.size(width = 60.dp, height = 26.dp), shape = SkeletonShape.Capsule)
                Skeleton(Modifier.size(width = 180.dp, height = 12.dp), cornerRadius = 4.dp)
            }
        }
    }
}

// endregion

// region Period + scope

@Composable
private fun ChartsControls(model: ChartsViewModel, onOpenFilters: () -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        space.yardstore.app.designsystem.components.SegmentedPill(
            selection = model.query.period,
            options = ChartPeriod.entries,
            onSelect = { model.apply(model.query.copy(period = it)) },
        ) { it.label }

        Row(verticalAlignment = Alignment.CenterVertically) {
            val q = model.effectiveQuery
            val placed = model.query.chart == ChartSlug.City || q.city != null || q.country != null
            val title = model.locationTitle
            Row(
                Modifier
                    .weight(1f, fill = false)
                    .minimumInteractiveComponentSize()
                    .semantics { contentDescription = "Location, $title" }
                    .clip(YardShapes.pill)
                    .background(Color.yard.surface2, YardShapes.pill)
                    .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
                    .pressableClick(role = Role.Button, onClick = onOpenFilters)
                    .defaultMinSize(minHeight = 36.dp)
                    .padding(horizontal = Spacing.l),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(if (placed) Icons.Outlined.Place else Icons.Outlined.Public, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
                Text(
                    title,
                    style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
                    color = Color.yard.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Icon(Icons.Outlined.ExpandMore, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.weight(0.001f).size(Spacing.s))
            val n = model.query.filterCount
            Chip("Filters", icon = Icons.Outlined.Tune, isSelected = n > 0, count = if (n > 0) n else null) {
                haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove)
                onOpenFilters()
            }
        }
    }
}

// endregion

// region Board

@Composable
private fun ChartsBoardHeading(model: ChartsViewModel, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        YardDisplayText(model.query.chart.label, size = 32.sp, color = Color.yard.ink)
        Text(chartsHeadingLine(model), style = YardFonts.caption, color = Color.yard.ink2)
    }
}

/** "Everywhere, weekly. 20 brands ranked". */
private fun chartsHeadingLine(model: ChartsViewModel): String {
    val period = model.query.period.label
    var line = model.whereWords()?.let { "$it, ${period.lowercase()}" } ?: period
    val b = model.currentBoard
    if (b != null && b.state == ChartBoardState.Ok && b.entries.isNotEmpty()) {
        val n = b.entries.size
        val noun = if (b.chart == ChartSlug.TopDrops) (if (n == 1) "drop" else "drops") else (if (n == 1) "brand" else "brands")
        line += ". $n $noun ranked"
    }
    return line
}

/**
 * The board's lazy items. Every item is capped at [maxWidth] (the window's content width) and
 * centered, so on tablets the board reads as one column instead of stretching edge to edge.
 */
private fun LazyListScope.chartsBoardBody(model: ChartsViewModel, maxWidth: Dp, onEntry: (ChartEntry) -> Unit) {
    val board = model.currentBoard
    val pad = Modifier.chartsContentWidth(maxWidth).padding(horizontal = Spacing.gutter).padding(bottom = Spacing.l)
    if (board == null) {
        val error = model.error
        if (error != null && !model.isLoading) {
            item(key = "error") { ChartsErrorState(error, Modifier.animateItem().then(pad)) { model.reload() } }
        } else {
            item(key = "skeleton") { ChartsBoardSkeleton(Modifier.animateItem().then(pad)) }
        }
        return
    }
    when (board.state) {
        ChartBoardState.WarmingUp -> item(key = "warming") {
            EmptyState(
                title = "Charts are warming up — back in a moment.",
                modifier = Modifier.animateItem().then(pad),
                message = "The first editions are being written. Nothing is lost while you wait.",
                icon = Icons.Outlined.HourglassEmpty,
                actionTitle = "Retry",
            ) { model.reload() }
        }
        ChartBoardState.SmallCohort -> item(key = "small") {
            ChartsSmallCohortView(board, model.query, model.scopes, Modifier.animateItem().then(pad)) { model.apply(it) }
        }
        ChartBoardState.Ok -> if (board.entries.isEmpty()) {
            item(key = "empty") {
                EmptyState(
                    title = "No chart yet",
                    modifier = Modifier.animateItem().then(pad),
                    message = if (board.chart == ChartSlug.TopDrops) {
                        "No drops are live, released this period or coming up in the next 7 days."
                    } else {
                        "No brand qualifies for this chart in this period yet."
                    },
                    icon = Icons.Outlined.BarChart,
                )
            }
        } else {
            chartsEntries(board, model, pad, maxWidth, onEntry)
        }
    }
}

private fun LazyListScope.chartsEntries(board: ChartBoard, model: ChartsViewModel, pad: Modifier, maxWidth: Dp, onEntry: (ChartEntry) -> Unit) {
    val rows = board.entries.drop(3)
    val head = rows.take(7)
    val tail = rows.drop(7)
    item(key = "podium") { ChartsPodium(board.entries, board.period, Modifier.animateItem().then(pad)) }
    if (chartsOffPodium(board.callouts.biggestClimber) != null || chartsOffPodium(board.callouts.highestDebut) != null) {
        item(key = "callouts") { ChartsCallouts(board.callouts, board.period, Modifier.animateItem().then(pad)) }
    }
    chartsRowList("head", head, board.period, maxWidth, onEntry)
    if (board.sponsored.isNotEmpty()) {
        item(key = "sponsored") { ChartsSponsoredStrip(board.sponsored, Modifier.animateItem().then(pad)) }
    }
    chartsRowList("tail", tail, board.period, maxWidth, onEntry)
    if (model.refreshFailed) {
        item(key = "refresh-failed") {
            Text(
                "Couldn't refresh just now. This is the last edition Yard sent.",
                style = YardFonts.caption,
                color = Color.yard.ink3,
                modifier = Modifier.animateItem().then(pad),
            )
        }
    }
}

/** Rows inside one card, one lazy item per row: the card's outline and the dividers are drawn per segment. */
private fun LazyListScope.chartsRowList(group: String, rows: List<ChartEntry>, period: ChartPeriod, maxWidth: Dp, onEntry: (ChartEntry) -> Unit) {
    if (rows.isEmpty()) return
    itemsIndexed(rows, key = { _, e -> "$group:${e.id}" }, contentType = { _, _ -> "row" }) { index, entry ->
        val first = index == 0
        val last = index == rows.lastIndex
        ChartsRow(
            entry,
            period,
            modifier = Modifier
                .animateItem()
                .chartsContentWidth(maxWidth)
                .padding(horizontal = Spacing.gutter)
                .padding(bottom = if (last) Spacing.l else 0.dp)
                .chartsRowSegment(first, last, Color.yard.surface, Color.yard.line)
                .padding(horizontal = Spacing.m),
        ) { onEntry(entry) }
    }
}

/**
 * [adaptiveContentWidth] with an explicit width, usable while building lazy items (outside composition):
 * fills, centers and caps at [maxWidth] (no cap when unspecified, i.e. on phones).
 */
private fun Modifier.chartsContentWidth(maxWidth: Dp): Modifier =
    if (!maxWidth.isSpecified) fillMaxWidth()
    else fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = maxWidth).fillMaxWidth()

/** One segment of a card split across lazy items: outer corners rounded, hairline outline, inset divider below. */
private fun Modifier.chartsRowSegment(first: Boolean, last: Boolean, fill: Color, line: Color): Modifier {
    val r = Radius.card
    val shape = RoundedCornerShape(
        topStart = if (first) r else 0.dp, topEnd = if (first) r else 0.dp,
        bottomStart = if (last) r else 0.dp, bottomEnd = if (last) r else 0.dp,
    )
    return this
        .clip(shape)
        .background(fill, shape)
        .drawBehind {
            val stroke = 1.dp.toPx()
            val radius = r.toPx()
            // Outline rect extends past the clipped edges that continue into the next segment.
            val top = if (first) stroke / 2 else -radius * 2
            val bottom = if (last) size.height - stroke / 2 else size.height + radius * 2
            val path = Path().apply {
                addRoundRect(RoundRect(stroke / 2, top, size.width - stroke / 2, bottom, CornerRadius(radius - stroke / 2)))
            }
            drawPath(path, line, style = Stroke(width = stroke))
            if (!last) {
                val inset = Spacing.m.toPx()
                drawLine(line, Offset(inset, size.height - stroke / 2), Offset(size.width - inset, size.height - stroke / 2), strokeWidth = stroke)
            }
        }
}

@Composable
private fun ChartsErrorState(error: Throwable, modifier: Modifier = Modifier, retry: () -> Unit) {
    val limited = (error as? APIError)?.isRateLimited ?: false
    EmptyState(
        title = "Couldn't load this chart.",
        modifier = modifier,
        message = if (limited) {
            "Charts were loaded a lot from here in the last minute. Wait a moment, then try again. Your filters are kept."
        } else {
            APIError.messageFor(error)
        },
        icon = Icons.Outlined.ErrorOutline,
        actionTitle = "Retry",
        action = retry,
    )
}

// endregion

// region How Charts work

@Composable
private fun ChartsHowItWorks(expanded: Boolean, onToggle: () -> Unit, modifier: Modifier = Modifier) {
    val rotation by animateFloatAsState(if (expanded) 180f else 0f, Motion.spring(), label = "how-chevron")
    Column(modifier.fillMaxWidth().yardCard()) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClickLabel = if (expanded) "Collapse" else "Expand", onClick = onToggle)
                .padding(Spacing.l),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(20.dp))
            Text("How Charts work", style = YardFonts.bodyEmphasis, color = Color.yard.ink, modifier = Modifier.weight(1f))
            Icon(Icons.Outlined.ExpandMore, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(20.dp).rotate(rotation))
        }
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn(Motion.fade()) + expandVertically(Motion.spring()),
            exit = fadeOut(Motion.fade()) + shrinkVertically(Motion.spring()),
        ) {
            Column(
                Modifier.padding(start = Spacing.l, end = Spacing.l, bottom = Spacing.l),
                verticalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                ChartsHowPoint("What counts", "Follows, saves, product and storefront views, drop reminders, messages and post opens, plus orders. Follower growth, views and saves carry most of the weight, and an account adds at most one follow per brand however often it taps.")
                ChartsHowPoint("Sales are capped", "Orders and sales make up at most a quarter of a brand's score, so no chart is ranked by sales alone.")
                ChartsHowPoint("Newer brands get a lift", "Brands under 30,000 followers that joined in the last 18 months get a small boost on Top brands, Trending and City charts.")
                ChartsHowPoint("Unusual activity is left out", "Bursts from new accounts, one network or coordinated follows are excluded. A brand under review is held off the charts until Yard decides.")
                ChartsHowPoint("Sponsored is separate", "Paid placements appear in their own labelled strip. They never change a chart position.")
            }
        }
    }
}

@Composable
private fun ChartsHowPoint(title: String, text: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = YardFonts.captionEmphasis, color = Color.yard.ink)
        Text(text, style = YardFonts.callout, color = Color.yard.ink2)
    }
}

// endregion

// region Small cohort

/**
 * A scope with too few eligible brands (website SmallCohortState): says why and offers only
 * actions that lead to a board that has a chart.
 */
@Composable
fun ChartsSmallCohortView(
    board: ChartBoard,
    query: ChartsQuery,
    scopes: ChartScopes?,
    modifier: Modifier = Modifier,
    onChange: (ChartsQuery) -> Unit,
) {
    val content = remember(board, query, scopes) { chartsSmallCohortContent(board, query, scopes) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        EmptyState(title = content.title, message = content.message, icon = Icons.Outlined.LocationOff)
        // Buttons stay button-sized on tablets instead of stretching across the board.
        Column(Modifier.adaptiveContentWidth(maxWidth = 420.dp), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
            content.actions.forEach { action ->
                YardButton(action.title, style = YardButtonStyle.Secondary, size = YardButtonSize.Medium) { onChange(action.query) }
            }
        }
    }
}

private data class ChartsCohortAction(val id: String, val title: String, val query: ChartsQuery)
private data class ChartsCohortContent(val title: String, val message: String, val actions: List<ChartsCohortAction>)

private fun chartsBrandWord(n: Int) = if (n == 1) "brand" else "brands"

private fun chartsSmallCohortContent(board: ChartBoard, query: ChartsQuery, scopes: ChartScopes?): ChartsCohortContent {
    val minCohort = scopes?.minCohort ?: 3
    val place = board.scope.city?.name ?: board.scope.country?.name
    val category = board.scope.category?.label
    val n = board.cohortSize
    val fallbackCountry = board.fallback?.country
    val nearestCity = board.fallback?.nearestCity
    val categoryEverywhere = query.category?.let { slug -> scopes?.categories?.firstOrNull { it.slug == slug }?.eligible ?: 0 } ?: Int.MAX_VALUE
    val placeAll = board.scope.city?.let { c -> scopes?.cities?.firstOrNull { it.slug == c.slug }?.eligible ?: 0 }
        ?: board.scope.country?.let { k -> scopes?.countries?.firstOrNull { it.code == k.code }?.eligible ?: 0 }
        ?: 0

    val actions = mutableListOf<ChartsCohortAction>()
    val city = board.scope.city
    if (query.chart == ChartSlug.City && city != null) {
        if (category != null && placeAll >= minCohort) {
            actions += ChartsCohortAction("all", "Show all categories", ChartsQuery(chart = ChartSlug.City, period = query.period, city = query.city))
        }
        if (fallbackCountry != null && fallbackCountry.eligible >= minCohort) {
            actions += ChartsCohortAction("country", "See Top brands in ${fallbackCountry.name}", ChartsQuery(chart = ChartSlug.Top, period = query.period, country = fallbackCountry.code))
        } else {
            actions += ChartsCohortAction("everywhere", "See Top brands everywhere", ChartsQuery(chart = ChartSlug.Top, period = query.period))
        }
        if (category == null && nearestCity != null) {
            actions += ChartsCohortAction("near", "See ${nearestCity.name}", query.copy(city = nearestCity.slug, country = null))
        }
        val title = category?.let { "Not enough $it brands in ${city.name} yet." } ?: "Not enough brands in ${city.name} for a city chart yet."
        val message = if (category != null) {
            "A chart needs at least $minCohort brands. " + if (n == 0) "No $category brand in ${city.name} is on the charts right now." else "${city.name} has $n $category ${chartsBrandWord(n)} on the charts right now."
        } else {
            "A city chart needs at least $minCohort brands. " + if (n == 0) "No brand in ${city.name} is on the charts right now." else "${city.name} has $n ${chartsBrandWord(n)} on the charts right now."
        }
        return ChartsCohortContent(title, message, actions)
    }

    val title = when {
        place != null && category != null -> "Not enough $category brands in $place yet."
        place != null -> "Not enough brands in $place yet."
        category != null -> "Not enough $category brands yet."
        else -> "Not enough brands on this chart yet."
    }
    val whereText = when {
        place != null && category != null -> "$place has $n $category ${chartsBrandWord(n)}"
        place != null -> "$place has $n ${chartsBrandWord(n)}"
        else -> "There ${if (n == 1) "is" else "are"} $n ${category?.let { "$it " } ?: ""}${chartsBrandWord(n)}"
    }
    if (place != null && categoryEverywhere >= minCohort) {
        actions += ChartsCohortAction("everywhere", "Show everywhere", ChartsQuery(chart = query.chart, period = query.period, category = query.category))
    }
    if (category != null && place != null && placeAll >= minCohort) {
        actions += ChartsCohortAction("all", "Show all categories", ChartsQuery(chart = query.chart, period = query.period, country = if (query.city == null) query.country else null, city = query.city))
    }
    if (actions.isEmpty()) {
        actions += ChartsCohortAction("clear", "Show ${query.chart.label} everywhere", ChartsQuery(chart = query.chart, period = query.period))
    }
    return ChartsCohortContent(title, "A filtered chart needs at least $minCohort brands. $whereText on the charts right now.", actions)
}

// endregion

// region Previews

@Preview(name = "ChartsView — dark")
@Composable
private fun ChartsViewDarkPreview() = YardPreview(darkTheme = true) { ChartsView() }

@Preview(name = "ChartsView — light")
@Composable
private fun ChartsViewLightPreview() = YardPreview(darkTheme = false) { ChartsView() }

@YardTabletPreviews
@Composable
private fun ChartsViewTabletPreview() = YardPreview(darkTheme = true) { ChartsView() }

@Preview(name = "Small cohort — dark")
@Composable
private fun ChartsSmallCohortDarkPreview() = YardPreview(darkTheme = true) {
    Box(Modifier.fillMaxSize().background(Color.yard.bg).padding(16.dp)) {
        ChartsSmallCohortView(
            board = ChartBoard.make(
                chart = ChartSlug.City,
                period = ChartPeriod.Weekly,
                scope = ChartScopeInfo(key = "city:accra", city = ChartScopeInfo.City("accra", "Accra", "GH")),
                state = ChartBoardState.SmallCohort,
                edition = null,
                cohortSize = 2,
                entries = emptyList(),
                fallback = ChartFallback(nearestCity = ChartFallback.NearCity("lagos", "Lagos", 6)),
            ),
            query = ChartsQuery(chart = ChartSlug.City, city = "accra"),
            scopes = ChartsFiltersPreview.scopes,
        ) {}
    }
}

@Preview(name = "Small cohort — light")
@Composable
private fun ChartsSmallCohortLightPreview() = YardPreview(darkTheme = false) {
    Box(Modifier.fillMaxSize().background(Color.yard.bg).padding(16.dp)) {
        ChartsSmallCohortView(
            board = ChartBoard.make(
                chart = ChartSlug.Top,
                period = ChartPeriod.Daily,
                scope = ChartScopeInfo(key = "country:GH", country = ChartScopeInfo.Country("GH", "Ghana")),
                state = ChartBoardState.SmallCohort,
                edition = null,
                cohortSize = 2,
                entries = emptyList(),
            ),
            query = ChartsQuery(chart = ChartSlug.Top, period = ChartPeriod.Daily, country = "GH"),
            scopes = ChartsFiltersPreview.scopes,
        ) {}
    }
}

// endregion
