package space.yardstore.app.features.shop

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.staggeredgrid.LazyStaggeredGridScope
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridItemSpan
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.LayersClear
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.models.PublicStorefront
import space.yardstore.app.core.models.StorefrontCollection
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.LocalYardWindow
import space.yardstore.app.designsystem.PreviewFixtures
import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.MasonryGrid
import space.yardstore.app.designsystem.components.MasonrySkeleton
import space.yardstore.app.designsystem.components.ProductTile
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard

// A brand collection (website: /brands/{handle}/collections/{collection}).
//   GET /api/catalog/storefronts/{brand}/collections/{handle}  → collection + brand
//   GET /api/catalog/products?ids=…&limit=60                    → its public pieces (chunks of 60, kept in collection order)
//   GET /api/catalog/storefronts/{brand}                         → the brand's other collections ("More from …"), optional
// Mirrors ios/Yard/Features/Shop/CollectionView.swift.

class CollectionModel private constructor(
    val brandHandle: String,
    val collectionHandle: String,
    private val fetches: Boolean,
    private val api: APIClient = APIClient.shared,
    /** Tests only: prefix for API paths (a MockWebServer URL). */
    private val baseUrl: String = "",
) : ViewModel() {

    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class NotFound(val message: String) : Phase
        data class Failed(val error: Throwable) : Phase
    }

    constructor(brand: String, handle: String) : this(brand, handle, fetches = true)

    /** Tests: a fetching model against another client/server. */
    internal constructor(brand: String, handle: String, api: APIClient, baseUrl: String) : this(brand, handle, true, api, baseUrl)

    companion object {
        /** Previews only: fixed data, no network. */
        fun preview(
            previewCollection: StorefrontCollection,
            brand: ShopCollectionResponse.Brand,
            products: List<Product>,
            others: List<StorefrontCollection>,
        ) = CollectionModel(brand.handle, previewCollection.handle, fetches = false).apply {
            this.collection = previewCollection
            this.brand = brand
            this.products = products
            this.others = others
            this.phase = Phase.Loaded
        }
    }

    /** The brand's storefront (for its logo and other collections); null on any failure. */
    private suspend fun storefront(path: String): PublicStorefront? = try {
        api.get<PublicStorefront>("$baseUrl/api/catalog/storefronts/$path")
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }

    /** Public pieces for `ids`, in the same order; ids that aren't public any more drop out. */
    internal suspend fun fetchProducts(ids: List<String>): List<Product> {
        if (ids.isEmpty()) return emptyList()
        val byId = HashMap<String, Product>()
        for (chunk in ids.chunked(60)) {
            val query = buildList<Pair<String, String?>> {
                chunk.forEach { add("ids" to it) }
                add("limit" to "60")
                add("offset" to "0")
                add("sort" to ShopSort.New.rawValue)
            }
            val page = api.get<ProductsPage>("$baseUrl/api/catalog/products", query)
            page.products.forEach { byId[it.id] = it }
        }
        val seen = HashSet<String>()
        return ids.mapNotNull { id -> byId[id]?.takeIf { seen.add(id) } }
    }

    /** A path segment with `/` escaped too (iOS `.urlPathAllowed` minus "/"). */
    private fun pathSegment(raw: String): String = Config.encodePath(raw).replace("/", "%2F")

    var phase by mutableStateOf<Phase>(Phase.Loading); private set
    var collection by mutableStateOf<StorefrontCollection?>(null); private set
    var brand by mutableStateOf<ShopCollectionResponse.Brand?>(null); private set
    var brandLogoUrl by mutableStateOf<String?>(null); private set
    /** In the collection's own order. */
    var products by mutableStateOf<List<Product>>(emptyList()); private set
    var others by mutableStateOf<List<StorefrontCollection>>(emptyList()); private set
    var sort by mutableStateOf(ShopCollectionSort.Featured)
    var isPullRefreshing by mutableStateOf(false); private set

    private var job: Job? = null

    val isLoaded: Boolean get() = phase == Phase.Loaded
    val sortedProducts: List<Product> get() = sort.apply(products)
    val brandName: String get() = brand?.name?.takeIf { it.isNotEmpty() } ?: brandHandle
    /** The collection photo, else its first piece's photo (as the website does). */
    val coverUrl: String? get() = collection?.imageUrl ?: products.firstOrNull()?.coverUrl
    val shareUrl: String
        get() = Config.webUrl("/brands/${brand?.handle ?: brandHandle}/collections/${collection?.handle ?: collectionHandle}")

    fun load(force: Boolean = false) {
        if (!fetches) return
        if (isLoaded && !force) return
        if (!force && job?.isActive == true) return
        job?.cancel()
        job = viewModelScope.launch { loadNow() }
    }

    fun refresh() {
        if (!fetches || isPullRefreshing) return
        isPullRefreshing = true
        job?.cancel()
        job = viewModelScope.launch {
            try { loadNow() } finally { isPullRefreshing = false }
        }
    }

    private suspend fun loadNow() {
        if (!isLoaded) phase = Phase.Loading
        try {
            val brandPath = pathSegment(brandHandle)
            val collectionPath = pathSegment(collectionHandle)
            coroutineScope {
                val storefrontTask = async { storefront(brandPath) }
                val response = api.get<ShopCollectionResponse>("$baseUrl/api/catalog/storefronts/$brandPath/collections/$collectionPath")
                val pieces = fetchProducts(response.collection.productIds)
                val storefront = storefrontTask.await()

                collection = response.collection
                brand = response.brand
                products = pieces
                brandLogoUrl = storefront?.brand?.logoUrl
                others = (storefront?.collections ?: emptyList()).filter { it.id != response.collection.id }
                phase = Phase.Loaded
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (shopIsCancellation(e)) return
            if (isLoaded) return // keep what is on screen after a failed pull-to-refresh
            phase = if (e is APIError && e.isNotFound) Phase.NotFound(e.message) else Phase.Failed(e)
        }
    }
}

