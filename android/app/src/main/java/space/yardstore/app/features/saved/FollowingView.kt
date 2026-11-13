package space.yardstore.app.features.saved

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.PersonRemove
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.DropsPage
import space.yardstore.app.core.models.FollowedBrand
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.FollowStore
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.MasonrySkeleton
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.ToastCenter
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

// Following feed, mirroring the website's production /following
// (src/components/market/account/live-following-feed.tsx). Mirrors FollowingView.swift.
//
//   GET    /api/follows                                         (FollowStore.load)
//   GET    /api/catalog/products?brand={brandId}&sort=new&limit=6   per followed brand (max 24 brands)
//   GET    /api/drops?phase=live&source=brands&limit=50         } filtered to followed brands
//   GET    /api/drops?phase=upcoming&source=brands&limit=50     }
//   GET    /api/catalog/brands?sort=new&limit=8                 suggestions
//   POST/DELETE /api/follows                                    (FollowStore.setFollowing)

class FollowingViewModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    var phase: Phase by mutableStateOf(Phase.Idle)
        private set
    /**
     * "You follow" rows, kept stable for the visit: unfollowing flips the button instead of
     * pulling the row away (same rule as the website).
     */
    var rows: List<FollowedBrand> by mutableStateOf(emptyList())
        private set
    /** Newest pieces from followed brands; null while loading. */
    var pieces: List<Product>? by mutableStateOf(null)
        private set
    var drops: List<Drop> by mutableStateOf(emptyList())
        private set
    var suggested: List<BrandCard>? by mutableStateOf(null)
        private set
    var limit: Int by mutableStateOf(PAGE)
    /** Brands with a follow/unfollow in flight. */
    var busyBrandIds: Set<String> by mutableStateOf(emptySet())
        private set
    var isRefreshing: Boolean by mutableStateOf(false)
        private set

    private var loadJob: Job? = null

    /**
     * @param keepRows keep this visit's "You follow" rows (unfollowed ones stay, showing Follow)
     *   and append new follows; false on first load and pull to refresh.
     */
    fun load(follows: FollowStore, keepRows: Boolean = false): Job {
        loadJob?.cancel()
        val job = viewModelScope.launch {
            if (rows.isEmpty()) phase = Phase.Loading
            follows.load()
            val error = follows.lastError
            if (error != null && follows.items.isEmpty()) {
                phase = Phase.Failed(error.message)
                return@launch
            }
            val items = follows.items
            rows = if (keepRows) rows + items.filter { item -> rows.none { it.brandId == item.brandId } } else items
            phase = Phase.Loaded

            coroutineScope {
                val suggestionsTask = async { fetchSuggestions(api) }
                val piecesTask = async { fetchPieces(items.take(MAX_BRANDS).map { it.brandId }, api) }
                val dropsTask = async { fetchDrops(items.map { it.brandId }.toSet(), api) }
                val newPieces = piecesTask.await()
                val newDrops = dropsTask.await()
                val newSuggestions = suggestionsTask.await()
                pieces = newPieces
                drops = newDrops
                suggested = newSuggestions
                limit = PAGE
            }
        }
        loadJob = job
        return job
    }

    /** Pull to refresh. */
    fun refresh(follows: FollowStore) {
        viewModelScope.launch {
            isRefreshing = true
            try { load(follows).join() } finally { isRefreshing = false }
        }
    }

    fun showMore() {
        limit += PAGE
    }

    fun suggestions(follows: FollowStore): List<BrandCard> {
        val rowIds = rows.map { it.brandId }.toSet()
        return (suggested ?: emptyList()).filter { it.id !in rowIds && !follows.isFollowing(it.id) }.take(4)
    }

    fun brandName(drop: Drop): String {
        val name = drop.brand.name
        if (!name.isNullOrEmpty()) return name
        return rows.firstOrNull { it.brandId == drop.brand.id }?.name ?: ""
    }

    fun setFollowing(follow: Boolean, brandId: String, name: String, follows: FollowStore, toast: ToastCenter, onChanged: () -> Unit) {
        busyBrandIds = busyBrandIds + brandId
        viewModelScope.launch {
            try {
                follows.setFollowing(follow, brandId)
                onChanged()
                toast.show(if (follow) "Following $name" else "Unfollowed $name", Toast.Style.Success)
                if (follow) {
                    // Pull the new brand into the feed.
                    load(follows, keepRows = true)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            } finally {
                busyBrandIds = busyBrandIds - brandId
            }
        }
    }

    companion object {
        const val PER_BRAND: Int = 6
        const val PAGE: Int = 12
        const val MAX_BRANDS: Int = 24

        // Fetching runs off the main thread; per-brand requests run in parallel.

        suspend fun fetchPieces(brandIds: List<String>, api: APIClient = APIClient.shared): List<Product> {
            if (brandIds.isEmpty()) return emptyList()
            val all = withContext(Dispatchers.IO) {
                brandIds.map { brandId ->
                    async {
                        try {
                            val page: ProductsPage = api.get(
                                "/api/catalog/products",
                                listOf("brand" to brandId, "sort" to "new", "limit" to PER_BRAND.toString()),
                            )
                            page.products
                        } catch (e: CancellationException) {
                            throw e
                        } catch (_: Exception) {
                            emptyList()
                        }
                    }
                }.awaitAll().flatten()
            }
            return all.sortedByDescending { it.publishedAt ?: it.createdAt }
        }

        suspend fun fetchDrops(brandIds: Set<String>, api: APIClient = APIClient.shared): List<Drop> {
            if (brandIds.isEmpty()) return emptyList()
            val result = mutableListOf<Drop>()
            withContext(Dispatchers.IO) {
                for (phase in listOf("live", "upcoming")) {
                    try {
                        val page: DropsPage = api.get(
                            "/api/drops",
                            listOf("phase" to phase, "source" to "brands", "limit" to "50"),
                        )
                        result += page.items.filter { it.brand.id in brandIds }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (_: Exception) {
                        // Leave this phase out.
                    }
                }
            }
            return result.distinctBy { it.id }
        }

        suspend fun fetchSuggestions(api: APIClient = APIClient.shared): List<BrandCard> = withContext(Dispatchers.IO) {
            try {
                val page: BrandsPage = api.get("/api/catalog/brands", listOf("sort" to "new", "limit" to "8"))
                page.brands
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                emptyList()
            }
        }
    }
}

@Composable
fun FollowingView() {
    val session = LocalSessionStore.current
    val follows = LocalFollowStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val model: FollowingViewModel = viewModel { FollowingViewModel() }
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + LocalTabPillClearance.current

    LaunchedEffect(session.shopper?.id) {
        if (session.isSignedIn) model.load(follows)
    }

    fun setFollowing(follow: Boolean, brandId: String, name: String) {
        if (!session.isSignedIn) {
            router.present(Route.SignIn)
            return
        }
        model.setFollowing(follow, brandId, name, follows, toast) {
            haptics.performHapticFeedback(if (follow) HapticFeedbackType.ToggleOn else HapticFeedbackType.ToggleOff)
        }
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Following")
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (!session.isSignedIn) {
                SavedSignInInvite(
                    title = "Following",
                    message = "Follow brands and their new pieces, collections, drop announcements and stories arrive here, in the order they happen. Sign in to start.",
                    icon = Icons.Outlined.Sensors,
                    bottomPadding = bottom,
                ) { router.present(Route.SignIn) }
            } else {
                when (val phase = model.phase) {
                    FollowingViewModel.Phase.Idle, FollowingViewModel.Phase.Loading -> Column(
                        Modifier
                            .fillMaxSize()
                            .padding(top = Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
                    ) {
                        FollowingHeader(model.rows.size)
                        FollowingAvatarSkeleton()
                        MasonrySkeleton(Modifier.padding(horizontal = Spacing.gridGap), count = 4)
                    }
                    is FollowingViewModel.Phase.Failed -> EmptyState(
                        "Your feed couldn't be loaded",
                        modifier = Modifier.fillMaxSize(),
                        message = phase.message,
                        icon = Icons.Outlined.WifiOff,
                        actionTitle = "Retry",
                        action = { model.load(follows) },
                    )
                    FollowingViewModel.Phase.Loaded -> FollowingLoaded(
                        model = model,
                        follows = follows,
                        bottomPadding = bottom,
                        onPush = { router.push(it) },
                        onSetFollowing = ::setFollowing,
                    )
                }
            }
        }
    }
}

@Composable
private fun FollowingHeader(count: Int, modifier: Modifier = Modifier) {
    val subtitle = if (count > 0) {
        "New pieces and drops from the ${if (count == 1) "brand" else "$count brands"} you follow, newest first."
    } else {
        "Updates from the brands you follow, in the order they happen."
    }
    SavedScreenHeader(title = "Following", subtitle = subtitle, modifier = modifier)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FollowingLoaded(
    model: FollowingViewModel,
    follows: FollowStore,
    bottomPadding: Dp,
    onPush: (Route) -> Unit,
    onSetFollowing: (follow: Boolean, brandId: String, name: String) -> Unit,
) {
    val gap = Spacing.gridGap
    val sectionGap = Spacing.xl - gap
    val refreshState = rememberPullToRefreshState()
    val followedDrops = model.drops.filter { follows.isFollowing(it.brand.id) }
    val suggestions = model.suggestions(follows)
    val pieces = model.pieces

    PullToRefreshBox(
        isRefreshing = model.isRefreshing,
        onRefresh = { model.refresh(follows) },
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
        LazyVerticalStaggeredGrid(
            columns = StaggeredGridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = gap, end = gap, top = Spacing.l, bottom = Spacing.xxl + bottomPadding),
            verticalItemSpacing = gap,
            horizontalArrangement = Arrangement.spacedBy(gap),
        ) {
            item(key = "header", span = StaggeredGridItemSpan.FullLine) {
                FollowingHeader(model.rows.size, Modifier.savedFullBleed(gap).padding(bottom = sectionGap))
            }
            if (model.rows.isEmpty()) {
                item(key = "empty", span = StaggeredGridItemSpan.FullLine) {
                    EmptyState(
                        "You're not following any brands yet",
                        modifier = Modifier.heightIn(min = 300.dp).padding(bottom = sectionGap),
                        message = "Follow a few and their new pieces land here, newest first.",
                        icon = Icons.Outlined.Sensors,
                        actionTitle = "Browse brands",
                        action = { onPush(Route.BrandsDirectory) },
                    )
                }
            } else {
                item(key = "follow-row", span = StaggeredGridItemSpan.FullLine) {
                    FollowingFollowRow(
                        rows = model.rows,
                        follows = follows,
                        busyBrandIds = model.busyBrandIds,
                        modifier = Modifier.savedFullBleed(gap).padding(bottom = sectionGap),
                        onOpen = { onPush(Route.Brand(it.handle)) },
                        onSetFollowing = onSetFollowing,
                    )
                }
                if (followedDrops.isNotEmpty()) {
                    item(key = "drops", span = StaggeredGridItemSpan.FullLine) {
                        FollowingDropsRail(
                            drops = followedDrops,
                            brandName = model::brandName,
                            modifier = Modifier.savedFullBleed(gap).padding(bottom = sectionGap),
                            onOpen = { drop -> onPush(Route.Drop(drop.slug.ifEmpty { drop.id })) },
                        )
                    }
                }
                item(key = "pieces-header", span = StaggeredGridItemSpan.FullLine) {
                    SectionHeader("New pieces", Modifier.savedFullBleed(gap).padding(bottom = Spacing.s - gap))
                }
                when {
                    pieces == null -> item(key = "pieces-skeleton", span = StaggeredGridItemSpan.FullLine) {
                        MasonrySkeleton(Modifier.padding(bottom = sectionGap), count = 4)
                    }
                    pieces.isEmpty() -> item(key = "pieces-empty", span = StaggeredGridItemSpan.FullLine) {
                        EmptyState(
                            "Brands you follow will post here",
                            modifier = Modifier.heightIn(min = 240.dp).padding(bottom = sectionGap),
                            message = "Their new pieces appear here the day they're published.",
                            icon = Icons.Outlined.AutoAwesome,
                        )
                    }
                    else -> {
                        val shown = pieces.take(model.limit)
                        items(shown, key = { it.id }) { product ->
                            ProductTile(
                                product,
                                Modifier
                                    .animateItem()
                                    .pressableClick(onClickLabel = "Open ${product.title}") { onPush(Route.Product(product.slug)) },
                            )
                        }
                        item(key = "pieces-more", span = StaggeredGridItemSpan.FullLine) {
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(top = Spacing.s - gap, bottom = sectionGap),
                                contentAlignment = Alignment.Center,
                            ) {
                                if (pieces.size > model.limit) {
                                    YardButton("Show more", style = YardButtonStyle.Secondary, size = YardButtonSize.Medium, fullWidth = false) {
                                        model.showMore()
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (suggestions.isNotEmpty()) {
                item(key = "suggestions", span = StaggeredGridItemSpan.FullLine) {
                    FollowingSuggestions(
                        title = if (model.rows.isEmpty()) "Brands to start with" else "More brands on Yard",
                        brands = suggestions,
                        busyBrandIds = model.busyBrandIds,
                        modifier = Modifier.savedFullBleed(gap),
                        onAll = { onPush(Route.BrandsDirectory) },
                        onOpen = { onPush(Route.Brand(it.handle)) },
                        onFollow = { onSetFollowing(true, it.id, it.name) },
                    )
                }
            }
        }
    }
}

// MARK: You follow (avatars)

@Composable
private fun FollowingFollowRow(
    rows: List<FollowedBrand>,
    follows: FollowStore,
    busyBrandIds: Set<String>,
    modifier: Modifier = Modifier,
    onOpen: (FollowedBrand) -> Unit,
    onSetFollowing: (follow: Boolean, brandId: String, name: String) -> Unit,
) {
    val count = follows.followedIds.size
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        SectionHeader("You follow", subtitle = "$count ${if (count == 1) "brand" else "brands"}")
        LazyRow(
            contentPadding = PaddingValues(horizontal = Spacing.gutter),
            horizontalArrangement = Arrangement.spacedBy(Spacing.l),
            verticalAlignment = Alignment.Top,
        ) {
            items(rows, key = { it.brandId }) { brand ->
                FollowingBrandCell(
                    brand = brand,
                    isFollowing = follows.isFollowing(brand.brandId),
                    isBusy = brand.brandId in busyBrandIds,
                    onOpen = { onOpen(brand) },
                    onSetFollowing = { onSetFollowing(it, brand.brandId, brand.name) },
                )
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun FollowingBrandCell(
    brand: FollowedBrand,
    isFollowing: Boolean,
    isBusy: Boolean,
    onOpen: () -> Unit,
    onSetFollowing: (Boolean) -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Column(
        Modifier.width(76.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Box {
            Column(
                Modifier.combinedClickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    role = Role.Button,
                    onLongClickLabel = "More actions",
                    onLongClick = { menuOpen = true },
                    onClick = onOpen,
                ),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(Spacing.xs),
            ) {
                BrandAvatar(brand.name, Modifier.alpha(if (isFollowing) 1f else 0.5f), size = 64.dp, verified = brand.verified)
                Text(
                    brand.name,
                    style = YardFonts.captionEmphasis,
                    color = Color.yard.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            // Long press: the iOS context menu.
            DropdownMenu(
                expanded = menuOpen,
                onDismissRequest = { menuOpen = false },
                shape = YardShapes.small,
                containerColor = Color.yard.surface,
            ) {
                DropdownMenuItem(
                    text = { Text("View brand", style = YardFonts.body) },
                    leadingIcon = { Icon(Icons.Outlined.Storefront, contentDescription = null) },
                    onClick = {
                        menuOpen = false
                        onOpen()
                    },
                    colors = MenuDefaults.itemColors(textColor = Color.yard.ink, leadingIconColor = Color.yard.ink),
                )
                if (isFollowing) {
                    DropdownMenuItem(
                        text = { Text("Unfollow", style = YardFonts.body) },
                        leadingIcon = { Icon(Icons.Outlined.PersonRemove, contentDescription = null) },
                        onClick = {
                            menuOpen = false
                            onSetFollowing(false)
                        },
                        colors = MenuDefaults.itemColors(textColor = Color.yard.danger, leadingIconColor = Color.yard.danger),
                    )
                }
            }
        }
        Box(
            Modifier
                .size(width = 72.dp, height = 26.dp)
                .semantics { contentDescription = if (isFollowing) "Unfollow ${brand.name}" else "Follow ${brand.name}" }
                .pressableClick(enabled = !isBusy) { onSetFollowing(!isFollowing) }
                .background(if (isFollowing) Color.yard.surface2 else Color.yard.acid, YardShapes.pill),
            contentAlignment = Alignment.Center,
        ) {
            val fg = if (isFollowing) Color.yard.ink else Color.yard.onAcid
            if (isBusy) {
                CircularProgressIndicator(color = fg, strokeWidth = 1.5.dp, modifier = Modifier.size(12.dp))
            } else {
                Text(if (isFollowing) "Following" else "Follow", style = YardFonts.micro, color = fg)
            }
        }
    }
}

// MARK: Drops

@Composable
private fun FollowingDropsRail(
    drops: List<Drop>,
    brandName: (Drop) -> String,
    modifier: Modifier = Modifier,
    onOpen: (Drop) -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        SectionHeader("Drops", subtitle = "Live and coming up from brands you follow")
        LazyRow(
            contentPadding = PaddingValues(horizontal = Spacing.gutter),
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
            verticalAlignment = Alignment.Top,
        ) {
            items(drops, key = { it.id }) { drop ->
                FollowingDropCard(drop, brandName(drop), Modifier.pressableClick { onOpen(drop) })
            }
        }
    }
}

// MARK: Suggestions

@Composable
private fun FollowingSuggestions(
    title: String,
    brands: List<BrandCard>,
    busyBrandIds: Set<String>,
    modifier: Modifier = Modifier,
    onAll: () -> Unit,
    onOpen: (BrandCard) -> Unit,
    onFollow: (BrandCard) -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        SectionHeader(
            title,
            subtitle = "Independent studios with their own storefront on Yard.",
            actionTitle = "All brands",
            action = onAll,
        )
        Card(Modifier.padding(horizontal = Spacing.gutter), padding = 0.dp) {
            brands.forEachIndexed { index, brand ->
                if (index > 0) YardDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(Spacing.m),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(
                        Modifier
                            .weight(1f)
                            .pressableClick { onOpen(brand) },
                        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        BrandAvatar(brand.name, logoUrl = brand.logoUrl, size = 44.dp, verified = brand.verified)
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(brand.name, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (brand.locationText.isNotEmpty()) {
                                Text(brand.locationText, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                        }
                    }
                    YardButton(
                        "Follow",
                        style = YardButtonStyle.Primary,
                        size = YardButtonSize.Small,
                        isLoading = brand.id in busyBrandIds,
                        fullWidth = false,
                    ) { onFollow(brand) }
                }
            }
        }
    }
}

// MARK: Previews

@Preview(name = "FollowingView — dark")
@Composable
private fun FollowingViewDark() = YardPreview(darkTheme = true) { FollowingView() }

@Preview(name = "FollowingView — light")
@Composable
private fun FollowingViewLight() = YardPreview(darkTheme = false) { FollowingView() }

@Preview(name = "FollowingView — signed out")
@Composable
private fun FollowingViewSignedOut() = YardPreview(darkTheme = false, signedIn = false) { FollowingView() }

private val previewFollowed = listOf(
    FollowedBrand(brandId = "brd_preview", handle = "acme", name = "Acme Studio", verified = true),
    FollowedBrand(brandId = "brd_two", handle = "two", name = "Second Hand"),
)

@Preview(name = "Following sections — dark")
@Composable
private fun FollowingSectionsDark() = YardPreview(darkTheme = true) {
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        Row(Modifier.padding(horizontal = Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
            FollowingBrandCell(previewFollowed[0], isFollowing = true, isBusy = false, onOpen = {}, onSetFollowing = {})
            FollowingBrandCell(previewFollowed[1], isFollowing = false, isBusy = false, onOpen = {}, onSetFollowing = {})
            FollowingBrandCell(previewFollowed[1], isFollowing = true, isBusy = true, onOpen = {}, onSetFollowing = {})
        }
        FollowingSuggestions("More brands on Yard", listOf(PreviewFixtures.brandCard), emptySet(), onAll = {}, onOpen = {}, onFollow = {})
    }
}

@Preview(name = "Following sections — light")
@Composable
private fun FollowingSectionsLight() = YardPreview(darkTheme = false) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        Row(Modifier.padding(horizontal = Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.l)) {
            FollowingBrandCell(previewFollowed[0], isFollowing = true, isBusy = false, onOpen = {}, onSetFollowing = {})
            FollowingBrandCell(previewFollowed[1], isFollowing = false, isBusy = false, onOpen = {}, onSetFollowing = {})
        }
        FollowingSuggestions("Brands to start with", listOf(PreviewFixtures.brandCard), setOf(PreviewFixtures.brandCard.id), onAll = {}, onOpen = {}, onFollow = {})
    }
}
