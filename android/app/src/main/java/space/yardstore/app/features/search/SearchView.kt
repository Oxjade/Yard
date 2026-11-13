package space.yardstore.app.features.search

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Bolt
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Place
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ShoppingBag
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.WifiOff
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.app.tabPillScrollSensor
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Money
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import space.yardstore.app.designsystem.components.yardScreenBackground

/**
 * The Search tab (`SearchView(query = "")`) and the `Route.Search(query)` route. Mirrors `SearchView.swift`.
 *
 * With an empty query it is the tab root: a large search field (focused on appear), recent
 * searches kept on the device, Browse chips (Shop, Charts, Around, Drops, Brands, Categories —
 * the website's search overlay), and "Try" chips from live categories. Typing searches the
 * marketplace (/api/search, debounced, 2+ characters) and lists Brands, Categories and Products,
 * then "See all results for …", which pushes `Route.Search(query)`.
 *
 * With a query (a pushed route or a `/search?q=` link) it shows [SearchResultsView].
 */
@Composable
fun SearchView(query: String) {
    val trimmed = query.trim()
    if (trimmed.isEmpty()) {
        SearchHomeView()
    } else {
        SearchResultsView(query = trimmed)
    }
}

// region Search home (tab root)

private data class SearchBrowseLink(val title: String, val icon: ImageVector, val route: Route)

/** The website's `browseLinks` (minus "Sell on Yard": the app is shopper-only). */
private val searchBrowseLinks = listOf(
    SearchBrowseLink("Shop", Icons.Outlined.ShoppingBag, Route.Shop),
    SearchBrowseLink("Charts", Icons.Outlined.BarChart, Route.Charts),
    SearchBrowseLink("Around", Icons.Outlined.Place, Route.Around),
    SearchBrowseLink("Drops", Icons.Outlined.Bolt, Route.Drops),
    SearchBrowseLink("Brands", Icons.Outlined.Storefront, Route.BrandsDirectory),
    SearchBrowseLink("Categories", Icons.Outlined.GridView, Route.Categories),
)

