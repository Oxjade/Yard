package space.yardstore.app.features.saved

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Sort
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ShoppingBag
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.HeartBroken
import androidx.compose.material.icons.outlined.ShoppingBag
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.isSpecified
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.LocalTabPillClearance
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.MoneyFormatter
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.WishlistItem
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.CartStore
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.core.stores.LocalSavedStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.core.stores.SavedStore
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardTabletPreviews
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
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.text.Collator
import kotlin.coroutines.cancellation.CancellationException

// Wishlist ("Saved"), mirroring the website's /wishlist (src/components/market/account/wishlist-view.tsx).
// Mirrors ios/Yard/Features/Saved/SavedView.swift.
//
//   GET    /api/wishlist                         (SavedStore.load)
//   GET    /api/catalog/products?ids=…&limit=60  (the saved pieces as full products, for tiles)
//   DELETE /api/wishlist/{productId}             (heart / remove, via SavedStore)
//   POST   /api/cart/lines                       (Move to bag, via CartStore), then unsave

enum class SavedSort(val title: String) {
    Recent("Recently saved"),
    PriceAsc("Price, low to high"),
    PriceDesc("Price, high to low"),
    Brand("Brand, A to Z"),
    InStock("In stock first"),
}

/** What "Move to bag" does for a piece (the iOS `startMove` branches). */
sealed interface SavedMoveAction {
    /** Exactly one variant and it's in stock: add it straight away. */
    data class Direct(val variant: ProductVariant) : SavedMoveAction
    /** Nothing in stock: say so. */
    data object SoldOut : SavedMoveAction
    /** Several variants: pick a size first. */
    data object PickSize : SavedMoveAction
}

internal fun savedMoveAction(product: Product): SavedMoveAction {
    val inStock = product.variants.filter { it.inStock && it.available > 0 }
    return when {
        product.variants.size == 1 && inStock.isNotEmpty() -> SavedMoveAction.Direct(inStock.first())
        inStock.isEmpty() -> SavedMoveAction.SoldOut
        else -> SavedMoveAction.PickSize
    }
}