@Composable
fun CollectionView(brand: String, handle: String) {
    val model: CollectionModel = viewModel { CollectionModel(brand = brand, handle = handle) }
    CollectionScreen(model)
}

@Composable
internal fun CollectionScreen(model: CollectionModel) {
    val router = LocalRouter.current
    val context = LocalContext.current
    LaunchedEffect(model) { model.load() }
    val brandRoute = Route.Brand(handle = model.brand?.handle ?: model.brandHandle)

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar(model.collection?.name ?: "Collection") {
            if (model.isLoaded) {
                GlassIconButton(Icons.Outlined.Share, "Share collection", Modifier.minimumInteractiveComponentSize(), size = 38.dp) {
                    shopShare(context, model.shareUrl, model.collection?.name)
                }
            }
        }
        when (val phase = model.phase) {
            CollectionModel.Phase.Loading -> CollectionSkeleton()
            is CollectionModel.Phase.NotFound -> EmptyState(
                title = "Collection not found",
                modifier = Modifier.fillMaxSize(),
                message = phase.message.ifEmpty { "That collection isn't available." },
                icon = Icons.Outlined.LayersClear,
                actionTitle = "Visit the brand",
            ) { router.push(Route.Brand(handle = model.brandHandle)) }
            is CollectionModel.Phase.Failed -> EmptyState.Error(phase.error, Modifier.fillMaxSize()) { model.load(force = true) }
            CollectionModel.Phase.Loaded -> CollectionLoaded(model, onBrand = { router.push(brandRoute) })
        }
    }
}