@Composable
fun SearchHomeView(
    model: SearchLiveModel = viewModel { SearchLiveModel() },
    initialText: String = "",
    /** Previews pass a fixed list; null reads the device's recents. */
    initialRecents: List<String>? = null,
) {
    val router = LocalRouter.current
    val cart = LocalCartStore.current
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current

    var text by rememberSaveable { mutableStateOf(initialText) }
    var recents by remember { mutableStateOf(initialRecents ?: SearchRecents.load()) }
    val focusRequester = remember { FocusRequester() }
    var isFieldFocused by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    val term = text.trim()
    val isTyping = term.length >= SearchLiveModel.MINIMUM_LENGTH

    fun recordRecent(value: String) {
        recents = SearchRecents.record(value)
    }

    fun dismissKeyboard() {
        if (isFieldFocused) focusManager.clearFocus()
    }

    fun submit(value: String) {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return
        recordRecent(trimmed)
        dismissKeyboard()
        router.push(Route.Search(query = trimmed))
    }

    fun productRoute(item: SearchItem): Route {
        val slug = item.slug
        return if (!slug.isNullOrEmpty()) Route.Product(slug = slug) else Route.Search(query = term)
    }

    LaunchedEffect(Unit) { model.loadCategories() }
    LaunchedEffect(term, cart.currency) { model.update(term, cart.currency) }
    // Focus the field when the Search tab root shows (on appear and on switching to the tab).
    LaunchedEffect(router.selectedTab, router.depth) {
        if (router.selectedTab == AppTab.Search && router.depth == 0) {
            if (initialRecents == null) recents = SearchRecents.load()
            delay(350)
            if (router.selectedTab == AppTab.Search && router.depth == 0) {
                runCatching { focusRequester.requestFocus() }
                keyboard?.show()
            }
        } else {
            dismissKeyboard()
        }
    }
    // Scrolling dismisses the keyboard (iOS `.scrollDismissesKeyboard(.interactively)`).
    LaunchedEffect(listState.isScrollInProgress) {
        if (listState.isScrollInProgress) dismissKeyboard()
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        // Header
        Column(
            Modifier
                .fillMaxWidth()
                .statusBarsPadding()
                .padding(top = Spacing.s, bottom = Spacing.s),
            verticalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            YardDisplayText(
                "Search",
                size = 44.sp,
                modifier = Modifier.padding(horizontal = Spacing.gutter).semantics { heading() },
            )
            SearchField(
                text = text,
                onTextChange = { text = it },
                isFocused = isFieldFocused,
                focusRequester = focusRequester,
                onFocusChange = { isFieldFocused = it },
                onSubmit = { submit(term) },
                onClear = {
                    text = ""
                    runCatching { focusRequester.requestFocus() }
                },
                modifier = Modifier.padding(horizontal = Spacing.gutter),
            )
        }

        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().imePadding().tabPillScrollSensor(),
            contentPadding = PaddingValues(top = Spacing.m, bottom = LocalTabPillClearance.current + Spacing.xl),
        ) {
            val sections = SearchSectionGaps(this)
            if (isTyping) {
                // region Typing: live results
                val categories = model.matchingCategories(term)
                val isCurrent = model.term == term
                val phase = model.phase
                val isLoading = !isCurrent || phase == SearchLiveModel.Phase.Loading
                val hasRemote = isCurrent && (model.brands.isNotEmpty() || model.products.isNotEmpty())

                if (phase is SearchLiveModel.Phase.Failed && isCurrent) {
                    sections.gap()
                    item(key = "error", contentType = "error") {
                        SearchInlineError(phase.message) { model.retry(term, cart.currency) }
                    }
                } else if (isLoading && !hasRemote) {
                    sections.gap()
                    item(key = "skeleton", contentType = "skeleton") { SearchRowsSkeleton() }
                }

                if (isCurrent && model.brands.isNotEmpty()) {
                    sections.gap()
                    item(key = "brands-label", contentType = "label") {
                        SearchSectionLabel("Brands", Modifier.padding(bottom = Spacing.xs))
                    }
                    items(model.brands, key = { "brand-${it.brandId}" }, contentType = { "brand" }) { brand ->
                        SearchBrandRow(
                            brand,
                            Modifier.animateItem().clickable {
                                recordRecent(term)
                                dismissKeyboard()
                                router.push(Route.Brand(handle = brand.handle))
                            },
                        )
                    }
                }

                if (categories.isNotEmpty()) {
                    sections.gap()
                    item(key = "categories", contentType = "chips") {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                            SearchSectionLabel("Categories")
                            SearchFlowLayout(Modifier.padding(horizontal = Spacing.gutter)) {
                                categories.forEach { category ->
                                    Chip(category.name, icon = Icons.Outlined.GridView) {
                                        recordRecent(term)
                                        dismissKeyboard()
                                        router.push(Route.Category(slug = category.slug))
                                    }
                                }
                            }
                        }
                    }
                }

                if (isCurrent && model.products.isNotEmpty()) {
                    sections.gap()
                    item(key = "products-label", contentType = "label") {
                        SearchSectionLabel("Products", Modifier.padding(bottom = Spacing.xs))
                    }
                    items(model.products, key = { "product-${it.productId}" }, contentType = { "product" }) { item ->
                        SearchProductRow(
                            item,
                            Modifier.animateItem().clickable {
                                recordRecent(term)
                                dismissKeyboard()
                                router.push(productRoute(item))
                            },
                        )
                    }
                }

                sections.gap()
                if (isCurrent && phase == SearchLiveModel.Phase.Loaded && !hasRemote && categories.isEmpty()) {
                    item(key = "no-matches", contentType = "empty") {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
                            EmptyState(
                                "No matches",
                                message = "Nothing matches “$term”. Try a brand name, a city or a material.",
                                icon = Icons.Outlined.Search,
                            )
                            if (model.tries.isNotEmpty()) {
                                Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                                    SearchSectionLabel("Try")
                                    SearchTryChips(model.tries) { text = it }
                                }
                            }
                        }
                    }
                } else {
                    item(key = "see-all", contentType = "see-all") {
                        val count = if (model.term == term && phase == SearchLiveModel.Phase.Loaded && model.total > 0) model.total else null
                        SearchSeeAllRow(term, count) { submit(term) }
                    }
                }
                // endregion
            } else {
                // region Idle: recents, browse, try
                if (recents.isNotEmpty()) {
                    sections.gap()
                    item(key = "recent-label", contentType = "label") {
                        SearchSectionLabel(
                            "Recent",
                            Modifier.padding(bottom = Spacing.xs),
                            actionTitle = "Clear",
                        ) {
                            SearchRecents.clear()
                            recents = emptyList()
                        }
                    }
                    items(recents, key = { "recent-$it" }, contentType = { "recent" }) { recent ->
                        SearchRecentRow(
                            recent,
                            modifier = Modifier.animateItem(),
                            onSelect = { submit(recent) },
                            onRemove = { recents = SearchRecents.remove(recent) },
                        )
                    }
                }

                sections.gap()
                item(key = "browse", contentType = "chips") {
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        SearchSectionLabel("Browse")
                        SearchFlowLayout(Modifier.padding(horizontal = Spacing.gutter)) {
                            searchBrowseLinks.forEach { link ->
                                Chip(link.title, icon = link.icon) {
                                    dismissKeyboard()
                                    router.push(link.route)
                                }
                            }
                        }
                    }
                }

                if (model.tries.isNotEmpty()) {
                    sections.gap()
                    item(key = "try", contentType = "chips") {
                        Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                            SearchSectionLabel("Try")
                            SearchTryChips(model.tries) { text = it }
                        }
                    }
                }
                // endregion
            }
        }
    }
}