class SavedViewModel(private val api: APIClient = APIClient.shared) : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    var phase: Phase by mutableStateOf(Phase.Idle)
        private set
    /** Products by id, fetched for the saved ids. */
    var productsById: Map<String, Product> by mutableStateOf(emptyMap())
        private set
    /** Ids the catalogue didn't return (unpublished or hidden since saving). */
    var missingIds: Set<String> by mutableStateOf(emptySet())
        private set
    /** Product ids currently moving to the bag. */
    var busyIds: Set<String> by mutableStateOf(emptySet())
        private set
    var sort: SavedSort by mutableStateOf(SavedSort.Recent)
    var isRefreshing: Boolean by mutableStateOf(false)
        private set

    private var loadJob: Job? = null

    fun load(saved: SavedStore): Job {
        loadJob?.cancel()
        val job = viewModelScope.launch {
            if (productsById.isEmpty()) phase = Phase.Loading
            saved.load()
            val error = saved.lastError
            if (error != null && saved.items.isEmpty()) {
                phase = Phase.Failed(error.message)
                return@launch
            }
            val ids = saved.items.map { it.productId }
            if (ids.isEmpty()) {
                productsById = emptyMap()
                missingIds = emptySet()
                phase = Phase.Loaded
                return@launch
            }
            try {
                val found = withContext(Dispatchers.IO) {
                    val map = LinkedHashMap<String, Product>()
                    for (chunk in ids.chunked(60)) {
                        val query = chunk.map { "ids" to it } + ("limit" to chunk.size.toString())
                        val page: ProductsPage = api.get("/api/catalog/products", query)
                        page.products.forEach { map[it.id] = it }
                    }
                    map
                }
                productsById = found
                missingIds = ids.filter { it !in found }.toSet()
                phase = Phase.Loaded
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e is APIError && e.isCancelled) return@launch
                if (productsById.isEmpty()) phase = Phase.Failed(APIError.messageFor(e))
            }
        }
        loadJob = job
        return job
    }

    /** Pull to refresh. */
    fun refresh(saved: SavedStore) {
        viewModelScope.launch {
            isRefreshing = true
            try { load(saved).join() } finally { isRefreshing = false }
        }
    }

    /** Saved products still in the wishlist, in the chosen order. */
    fun visibleProducts(saved: SavedStore): List<Product> {
        val list = saved.items
            .filter { saved.isSaved(it.productId) }
            .sortedByDescending { it.savedAt }
            .mapNotNull { productsById[it.productId] }
        return when (sort) {
            SavedSort.Recent -> list
            SavedSort.PriceAsc -> list.sortedBy { major(it) }
            SavedSort.PriceDesc -> list.sortedByDescending { major(it) }
            SavedSort.Brand -> {
                val collator = Collator.getInstance().apply { strength = Collator.SECONDARY }
                list.sortedWith { a, b -> collator.compare(a.brand?.name ?: "", b.brand?.name ?: "") }
            }
            SavedSort.InStock -> list.filter { !it.isSoldOut } + list.filter { it.isSoldOut }
        }
    }

    /** Saved items whose product is no longer listed. */
    fun unlistedItems(saved: SavedStore): List<WishlistItem> =
        saved.items.filter {
            saved.isSaved(it.productId) && (it.productId in missingIds || (!it.listed && productsById[it.productId] == null))
        }

    private fun major(product: Product): Double = MoneyFormatter.toMajor(product.priceMinor, product.currency)

    /** Adds the variant to the bag, then unsaves the piece. */
    fun move(product: Product, variant: ProductVariant, cart: CartStore, saved: SavedStore, toast: ToastCenter, onMoved: () -> Unit) {
        val productId = product.id
        busyIds = busyIds + productId
        viewModelScope.launch {
            try {
                try {
                    cart.add(variant.id, 1)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    toast.show(e)
                    return@launch
                }
                try {
                    saved.setSaved(false, productId)
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // The piece is in the bag; it just stayed saved.
                }
                onMoved()
                toast.show("Moved to your bag", Toast.Style.Success, Icons.Filled.ShoppingBag)
            } finally {
                busyIds = busyIds - productId
            }
        }
    }

    fun remove(productId: String, saved: SavedStore, toast: ToastCenter) {
        viewModelScope.launch {
            try {
                saved.setSaved(false, productId)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }
}

@Composable
fun SavedView() {
    val session = LocalSessionStore.current
    val saved = LocalSavedStore.current
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val model: SavedViewModel = viewModel { SavedViewModel() }
    // The size sheet's piece, by id so it survives rotation and process death.
    var sizeSheetProductId by rememberSaveable { mutableStateOf<String?>(null) }
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + LocalTabPillClearance.current

    LaunchedEffect(session.shopper?.id) {
        if (session.isSignedIn) model.load(saved)
    }

    fun move(product: Product, variant: ProductVariant) {
        model.move(product, variant, cart, saved, toast) { haptics.performHapticFeedback(HapticFeedbackType.Confirm) }
    }

    fun startMove(product: Product) {
        when (val action = savedMoveAction(product)) {
            is SavedMoveAction.Direct -> move(product, action.variant)
            SavedMoveAction.SoldOut -> toast.show("This piece is sold out.", Toast.Style.Info)
            SavedMoveAction.PickSize -> sizeSheetProductId = product.id
        }
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Wishlist")
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (!session.isSignedIn) {
                SavedSignInInvite(
                    title = "Wishlist",
                    message = "Sign in to save pieces from any brand and keep them in one place until you're ready.",
                    icon = Icons.Outlined.FavoriteBorder,
                    bottomPadding = bottom,
                ) { router.present(Route.SignIn) }
            } else {
                when (val phase = model.phase) {
                    SavedViewModel.Phase.Idle, SavedViewModel.Phase.Loading -> Column(
                        Modifier.fillMaxSize().padding(top = Spacing.l),
                        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
                    ) {
                        SavedScreenHeader("Wishlist", "Pieces you save from any brand wait here until you're ready.")
                        MasonrySkeleton(Modifier.padding(horizontal = Spacing.gridGap), count = 6)
                    }
                    is SavedViewModel.Phase.Failed -> EmptyState.Error(
                        message = phase.message,
                        modifier = Modifier.fillMaxSize(),
                    ) { model.load(saved).join() }
                    SavedViewModel.Phase.Loaded -> SavedLoaded(
                        model = model,
                        saved = saved,
                        bottomPadding = bottom,
                        onOpen = { router.push(Route.Product(it.slug)) },
                        onMove = { startMove(it) },
                        onRemove = { model.remove(it, saved, toast) },
                        onBrowse = { router.push(Route.Shop) },
                    )
                }
            }
        }
    }

    sizeSheetProductId?.let { model.productsById[it] }?.let { product ->
        SavedVariantSheet(product = product, onDismiss = { sizeSheetProductId = null }) { variant ->
            move(product, variant)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SavedLoaded(
    model: SavedViewModel,
    saved: SavedStore,
    bottomPadding: androidx.compose.ui.unit.Dp,
    onOpen: (Product) -> Unit,
    onMove: (Product) -> Unit,
    onRemove: (String) -> Unit,
    onBrowse: () -> Unit,
) {
    val products = model.visibleProducts(saved)
    val unlisted = model.unlistedItems(saved)
    val brandCount = products.map { it.brandId }.toSet().size
    val soldOut = products.count { it.isSoldOut }
    val isEmpty = products.isEmpty() && unlisted.isEmpty()
    val gap = Spacing.gridGap
    // Sections sit Spacing.xl apart (the grid already adds gridGap between items).
    val sectionGap = Spacing.xl - gap
    val refreshState = rememberPullToRefreshState()
    val window = LocalYardWindow.current
    // Cards and notes under the grid keep a readable width on tablets (start-aligned with the header).
    val readable = if (window.contentMaxWidth.isSpecified) Modifier.widthIn(max = window.contentMaxWidth) else Modifier

    PullToRefreshBox(
        isRefreshing = model.isRefreshing,
        onRefresh = { model.refresh(saved) },
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
            columns = StaggeredGridCells.Fixed(window.gridColumns),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = gap, end = gap, top = Spacing.l, bottom = Spacing.xxl + bottomPadding),
            verticalItemSpacing = gap,
            horizontalArrangement = Arrangement.spacedBy(gap),
        ) {
            item(key = "header", span = StaggeredGridItemSpan.FullLine) {
                SavedScreenHeader(
                    "Wishlist",
                    savedSubtitle(products.size, brandCount),
                    Modifier.savedFullBleed(gap).padding(bottom = sectionGap),
                )
            }
            if (isEmpty) {
                item(key = "empty", span = StaggeredGridItemSpan.FullLine) {
                    EmptyState(
                        "Nothing saved yet",
                        modifier = Modifier.adaptiveContentWidth().heightIn(min = 320.dp),
                        message = "Tap the heart on any piece to keep it here until you're ready.",
                        icon = Icons.Outlined.FavoriteBorder,
                        actionTitle = "Browse new arrivals",
                        action = onBrowse,
                    )
                }
            } else {
                if (products.isNotEmpty()) {
                    item(key = "toolbar", span = StaggeredGridItemSpan.FullLine) {
                        SavedToolbarRow(
                            count = products.size,
                            soldOut = soldOut,
                            sort = model.sort,
                            onSort = { model.sort = it },
                            modifier = Modifier.savedFullBleed(gap).padding(bottom = sectionGap),
                        )
                    }
                    items(products, key = { it.id }) { product ->
                        SavedTile(
                            product = product,
                            isBusy = product.id in model.busyIds,
                            modifier = Modifier.animateItem(),
                            onOpen = { onOpen(product) },
                            onMove = { onMove(product) },
                        )
                    }
                }
                if (unlisted.isNotEmpty()) {
                    item(key = "unlisted", span = StaggeredGridItemSpan.FullLine) {
                        SavedUnlistedSection(unlisted, Modifier.savedFullBleed(gap).padding(top = sectionGap).then(readable), onRemove)
                    }
                }
                item(key = "footnote", span = StaggeredGridItemSpan.FullLine) {
                    Text(
                        "Prices show in the brand's currency. The final price is confirmed at checkout.",
                        style = YardFonts.caption,
                        color = Color.yard.ink3,
                        modifier = Modifier
                            .savedFullBleed(gap)
                            .padding(top = sectionGap)
                            .then(readable)
                            .padding(horizontal = Spacing.gutter),
                    )
                }
            }
        }
    }
}

internal fun savedSubtitle(count: Int, brands: Int): String {
    if (count <= 0) return "Pieces you save from any brand wait here until you're ready."
    val pieces = if (count == 1) "piece" else "pieces"
    val brandWord = if (brands == 1) "brand" else "brands"
    return "$count saved $pieces from $brands $brandWord. Add one to your bag and it moves out of your wishlist."
}

@Composable
private fun SavedToolbarRow(
    count: Int,
    soldOut: Int,
    sort: SavedSort,
    onSort: (SavedSort) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = Spacing.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "$count ${if (count == 1) "piece" else "pieces"}${if (soldOut > 0) ", $soldOut sold out" else ""}",
            style = YardFonts.callout,
            color = Color.yard.ink2,
            modifier = Modifier.weight(1f),
        )
        Box {
            // 48dp touch target around the compact pill.
            Box(
                Modifier
                    .heightIn(min = 48.dp)
                    .semantics { contentDescription = "Sort wishlist, ${sort.title}" }
                    .pressableClick { expanded = true },
                contentAlignment = Alignment.Center,
            ) {
                Row(
                    Modifier
                        .background(Color.yard.surface2, YardShapes.pill)
                        .padding(horizontal = Spacing.m, vertical = Spacing.s),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Sort, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
                    Text(sort.title, style = YardFonts.captionEmphasis, color = Color.yard.ink)
                }
            }
            DropdownMenu(
                expanded = expanded,
                onDismissRequest = { expanded = false },
                shape = YardShapes.small,
                containerColor = Color.yard.surface,
            ) {
                SavedSort.entries.forEach { option ->
                    DropdownMenuItem(
                        text = { Text(option.title, style = YardFonts.body) },
                        onClick = {
                            onSort(option)
                            expanded = false
                        },
                        trailingIcon = if (option == sort) {
                            { Icon(Icons.Filled.Check, contentDescription = "Selected", modifier = Modifier.size(18.dp)) }
                        } else null,
                        colors = MenuDefaults.itemColors(
                            textColor = Color.yard.ink,
                            trailingIconColor = Color.yard.ink,
                        ),
                    )
                }
            }
        }
    }
}