@Composable
private fun CollectionLoaded(model: CollectionModel, onBrand: () -> Unit) {
    val router = LocalRouter.current
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + Spacing.xxl
    val brandHandle = model.brand?.handle ?: model.brandHandle

    ShopRefreshBox(isRefreshing = model.isPullRefreshing, onRefresh = { model.refresh() }, modifier = Modifier.fillMaxSize()) {
        MasonryGrid(
            products = model.sortedProducts,
            modifier = Modifier.fillMaxSize(),
            state = rememberLazyStaggeredGridState(),
            contentPadding = PaddingValues(start = Spacing.gridGap, end = Spacing.gridGap, bottom = bottom),
            header = {
                collectionLine("hero") { CollectionHero(model, onBrand) }
                collectionLine("pieces-bar") {
                    CollectionPiecesBar(model, Modifier.padding(top = Spacing.xl, bottom = Spacing.m - Spacing.gridGap))
                }
                if (model.products.isEmpty()) {
                    collectionLine("empty") {
                        EmptyState(
                            title = "Nothing in this collection right now",
                            modifier = Modifier.heightIn(min = 320.dp),
                            message = "Its pieces have sold out or been taken down; the rest of ${model.brandName} is still open.",
                            icon = Icons.Outlined.Inventory2,
                            actionTitle = "Visit ${model.brandName}",
                            action = onBrand,
                        )
                    }
                }
            },
            footer = {
                if (model.others.isNotEmpty()) {
                    collectionLine("more") {
                        Column(Modifier.padding(top = Spacing.xxl), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                            SectionHeader("More from ${model.brandName}", actionTitle = "Visit the storefront", action = onBrand)
                            LazyRow(
                                horizontalArrangement = Arrangement.spacedBy(Spacing.s),
                                contentPadding = PaddingValues(horizontal = Spacing.gutter),
                            ) {
                                items(model.others, key = { it.id }) { other ->
                                    CollectionCard(
                                        other,
                                        Modifier
                                            .width(280.dp)
                                            .height(210.dp)
                                            .pressableClick { router.push(Route.Collection(brand = brandHandle, handle = other.handle)) },
                                    )
                                }
                            }
                        }
                    }
                }
            },
        ) { product ->
            ProductTile(
                product,
                Modifier.pressableClick { router.push(Route.Product(product.slug)) },
                showsBrand = false,
            )
        }
    }
}

private fun LazyStaggeredGridScope.collectionLine(key: String, content: @Composable () -> Unit) {
    item(key = key, span = StaggeredGridItemSpan.FullLine) {
        Box(Modifier.shopBleed(Spacing.gridGap)) { content() }
    }
}

// MARK: Hero

/** The phone's tall 440dp cover; wide windows use a shorter one so it doesn't fill the screen. */
@Composable
private fun collectionHeroHeight() = if (LocalYardWindow.current.isWide) 340.dp else 440.dp

@Composable
private fun CollectionHero(model: CollectionModel, onBrand: () -> Unit) {
    val scrim = Color.yard.scrim
    Box(
        Modifier
            .padding(horizontal = Spacing.gutter)
            .padding(top = Spacing.s)
            .fillMaxWidth()
            .height(collectionHeroHeight())
            .clip(YardShapes.card)
            .background(Color.yard.surface2),
        contentAlignment = Alignment.BottomStart,
    ) {
        RemoteImage(model.coverUrl, Modifier.fillMaxSize(), maxPixelSize = 1400)
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(scrim.copy(alpha = 0.25f), scrim.copy(alpha = 0f), scrim.copy(alpha = 0.78f))),
            ),
        )
        Column(
            Modifier.padding(Spacing.l).widthIn(max = LocalYardWindow.current.contentMaxWidth),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Text(
                "A collection by ${model.brandName}",
                style = YardFonts.captionEmphasis,
                color = Color.yard.onPhoto.copy(alpha = 0.85f),
            )
            ShopDisplayText(model.collection?.name ?: "", 46.sp, color = Color.yard.onPhoto, maxLines = 3, minScale = 0.6f)
            val description = model.collection?.description
            if (!description.isNullOrEmpty()) {
                Text(description, style = YardFonts.callout, color = Color.yard.onPhoto.copy(alpha = 0.85f), maxLines = 4)
            }
        }
        CollectionBrandChip(model, onBrand, Modifier.align(Alignment.TopStart).padding(Spacing.m))
    }
}

/** Brand breadcrumb over the photo: avatar + name, opens the brand profile. */
@Composable
private fun CollectionBrandChip(model: CollectionModel, onBrand: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            // 34dp glass pill like iOS, inside a 48dp touch target.
            .minimumInteractiveComponentSize()
            .clip(YardShapes.pill)
            .background(Color.yard.surface.copy(alpha = 0.72f), YardShapes.pill)
            .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
            .semantics { contentDescription = "Open ${model.brandName}" }
            .pressableClick(onClick = onBrand)
            .padding(start = Spacing.xs, end = Spacing.m, top = Spacing.xs, bottom = Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        BrandAvatar(model.brandName, logoUrl = model.brandLogoUrl, size = 26.dp)
        Text(model.brandName, style = YardFonts.captionEmphasis, color = Color.yard.ink, maxLines = 1)
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = Color.yard.ink2,
            modifier = Modifier.size(14.dp),
        )
    }
}