/** Adds the `Spacing.xl` gap iOS puts between sections (none before the first). */
private class SearchSectionGaps(private val scope: LazyListScope) {
    private var count = 0
    fun gap() {
        if (count > 0) {
            val index = count
            scope.item(key = "gap-$index", contentType = "gap") { Spacer(Modifier.height(Spacing.xl)) }
        }
        count += 1
    }
}

// endregion

// region Pieces

@Composable
private fun SearchField(
    text: String,
    onTextChange: (String) -> Unit,
    isFocused: Boolean,
    focusRequester: FocusRequester,
    onFocusChange: (Boolean) -> Unit,
    onSubmit: () -> Unit,
    onClear: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val borderColor by animateColorAsState(
        if (isFocused) Color.yard.ink.copy(alpha = 0.35f) else Color.yard.line,
        Motion.snappy(),
        label = "search-field-border",
    )
    Row(
        modifier
            .fillMaxWidth()
            .height(54.dp)
            .clip(YardShapes.pill)
            .background(Color.yard.surface2, YardShapes.pill)
            .border(BorderStroke(1.dp, borderColor), YardShapes.pill)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                runCatching { focusRequester.requestFocus() }
            }
            .padding(horizontal = Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(20.dp))
        BasicTextField(
            value = text,
            onValueChange = onTextChange,
            modifier = Modifier
                .weight(1f)
                .focusRequester(focusRequester)
                .onFocusChanged { onFocusChange(it.isFocused) }
                .semantics { contentDescription = "Search" },
            textStyle = YardFonts.body.copy(color = Color.yard.ink),
            singleLine = true,
            cursorBrush = SolidColor(Color.yard.ink),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.None,
                autoCorrectEnabled = false,
                keyboardType = KeyboardType.Text,
                imeAction = ImeAction.Search,
            ),
            keyboardActions = KeyboardActions(onSearch = { onSubmit() }),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty()) {
                        Text("Brands, products, categories", style = YardFonts.body, color = Color.yard.ink3, maxLines = 1)
                    }
                    inner()
                }
            },
        )
        if (text.isNotEmpty()) {
            Icon(
                Icons.Filled.Cancel,
                contentDescription = "Clear search",
                tint = Color.yard.ink3,
                modifier = Modifier.size(22.dp).clip(CircleShape).clickable(onClick = onClear),
            )
        }
    }
}

@Composable
private fun SearchRecentRow(recent: String, modifier: Modifier = Modifier, onSelect: () -> Unit, onRemove: () -> Unit) {
    Row(
        modifier.fillMaxWidth().padding(start = Spacing.gutter, end = Spacing.xs),
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .heightIn(min = 44.dp)
                .clip(YardShapes.small)
                .clickable(onClick = onSelect),
            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(24.dp), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.History, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(18.dp))
            }
            Text(recent, style = YardFonts.body, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .clickable(onClick = onRemove)
                .semantics { contentDescription = "Remove $recent from recent searches" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Close, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(16.dp))
        }
    }
}