@Composable
private fun SavedTile(
    product: Product,
    isBusy: Boolean,
    modifier: Modifier = Modifier,
    onOpen: () -> Unit,
    onMove: () -> Unit,
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        ProductTile(product, Modifier.pressableClick(onClickLabel = "Open ${product.title}") { onOpen() })
        Box(Modifier.fillMaxWidth().heightIn(min = 48.dp), contentAlignment = Alignment.Center) {
            when {
                product.isNotForSale ->
                    YardButton("Opening soon", style = YardButtonStyle.Secondary, size = YardButtonSize.Small, enabled = false) {}
                product.isSoldOut ->
                    YardButton(
                        "Sold out",
                        modifier = Modifier.alpha(0.6f),
                        style = YardButtonStyle.Secondary,
                        size = YardButtonSize.Small,
                        enabled = false,
                    ) {}
                else ->
                    YardButton(
                        "Move to bag",
                        icon = Icons.Outlined.ShoppingBag,
                        style = YardButtonStyle.Secondary,
                        size = YardButtonSize.Small,
                        isLoading = isBusy,
                        onClick = onMove,
                    )
            }
        }
    }
}

@Composable
private fun SavedUnlistedSection(items: List<WishlistItem>, modifier: Modifier = Modifier, onRemove: (String) -> Unit) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        SectionHeader("No longer available", subtitle = "These pieces were taken down by their brand.")
        Card(Modifier.padding(horizontal = Spacing.gutter), padding = 0.dp) {
            items.forEachIndexed { index, item ->
                if (index > 0) YardDivider()
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(start = Spacing.m, end = Spacing.m - 6.dp, top = Spacing.m - 6.dp, bottom = Spacing.m - 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(Spacing.m - 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            item.title ?: "Saved piece",
                            style = YardFonts.bodyEmphasis,
                            color = Color.yard.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        item.brandName?.let { Text(it, style = YardFonts.caption, color = Color.yard.ink2) }
                    }
                    // 48dp touch target, 36dp circle (iOS size).
                    Box(
                        Modifier
                            .size(48.dp)
                            .semantics { contentDescription = "Remove from wishlist" }
                            .pressableClick { onRemove(item.productId) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box(Modifier.size(36.dp).background(Color.yard.surface2, CircleShape), contentAlignment = Alignment.Center) {
                            Icon(Icons.Outlined.HeartBroken, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(17.dp))
                        }
                    }
                }
            }
        }
    }
}

