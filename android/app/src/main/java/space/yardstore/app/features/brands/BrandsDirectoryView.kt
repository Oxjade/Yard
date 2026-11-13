package space.yardstore.app.features.brands

import androidx.compose.animation.core.animateFloatAsState
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
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.BrandCard
import space.yardstore.app.core.models.BrandsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.ChipRow
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground

// The brands directory (website: /brands, LiveBrandDirectory). Mirrors BrandsDirectoryView.swift.
//
//   GET /api/catalog/brands?q=&category=&founding=1&sort=name|new&limit=24&offset=
//       → BrandsPage { brands, total, nextOffset }
//
// Search (name, handle or city), sort chips (A–Z / New on Yard), a Founding chip and category
// chips (only categories the listed brands actually sell in), infinite scroll, Follow per card.

// region Model

class BrandsDirectoryModel(
    private val api: APIClient = APIClient.shared,
    /** Keeps the search and filters across process death (the ViewModel covers rotation). */
    private val savedState: SavedStateHandle = SavedStateHandle(),
) : ViewModel() {
    enum class Sort(val raw: String, val title: String) {
        Name("name", "A–Z"),
        New("new", "New on Yard"),
    }

    private var queryState by mutableStateOf(savedState.get<String>(KEY_QUERY).orEmpty())
    private var categoryState by mutableStateOf(savedState.get<String>(KEY_CATEGORY))
    private var foundingOnlyState by mutableStateOf(savedState.get<Boolean>(KEY_FOUNDING) ?: false)
    private var sortState by mutableStateOf(Sort.entries.firstOrNull { it.raw == savedState.get<String>(KEY_SORT) } ?: Sort.Name)

    var query: String
        get() = queryState
        set(value) { queryState = value; savedState[KEY_QUERY] = value }
    var category: String?
        get() = categoryState
        set(value) { categoryState = value; savedState[KEY_CATEGORY] = value }
    var foundingOnly: Boolean
        get() = foundingOnlyState
        set(value) { foundingOnlyState = value; savedState[KEY_FOUNDING] = value }
    var sort: Sort
        get() = sortState
        set(value) { sortState = value; savedState[KEY_SORT] = value.raw }

    var brands: List<BrandCard> by mutableStateOf(emptyList()); private set
    var total: Int by mutableStateOf(0); private set
    var nextOffset: Int? by mutableStateOf(null); private set
    var isLoading: Boolean by mutableStateOf(false); private set
    var isLoadingMore: Boolean by mutableStateOf(false); private set
    var loadError: Throwable? by mutableStateOf(null); private set
    var loadMoreFailed: Boolean by mutableStateOf(false); private set
    var hasLoaded: Boolean by mutableStateOf(false); private set
    /** Total of the unfiltered first page (null until known). 0 → "Brands are joining Yard". */
    var unfilteredTotal: Int? by mutableStateOf(null); private set
    /** Category slugs present among listed brands (from the first unfiltered page). */
    var categoryOptions: List<String> by mutableStateOf(emptyList()); private set
    /** Whether any listed brand is a founding brand (else the Founding chip is hidden). */
    var hasFoundingBrands: Boolean by mutableStateOf(false); private set

    /** The request key the current results belong to (skips reloading after a config change). */
    var loadedKey: String? = null; private set
    private var ticket = 0

    val trimmedQuery: String get() = query.trim()
    val isNarrowing: Boolean get() = trimmedQuery.isNotEmpty() || category != null || foundingOnly
    /** Changes whenever the request changes (drives the reload effect). */
    val requestKey: String get() = "$trimmedQuery|${category.orEmpty()}|$foundingOnly|${sort.raw}"

    fun clearFilters() {
        query = ""
        category = null
        foundingOnly = false
    }

    private fun queryItems(offset: Int): List<Pair<String, String?>> = buildList {
        add("sort" to sort.raw)
        add("limit" to PAGE_SIZE.toString())
        add("offset" to offset.toString())
        val q = trimmedQuery
        if (q.isNotEmpty()) add("q" to q.take(60))
        category?.let { add("category" to it) }
        if (foundingOnly) add("founding" to "1")
    }

    /** Loads the first page for the current filters. Older in-flight loads are ignored. */
    suspend fun reload() {
        ticket += 1
        val mine = ticket
        val narrowing = isNarrowing
        val key = requestKey
        isLoading = true
        loadError = null
        loadMoreFailed = false
        try {
            val page: BrandsPage = api.get("/api/catalog/brands", queryItems(0))
            if (mine != ticket) return
            brands = page.brands
            total = page.total
            nextOffset = page.nextOffset
            if (!narrowing && unfilteredTotal == null) {
                unfilteredTotal = page.total
                val present = page.brands.flatMap { it.categories }.toSet()
                categoryOptions = BrandsCategory.order.filter { it in present }
                hasFoundingBrands = page.brands.any { it.founding || it.foundingBadge }
            }
            loadedKey = key
            isLoading = false
            hasLoaded = true
        } catch (e: CancellationException) {
            if (mine == ticket) isLoading = false
            throw e
        } catch (e: Exception) {
            if (mine != ticket) return
            if (e is APIError && e.isCancelled) return
            loadError = e
            isLoading = false
            hasLoaded = true
        }
    }

    /** Appends the next page (infinite scroll). */
    fun loadMore() {
        val offset = nextOffset ?: return
        if (isLoadingMore || isLoading) return
        val mine = ticket
        isLoadingMore = true
        loadMoreFailed = false
        viewModelScope.launch {
            try {
                val page: BrandsPage = api.get("/api/catalog/brands", queryItems(offset))
                if (mine == ticket) {
                    val known = brands.map { it.id }.toSet()
                    brands = brands + page.brands.filter { it.id !in known }
                    total = page.total
                    nextOffset = page.nextOffset
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (mine == ticket) loadMoreFailed = true
            } finally {
                isLoadingMore = false
            }
        }
    }

    companion object {
        const val PAGE_SIZE = 24
        private const val KEY_QUERY = "brands.query"
        private const val KEY_CATEGORY = "brands.category"
        private const val KEY_FOUNDING = "brands.founding"
        private const val KEY_SORT = "brands.sort"
    }
}

// endregion

// region View

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BrandsDirectoryView() {
    val model: BrandsDirectoryModel = viewModel { BrandsDirectoryModel(savedState = createSavedStateHandle()) }
    val router = LocalRouter.current
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val gridState = rememberLazyGridState()

    val key = model.requestKey
    LaunchedEffect(key) {
        if (model.hasLoaded && model.loadedKey == key) return@LaunchedEffect
        if (model.hasLoaded && model.trimmedQuery.isNotEmpty()) {
            // Debounce typing like the website (250 ms).
            delay(250)
        }
        model.reload()
    }
    LaunchedEffect(gridState.isScrollInProgress) { if (gridState.isScrollInProgress) focus.clearFocus() }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Brands")
        BrandsSearchField(
            value = model.query,
            onValueChange = { model.query = it },
            modifier = Modifier.padding(horizontal = Spacing.gutter).padding(bottom = Spacing.s),
        )
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    try { model.reload() } finally { refreshing = false }
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            when {
                !model.hasLoaded && model.brands.isEmpty() -> BrandsLoadingGrid(Modifier.padding(top = Spacing.l))
                model.unfilteredTotal == 0 && !model.isNarrowing -> BrandsJoiningState { router.push(Route.Drops) }
                else -> BrandsDirectoryList(model, gridState)
            }
        }
    }
}