// MARK: Pieces

@Composable
private fun CollectionPiecesBar(model: CollectionModel, modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            ShopText.pieces(model.products.size),
            style = YardFonts.headline.monospacedDigits(),
            color = Color.yard.ink,
            modifier = Modifier.weight(1f),
        )
        if (model.products.size > 1) {
            ShopSortMenu(
                selection = model.sort,
                options = ShopCollectionSort.entries,
                title = { it.title },
                accessibilityPrefix = "Sort pieces",
                onSelect = { model.sort = it },
            )
        }
    }
}

// MARK: - Collection card

/** A photo card for a collection: name, description and piece count over a bottom scrim. */
@Composable
internal fun CollectionCard(collection: StorefrontCollection, modifier: Modifier = Modifier) {
    val scrim = Color.yard.scrim
    val description = collection.description
    Box(
        modifier
            .clip(YardShapes.card)
            .background(Color.yard.surface2)
            .clearAndSetSemantics {
                contentDescription = listOfNotNull(
                    collection.name,
                    description.ifEmpty { null },
                    ShopText.pieces(collection.productIds.size),
                ).joinToString(", ")
            },
        contentAlignment = Alignment.BottomStart,
    ) {
        RemoteImage(collection.imageUrl, Modifier.fillMaxSize(), maxPixelSize = 900)
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(0.5f to scrim.copy(alpha = 0f), 1f to scrim.copy(alpha = 0.75f)),
            ),
        )
        Column(Modifier.padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xxs)) {
            ShopDisplayText(collection.name, 26.sp, color = Color.yard.onPhoto, maxLines = 2)
            if (description.isNotEmpty()) {
                Text(description, style = YardFonts.caption, color = Color.yard.onPhoto.copy(alpha = 0.85f), maxLines = 1)
            }
            Text(
                ShopText.pieces(collection.productIds.size),
                style = YardFonts.micro.monospacedDigits(),
                color = Color.yard.onPhoto.copy(alpha = 0.7f),
            )
        }
    }
}

// MARK: - Skeleton

@Composable
private fun CollectionSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        Skeleton(
            Modifier.padding(horizontal = Spacing.gutter).padding(top = Spacing.s).fillMaxWidth().height(collectionHeroHeight()),
            cornerRadius = Radius.card,
        )
        Skeleton(Modifier.padding(horizontal = Spacing.gutter).width(90.dp).height(14.dp), cornerRadius = 4.dp)
        MasonrySkeleton(Modifier.padding(horizontal = Spacing.gridGap), count = 4)
    }
}

// MARK: - Previews

@Composable
private fun CollectionPreviewScreen() {
    val model = remember {
        val products = PreviewFixtures.products
        CollectionModel.preview(
            previewCollection = StorefrontCollection(
                id = "col_preview",
                handle = "winter-uniform",
                name = "Winter uniform",
                description = "Heavyweight fleece and wool, cut in Lagos.",
                productIds = products.map { it.id },
            ),
            brand = ShopCollectionResponse.Brand(id = "brd_preview", handle = "acme", name = "Acme Studio"),
            products = products,
            others = listOf(
                StorefrontCollection(id = "col_2", handle = "basics", name = "Basics", description = "Everyday pieces.", productIds = listOf("a", "b")),
                StorefrontCollection(id = "col_3", handle = "archive", name = "Archive", description = "", productIds = listOf("c")),
            ),
        )
    }
    CollectionScreen(model)
}

@Preview(name = "CollectionView — dark", heightDp = 1200)
@Composable
private fun CollectionViewDarkPreview() = YardPreview(darkTheme = true) { CollectionPreviewScreen() }

@Preview(name = "CollectionView — light", heightDp = 1200)
@Composable
private fun CollectionViewLightPreview() = YardPreview(darkTheme = false) { CollectionPreviewScreen() }

@YardTabletPreviews
@Composable
private fun CollectionViewTabletPreview() = YardPreview(darkTheme = true) { CollectionPreviewScreen() }