// MARK: Previews

@Preview(name = "SavedView — dark")
@Composable
private fun SavedViewDark() = YardPreview(darkTheme = true) { SavedView() }

@Preview(name = "SavedView — light")
@Composable
private fun SavedViewLight() = YardPreview(darkTheme = false) { SavedView() }

@Preview(name = "SavedView — signed out")
@Composable
private fun SavedViewSignedOut() = YardPreview(darkTheme = true, signedIn = false) { SavedView() }

@YardTabletPreviews
@Composable
private fun SavedViewTablet() = YardPreview(darkTheme = true) { SavedView() }

@YardTabletPreviews
@Composable
private fun SavedViewTabletSignedOut() = YardPreview(darkTheme = false, signedIn = false) { SavedView() }

@Preview(name = "Saved tile + unlisted — light")
@Composable
private fun SavedTilesLight() = YardPreview(darkTheme = false) {
    Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        SavedToolbarRow(count = 3, soldOut = 1, sort = SavedSort.Recent, onSort = {})
        Row(Modifier.padding(horizontal = Spacing.gridGap), horizontalArrangement = Arrangement.spacedBy(Spacing.gridGap)) {
            SavedTile(space.yardstore.app.designsystem.PreviewFixtures.products[0], isBusy = false, modifier = Modifier.weight(1f), onOpen = {}, onMove = {})
            SavedTile(space.yardstore.app.designsystem.PreviewFixtures.products[3], isBusy = false, modifier = Modifier.weight(1f), onOpen = {}, onMove = {})
        }
        SavedUnlistedSection(listOf(WishlistItem(productId = "prd_x", title = "Boxy tee", brandName = "Acme Studio")), onRemove = {})
        Spacer(Modifier.size(Spacing.l))
    }
}

@Preview(name = "Saved tile + unlisted — dark")
@Composable
private fun SavedTilesDark() = YardPreview(darkTheme = true) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.xl)) {
        SavedToolbarRow(count = 2, soldOut = 0, sort = SavedSort.PriceAsc, onSort = {})
        SavedUnlistedSection(listOf(WishlistItem(productId = "prd_x", title = null, brandName = null)), onRemove = {})
    }
}