@Composable
private fun BrandsDirectoryList(model: BrandsDirectoryModel, gridState: androidx.compose.foundation.lazy.grid.LazyGridState) {
    val scope = rememberCoroutineScope()
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + Spacing.xxl
    val columns = LocalYardWindow.current.gridColumns
    val listAlpha by animateFloatAsState(if (model.isLoading) 0.55f else 1f, Motion.fade(), label = "brands-alpha")
    val error = model.loadError
    val showsError = error != null && (model.brands.isEmpty() || !model.isLoading)

    LazyVerticalGrid(
        columns = GridCells.Fixed(columns),
        state = gridState,
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.s, bottom = bottom),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        item(key = "filters", span = { GridItemSpan(maxLineSpan) }) {
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                BrandsFilters(model)
                BrandsCountLine(model)
            }
        }
        when {
            showsError -> item(key = "error", span = { GridItemSpan(maxLineSpan) }) {
                EmptyState(
                    title = "Brands couldn't be loaded",
                    modifier = Modifier.padding(top = Spacing.xl),
                    message = APIError.messageFor(error!!),
                    icon = Icons.Outlined.WifiOff,
                    actionTitle = "Retry",
                ) { scope.launch { model.reload() } }
            }
            model.brands.isEmpty() && model.isLoading -> item(key = "loading", span = { GridItemSpan(maxLineSpan) }) {
                BrandsLoadingGrid(inset = false)
            }
            model.brands.isEmpty() -> item(key = "nomatch", span = { GridItemSpan(maxLineSpan) }) {
                EmptyState(
                    title = "No brands match",
                    modifier = Modifier.padding(top = Spacing.xl),
                    message = "Try another word or category.",
                    icon = Icons.Outlined.Search,
                    actionTitle = "Clear search",
                ) { model.clearFilters() }
            }
            else -> {
                items(model.brands, key = { it.id }) { brand ->
                    BrandDirectoryCard(brand, Modifier.alpha(listAlpha))
                    if (brand.id == model.brands.lastOrNull()?.id) {
                        LaunchedEffect(brand.id, model.brands.size) { model.loadMore() }
                    }
                }
                item(key = "footer", span = { GridItemSpan(maxLineSpan) }) {
                    BrandsFooter(model)
                }
            }
        }
    }
}