@Composable
private fun SearchTryChips(tries: List<SearchCategory>, onSelect: (String) -> Unit) {
    SearchFlowLayout(Modifier.padding(horizontal = Spacing.gutter)) {
        tries.forEach { category ->
            Chip(category.name.lowercase()) { onSelect(category.name.lowercase()) }
        }
    }
}

@Composable
private fun SearchInlineError(message: String, onRetry: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.WifiOff, contentDescription = null, tint = Color.yard.danger, modifier = Modifier.size(18.dp))
        Text(message, style = YardFonts.callout, color = Color.yard.danger, modifier = Modifier.weight(1f))
        Text(
            "Retry",
            style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
            color = Color.yard.ink,
            modifier = Modifier
                .clip(YardShapes.pill)
                .clickable(onClick = onRetry)
                .padding(horizontal = Spacing.s, vertical = Spacing.xs),
        )
    }
}

@Composable
private fun SearchSeeAllRow(term: String, count: Int?, onClick: () -> Unit) {
    Row(
        Modifier
            .padding(horizontal = Spacing.gutter)
            .fillMaxWidth()
            .clip(YardShapes.card)
            .background(Color.yard.surface, YardShapes.card)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.card)
            .pressableClick(onClick = onClick)
            .heightIn(min = 52.dp)
            .padding(horizontal = Spacing.l),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Search, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(16.dp))
        Text(
            "See all results for “$term”",
            style = YardFonts.callout.copy(fontWeight = FontWeight.SemiBold),
            color = Color.yard.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        if (count != null) {
            Text(Formatters.count(count), style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        }
        Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
    }
}

// endregion

// region Previews

@Preview(name = "Search — dark")
@Composable
private fun SearchDarkPreview() = YardPreview(darkTheme = true) {
    SearchHomeView(model = SearchLiveModel.preview("", emptyList(), emptyList(), SearchPreviewData.categories), initialRecents = listOf("hoodie", "lagos"))
}

@Preview(name = "Search — light")
@Composable
private fun SearchLightPreview() = YardPreview(darkTheme = false) {
    SearchHomeView(model = SearchLiveModel.preview("", emptyList(), emptyList(), SearchPreviewData.categories), initialRecents = listOf("hoodie", "lagos"))
}

@Preview(name = "Search typing — dark")
@Composable
private fun SearchTypingDarkPreview() = YardPreview(darkTheme = true) {
    SearchHomeView(model = SearchPreviewData.typingModel, initialText = "hood", initialRecents = emptyList())
}

@Preview(name = "Search typing — light")
@Composable
private fun SearchTypingLightPreview() = YardPreview(darkTheme = false) {
    SearchHomeView(model = SearchPreviewData.typingModel, initialText = "hood", initialRecents = emptyList())
}

/** Preview-only fixtures for Search. */
object SearchPreviewData {
    val items: List<SearchItem> = listOf(
        SearchItem(productId = "prd_1", brandId = "brd_1", brandName = "Acme Studio", slug = "washed-hoodie", title = "Washed hoodie", available = 4, display = Money(8900, "USD")),
        SearchItem(productId = "prd_2", brandId = "brd_1", brandName = "Acme Studio", slug = "zip-hoodie", title = "Zip hoodie", available = 2, display = Money(9500, "USD")),
    )
    val brands: List<SearchBrandHit> = listOf(
        SearchBrandHit(brandId = "brd_2", handle = "hoodrich", name = "Hood Club", city = "Lagos", country = "NG"),
    )
    val categories: List<SearchCategory> = listOf(
        SearchCategory(slug = "hoodies", name = "Hoodies", productCount = 12),
        SearchCategory(slug = "tops", name = "Tops", productCount = 30),
    )

    val typingModel: SearchLiveModel
        get() = SearchLiveModel.preview(term = "hood", products = items, brands = brands, categories = categories)
}

// endregion