@Composable
private fun BrandsFilters(model: BrandsDirectoryModel) {
    if ((model.unfilteredTotal ?: 0) <= 1 && !model.isNarrowing) return
    // The grid's 16dp padding already insets; chip rows scroll edge to edge, so bleed them out.
    Column(Modifier.brandsBleed(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        ChipRow {
            BrandsDirectoryModel.Sort.entries.forEach { sort ->
                Chip(sort.title, isSelected = model.sort == sort) { model.sort = sort }
            }
            if (model.hasFoundingBrands || model.foundingOnly) {
                Chip("Founding", icon = Icons.Filled.AutoAwesome, isSelected = model.foundingOnly) {
                    model.foundingOnly = !model.foundingOnly
                }
            }
        }
        if (model.categoryOptions.size > 1) {
            ChipRow {
                Chip("All", isSelected = model.category == null) { model.category = null }
                model.categoryOptions.forEach { slug ->
                    Chip(
                        BrandsCategory.name(slug) ?: slug.replaceFirstChar { it.uppercase() },
                        isSelected = model.category == slug,
                    ) { model.category = if (model.category == slug) null else slug }
                }
            }
        }
    }
}

@Composable
private fun BrandsCountLine(model: BrandsDirectoryModel) {
    Row(
        Modifier.fillMaxWidth().height(20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val text = if (model.isLoading) {
            "Loading brands…"
        } else {
            "${model.total} ${if (model.total == 1) "brand" else "brands"}${if (model.sort == BrandsDirectoryModel.Sort.New) ", newest first" else ""}"
        }
        Text(text, style = YardFonts.caption, color = Color.yard.ink2, modifier = Modifier.weight(1f))
        if (model.isLoading) {
            CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(14.dp))
        }
    }
}

@Composable
private fun BrandsFooter(model: BrandsDirectoryModel) {
    Box(Modifier.fillMaxWidth().padding(vertical = Spacing.s), contentAlignment = Alignment.Center) {
        if (model.isLoadingMore) {
            CircularProgressIndicator(color = Color.yard.ink2, strokeWidth = 2.dp, modifier = Modifier.size(24.dp))
        } else if (model.loadMoreFailed) {
            YardButton("Load more brands", style = YardButtonStyle.Secondary, size = YardButtonSize.Medium, fullWidth = false) {
                model.loadMore()
            }
        }
    }
}

@Composable
private fun BrandsLoadingGrid(modifier: Modifier = Modifier, inset: Boolean = true) {
    val columns = LocalYardWindow.current.gridColumns
    Column(
        modifier.fillMaxWidth().padding(horizontal = if (inset) Spacing.gutter else 0.dp).semantics { contentDescription = "Loading brands" },
        verticalArrangement = Arrangement.spacedBy(Spacing.l),
    ) {
        repeat(3) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                repeat(columns) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        Skeleton(Modifier.fillMaxWidth().aspectRatio(0.8f), cornerRadius = Radius.image)
                        Skeleton(Modifier.width(110.dp).height(14.dp), cornerRadius = 6.dp)
                        Skeleton(Modifier.width(80.dp).height(12.dp), cornerRadius = 6.dp)
                    }
                }
            }
        }
    }
}

/** The website's BrandsJoining state: no brands listed yet, never sample brands. */
@Composable
private fun BrandsJoiningState(onDrops: () -> Unit) {
    EmptyState(
        title = "Brands are joining Yard — follow along",
        modifier = Modifier.padding(top = Spacing.xl),
        message = "Independent studios are setting up their storefronts now. Their pieces, drops and stories appear here the day they open.",
        icon = Icons.Outlined.Storefront,
        actionTitle = "See upcoming drops",
        action = onDrops,
    )
}

/** Android has no navigation-bar search drawer: a pill search field under the title. */
@Composable
private fun BrandsSearchField(value: String, onValueChange: (String) -> Unit, modifier: Modifier = Modifier) {
    val c = Color.yard
    val focus = LocalFocusManager.current
    Row(
        modifier
            .fillMaxWidth()
            .height(44.dp)
            .background(c.surface2, YardShapes.pill)
            .border(BorderStroke(1.dp, c.line), YardShapes.pill)
            .padding(start = Spacing.m, end = if (value.isEmpty()) Spacing.m else 0.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = c.ink3, modifier = Modifier.size(20.dp))
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
            if (value.isEmpty()) Text("Search brands or cities", style = YardFonts.body, color = c.ink3, maxLines = 1)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                singleLine = true,
                textStyle = YardFonts.body.copy(color = c.ink),
                cursorBrush = SolidColor(c.ink),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Search brands or cities" },
            )
        }
        if (value.isNotEmpty()) {
            // 44dp inside the 44dp pill; the touch target is extended to 48dp.
            Box(
                Modifier
                    .size(44.dp)
                    .clip(CircleShape)
                    .clickable(onClickLabel = "Clear search") { onValueChange("") }
                    .semantics { contentDescription = "Clear search" },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Filled.Cancel, contentDescription = null, tint = c.ink3, modifier = Modifier.size(20.dp))
            }
        }
    }
}

// endregion

// region Card

/**
 * One brand in the directory grid: cover with logo and "Opening soon", name, place · category,
 * founding badge and a Follow pill.
 */
@Composable
fun BrandDirectoryCard(brand: BrandCard, modifier: Modifier = Modifier) {
    val c = Color.yard
    val session = LocalSessionStore.current
    val follows = LocalFollowStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var isBusy by remember { mutableStateOf(false) }
    val isFollowing = follows.isFollowing(brand.id)

    val placeLine = run {
        val place = BrandsPlace.text(brand.city, brand.country)
        val category = BrandsCategory.firstName(brand.categories)
        when {
            category == null -> place
            place.isEmpty() -> category
            else -> "$place · $category"
        }
    }

    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Column(
            Modifier.fillMaxWidth().pressableClick { router.push(Route.Brand(handle = brand.handle)) },
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            BrandDirectoryCover(brand)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        brand.name,
                        style = YardFonts.bodyEmphasis,
                        color = c.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (brand.verified) {
                        Icon(Icons.Filled.Verified, contentDescription = "Verified brand", tint = c.violet, modifier = Modifier.size(14.dp))
                    }
                }
                if (placeLine.isNotEmpty()) {
                    Text(placeLine, style = YardFonts.caption, color = c.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (brand.foundingBadge) BrandsFoundingBadge()
        }

        YardButton(
            title = if (isFollowing) "Following" else "Follow",
            modifier = Modifier.semantics { contentDescription = if (isFollowing) "Following ${brand.name}" else "Follow ${brand.name}" },
            icon = if (isFollowing) Icons.Filled.Check else null,
            style = if (isFollowing) YardButtonStyle.Secondary else YardButtonStyle.Primary,
            size = YardButtonSize.Small,
            isLoading = isBusy,
        ) {
            if (isBusy) return@YardButton
            isBusy = true
            scope.launch {
                try {
                    val result = BrandsFollow.toggle(brand.id, brand.name, session, follows, router, toast)
                    if (result != null) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                } finally {
                    isBusy = false
                }
            }
        }
    }
}

@Composable
private fun BrandDirectoryCover(brand: BrandCard) {
    val c = Color.yard
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(0.8f)
            .clip(YardShapes.image)
            .background(c.surface2)
            .border(BorderStroke(1.dp, c.line), YardShapes.image),
    ) {
        val cover = brand.coverUrl
        if (cover != null) RemoteImage(cover, Modifier.matchParentSize(), maxPixelSize = 700)
        Box(
            Modifier
                .matchParentSize()
                .background(Brush.verticalGradient(0.5f to c.scrim.copy(alpha = 0f), 1f to c.scrim.copy(alpha = 0.45f))),
        )
        BrandAvatar(
            name = brand.name,
            logoUrl = brand.logoUrl,
            size = 44.dp,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(Spacing.s)
                .border(BorderStroke(1.dp, c.onPhoto.copy(alpha = 0.25f)), CircleShape),
        )
        if (!brand.forSale) {
            Tag("Opening soon", Modifier.align(Alignment.TopStart).padding(Spacing.s), style = TagStyle.OnPhoto)
        }
    }
}

// endregion

// region Previews

@Preview(name = "BrandsDirectoryView — dark")
@Composable
private fun BrandsDirectoryDark() = YardPreview(darkTheme = true) { BrandsDirectoryView() }

@Preview(name = "BrandsDirectoryView — light")
@Composable
private fun BrandsDirectoryLight() = YardPreview(darkTheme = false) { BrandsDirectoryView() }

@YardTabletPreviews
@Composable
private fun BrandsDirectoryTablet() = YardPreview(darkTheme = true) { BrandsDirectoryView() }

@Preview(name = "Brand card — dark")
@Composable
private fun BrandCardDark() = YardPreview(darkTheme = true) {
    Row(Modifier.padding(Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        BrandDirectoryCard(PreviewFixtures.brandCard, Modifier.weight(1f))
        BrandDirectoryCard(BrandCard(id = "b2", handle = "soon", name = "Night Shift", city = "Accra", country = "GH", categories = listOf("streetwear"), forSale = false), Modifier.weight(1f))
    }
}

@Preview(name = "Brand card — light")
@Composable
private fun BrandCardLight() = YardPreview(darkTheme = false) {
    Row(Modifier.padding(Spacing.gutter), horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        BrandDirectoryCard(PreviewFixtures.brandCard, Modifier.weight(1f))
        Spacer(Modifier.weight(1f))
    }
}

// endregion
