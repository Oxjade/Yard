package space.yardstore.app.features.studio

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.Search
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
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Motion
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.components.BackAction
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SlideToComplete
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import kotlin.coroutines.cancellation.CancellationException

/** The Products list filter. */
enum class StudioProductFilter(val title: String, val status: String, val lowStock: Boolean = false) {
    All("All", "all"),
    Live("Live", "published"),
    Draft("Draft", "draft"),
    LowStock("Low stock", "all", lowStock = true),
}

class StudioProductsModel(
    private val store: StudioStore?,
    preview: List<StudioProduct>? = null,
    previewPieces: Int = 0,
    previewSuggestions: List<StudioProposal> = emptyList(),
) : ViewModel() {
    var filter by mutableStateOf(StudioProductFilter.All)
        private set
    var query by mutableStateOf("")
    var products by mutableStateOf(preview)
        private set
    var total by mutableStateOf(preview?.size ?: 0)
        private set
    private var nextOffset: Int? = null
    var error by mutableStateOf<String?>(null)
        private set
    /** "New from your website (N)". */
    var websitePieces by mutableStateOf(previewPieces)
        private set
    /** Suggestions from Yard still waiting ("Yard prepared N products for you"). */
    var suggestions by mutableStateOf(previewSuggestions)
        private set

    fun pick(f: StudioProductFilter) {
        filter = f
        products = null
        viewModelScope.launch { load() }
    }

    suspend fun load() {
        val store = store ?: return
        try {
            val page = store.products(status = filter.status, q = query, lowStock = filter.lowStock)
            products = page.products
            total = page.total
            nextOffset = page.nextOffset
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
        try {
            websitePieces = store.websitePieces().count
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
        try {
            suggestions = store.proposals("pending").items.filter { it.isPending }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
        }
    }

    fun loadMore() {
        val store = store ?: return
        val offset = nextOffset ?: return
        nextOffset = null
        viewModelScope.launch {
            try {
                val page = store.products(status = filter.status, q = query, lowStock = filter.lowStock, offset = offset)
                products = (products.orEmpty() + page.products).distinctBy { it.id }
                nextOffset = page.nextOffset
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                nextOffset = offset
            }
        }
    }

    val hasMore: Boolean get() = nextOffset != null
}

@OptIn(FlowPreview::class)
@Composable
fun StudioProductsView() {
    val studio = LocalStudioStore.current
    val nav = LocalStudioNav.current
    val model: StudioProductsModel = viewModel(key = "studio-products-${studio.generation}") { StudioProductsModel(studio) }
    LaunchedEffect(model) {
        model.load()
        snapshotFlow { model.query }.drop(1).debounce(350).distinctUntilChanged().collect { model.load() }
    }
    val depth = nav.stack(StudioTab.Products).size
    LaunchedEffect(depth) { if (depth == 0) model.load() }
    // Home's "Low stock" opens the low-stock filter.
    val wanted = nav.productsFilter
    LaunchedEffect(wanted) {
        if (wanted != null) {
            model.pick(wanted)
            nav.productsFilter = null
        }
    }
    StudioProductsScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun StudioProductsScreen(model: StudioProductsModel) {
    val nav = LocalStudioNav.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(Color.yard.bg).statusBarsPadding()) {
        Row(Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            YardDisplayText("Products", size = 40.sp, modifier = Modifier.weight(1f))
            Box(
                Modifier.size(44.dp).background(Color.yard.acid, CircleShape).pressableClick(onClickLabel = "Add a product") { haptics.click(); nav.select(StudioTab.Add) },
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Add, contentDescription = null, tint = Color.yard.onAcid) }
        }
        // Search
        Row(
            Modifier.padding(horizontal = Spacing.gutter).fillMaxWidth().height(46.dp).background(Color.yard.surface2, YardShapes.pill).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = Color.yard.ink3, modifier = Modifier.size(20.dp))
            Box(Modifier.weight(1f)) {
                if (model.query.isEmpty()) Text("Search your products", style = YardFonts.callout, color = Color.yard.ink3)
                BasicTextField(
                    model.query,
                    { model.query = it.take(100) },
                    singleLine = true,
                    textStyle = YardFonts.callout.copy(color = Color.yard.ink),
                    cursorBrush = SolidColor(Color.yard.ink),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Search your products" },
                )
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = Spacing.gutter, vertical = Spacing.m), horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            StudioProductFilter.entries.forEach { f ->
                val on = model.filter == f
                Text(
                    f.title,
                    style = YardFonts.callout.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold),
                    color = if (on) Color.yard.bg else Color.yard.ink,
                    modifier = Modifier
                        .background(if (on) Color.yard.ink else Color.yard.surface2, YardShapes.pill)
                        .pressableClick(onClickLabel = f.title) { if (!on) { haptics.tick(); model.pick(f) } }
                        .padding(horizontal = 16.dp, vertical = 9.dp),
                )
            }
        }
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                haptics.tick()
                scope.launch { model.load(); refreshing = false }
            },
            modifier = Modifier.weight(1f),
        ) {
            val list = model.products
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, bottom = StudioPillClearance + Spacing.xl),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                if (model.suggestions.isNotEmpty()) {
                    item(key = "suggestions") { StudioSuggestionsCard(model.suggestions) { haptics.click(); nav.push(StudioRoute.Suggestions(focusAcceptAll = true)) } }
                }
                if (model.websitePieces > 0) {
                    item(key = "website") {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .background(Color.yard.violetFill, YardShapes.card)
                                .pressableClick(onClickLabel = "New from your website") { haptics.click(); nav.push(StudioRoute.WebsitePieces) }
                                .padding(Spacing.l),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                        ) {
                            Icon(Icons.Outlined.Language, contentDescription = null, tint = Color.yard.onVioletFill)
                            Text("New from your website (${model.websitePieces})", style = YardFonts.headline, color = Color.yard.onVioletFill, modifier = Modifier.weight(1f))
                            Text("Add all", style = YardFonts.captionEmphasis, color = Color.yard.onAcid, modifier = Modifier.background(Color.yard.acid, YardShapes.pill).padding(horizontal = 12.dp, vertical = 6.dp))
                        }
                    }
                }
                when {
                    list == null && model.error != null -> item { EmptyState.Error(model.error.orEmpty()) { model.load() } }
                    list == null -> items(5) { Skeleton(Modifier.fillMaxWidth().height(84.dp)) }
                    list.isEmpty() -> item {
                        EmptyState(
                            title = if (model.query.isNotBlank()) "Nothing matches" else "No products yet",
                            message = if (model.query.isNotBlank()) "Try another word." else "Add your first product. It takes under a minute.",
                            icon = Icons.Outlined.Inventory2,
                            actionTitle = if (model.query.isBlank()) "Add a product" else null,
                            action = if (model.query.isBlank()) ({ nav.select(StudioTab.Add) }) else null,
                        )
                    }
                    else -> {
                        items(list, key = { it.id }) { p -> StudioProductRow(p) { nav.push(StudioRoute.Product(p.id)) } }
                        if (model.hasMore) item { LaunchedEffect(list.size) { model.loadMore() } }
                    }
                }
            }
        }
    }
}

@Composable
internal fun StudioProductRow(p: StudioProduct, onClick: () -> Unit) {
    val haptics = rememberYardHaptics()
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface, YardShapes.card)
            .pressableClick(onClickLabel = p.title) { haptics.click(); onClick() }
            .padding(Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        RemoteImage(Config.url(p.imageUrl), Modifier.size(60.dp).clip(YardShapes.small), maxPixelSize = 240, contentDescription = p.title)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.title, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(studioMoney(p.priceMinor, p.currency), style = YardFonts.callout.monospacedDigits(), color = Color.yard.ink2)
            val stock = p.totalAvailable
            Text(
                if (stock <= 0) "Out of stock" else "$stock in stock",
                style = YardFonts.caption,
                color = if (stock <= 0) Color.yard.danger else Color.yard.ink3,
            )
        }
        StudioPill(p.statusTitle, if (p.isLive) StudioPillStyle.Acid else StudioPillStyle.Neutral)
    }
}

// region Product detail

class StudioProductDetailModel(private val store: StudioStore?, val id: String, preview: StudioProduct? = null) : ViewModel() {
    var product by mutableStateOf(preview)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var publishing by mutableStateOf(false)
        private set
    /** Variant ids with a stock change in flight. */
    var stockBusy by mutableStateOf(setOf<String>())
        private set

    suspend fun load() {
        val store = store ?: return
        try {
            product = store.product(id)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }

    /** Stock ±1, shown at once and undone when the server says no (422 below what checkouts hold). */
    suspend fun adjust(variantId: String, delta: Int): String? {
        val store = store ?: return null
        val p = product ?: return null
        val before = p
        product = p.copy(variants = p.variants.map { v -> if (v.id == variantId) v.copy(onHand = v.onHand + delta, available = (v.available + delta).coerceAtLeast(0)) else v })
        stockBusy = stockBusy + variantId
        return try {
            val r = store.adjustStock(variantId, delta)
            product = product?.let { cur -> cur.copy(variants = cur.variants.map { v -> if (v.id == variantId) v.copy(onHand = r.onHand, held = r.held, available = r.available) else v }) }
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            product = before
            APIError.messageFor(if (e is APIError) e else APIError.network(e))
        } finally {
            stockBusy = stockBusy - variantId
        }
    }

    /** publish / unpublish with the current version; a 409 reloads and asks to try again. */
    suspend fun setLive(live: Boolean): String? {
        val store = store ?: return null
        val p = product ?: return null
        publishing = true
        return try {
            product = store.setStatus(p.id, if (live) "publish" else "unpublish", p.version)
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (e.isConflict) {
                load()
                "This product changed elsewhere. We loaded the latest; try again."
            } else {
                e.message
            }
        } catch (e: Exception) {
            APIError.network(e).message
        } finally {
            publishing = false
        }
    }
}

@Composable
fun StudioProductDetailView(id: String) {
    val studio = LocalStudioStore.current
    val model: StudioProductDetailModel = viewModel(key = "studio-product-$id-${studio.generation}") { StudioProductDetailModel(studio, id) }
    LaunchedEffect(model) { model.load() }
    StudioProductDetailScreen(model)
}

@Composable
internal fun StudioProductDetailScreen(model: StudioProductDetailModel) {
    val nav = LocalStudioNav.current
    val studio = LocalStudioStore.current
    val toast = LocalToastCenter.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }
    val p = model.product
    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        YardTopBar(p?.title ?: "Product", back = back)
        when {
            p == null && model.error != null -> EmptyState.Error(model.error.orEmpty(), Modifier.weight(1f)) { model.load() }
            p == null -> Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.fillMaxWidth().aspectRatio(1f))
            }
            else -> Column(
                Modifier.weight(1f).verticalScroll(rememberScrollState()).navigationBarsPadding().padding(horizontal = Spacing.gutter).padding(bottom = Spacing.xxxl),
                verticalArrangement = Arrangement.spacedBy(Spacing.l),
            ) {
                RemoteImage(Config.url(p.imageUrl), Modifier.fillMaxWidth().aspectRatio(1f).clip(YardShapes.card), contentDescription = p.title)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(p.title, style = YardFonts.title, color = Color.yard.ink)
                        Text(studioMoney(p.priceMinor, p.currency), style = YardFonts.body.monospacedDigits(), color = Color.yard.ink2)
                    }
                    StudioPill(p.statusTitle, if (p.isLive) StudioPillStyle.Acid else StudioPillStyle.Neutral)
                }
                p.moderationReason?.takeIf { it.isNotBlank() }?.let { Text(it, style = YardFonts.callout, color = Color.yard.danger) }

                // Stock per variant.
                Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.s)) {
                    Text("Stock", style = YardFonts.headline, color = Color.yard.ink, modifier = Modifier.padding(horizontal = Spacing.l, vertical = Spacing.s))
                    if (p.variants.isEmpty()) Text("No variants yet.", style = YardFonts.callout, color = Color.yard.ink3, modifier = Modifier.padding(horizontal = Spacing.l))
                    p.variants.forEach { v ->
                        StockRow(
                            label = v.label.ifBlank { "Stock" },
                            available = v.available,
                            held = v.held,
                            enabled = studio.can("orders.fulfil") && v.id !in model.stockBusy,
                        ) { delta ->
                            haptics.tick()
                            scope.launch {
                                model.adjust(v.id, delta)?.let { msg -> haptics.reject(); toast.show(msg, Toast.Style.Error) }
                            }
                        }
                    }
                }

                if (studio.can("content.publish")) {
                    if (p.isLive) {
                        YardButton("Unpublish", style = YardButtonStyle.Secondary, isLoading = model.publishing) {
                            haptics.click()
                            scope.launch {
                                val msg = model.setLive(false)
                                if (msg == null) { haptics.confirm(); toast.show("Unpublished. It's a draft again.", Toast.Style.Success) } else { haptics.reject(); toast.show(msg, Toast.Style.Error) }
                            }
                        }
                    } else {
                        SlideToComplete("Slide to publish", isLoading = model.publishing, enabled = p.status != "archived") {
                            scope.launch {
                                val msg = model.setLive(true)
                                if (msg == null) { haptics.success(); toast.show("Live on Yard", Toast.Style.Success) } else { haptics.reject(); toast.show(msg, Toast.Style.Error) }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** A variant's stock with − / + (a tick per step). */
@Composable
internal fun StockRow(label: String, available: Int, held: Int, enabled: Boolean, onStep: (Int) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.l, vertical = Spacing.s).semantics(mergeDescendants = false) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = YardFonts.bodyEmphasis, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                if (held > 0) "$available available · $held held by checkouts" else "$available available",
                style = YardFonts.caption,
                color = if (available <= 0) Color.yard.danger else Color.yard.ink3,
            )
        }
        StepButton(Icons.Filled.Remove, "Remove one from $label", enabled && available > 0) { onStep(-1) }
        Text(
            "$available",
            style = YardFonts.number(18.sp),
            color = Color.yard.ink,
            modifier = Modifier.width(44.dp).semantics { stateDescription = "$available in stock" },
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        StepButton(Icons.Filled.Add, "Add one to $label", enabled) { onStep(1) }
    }
}

@Composable
internal fun StepButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(40.dp)
            .background(if (enabled) Color.yard.surface2 else Color.yard.surface2.copy(alpha = 0.5f), CircleShape)
            .border(1.dp, Color.yard.line, CircleShape)
            .pressableClick(enabled = enabled, pressedScale = 0.86f, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = if (enabled) Color.yard.ink else Color.yard.ink3, modifier = Modifier.size(18.dp))
    }
}

// endregion

/** Products tab: "Yard prepared N products for you" → Suggestions with Accept all in focus. */
@Composable
internal fun StudioSuggestionsCard(waiting: List<StudioProposal>, onOpen: () -> Unit) {
    val (title, detail) = StudioBatch.preparedLine(waiting)
    Row(
        Modifier
            .fillMaxWidth()
            .background(Color.yard.surface, YardShapes.card)
            .border(1.dp, Color.yard.line, YardShapes.card)
            .pressableClick(onClickLabel = "Suggestions from Yard", onClick = onOpen)
            .padding(Spacing.l),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Box(Modifier.size(40.dp).background(Color.yard.violetFill, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = Color.yard.onVioletFill, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = YardFonts.headline, color = Color.yard.ink)
            Text(detail, style = YardFonts.caption, color = Color.yard.ink2)
        }
        Text(
            if (waiting.size == 1) "Accept" else "Accept all",
            style = YardFonts.captionEmphasis,
            color = Color.yard.onAcid,
            modifier = Modifier.background(Color.yard.acid, YardShapes.pill).padding(horizontal = 12.dp, vertical = 6.dp),
        )
    }
}

// region New from your website

class StudioWebsitePiecesModel(private val store: StudioStore?, preview: StudioSitePieces? = null) : ViewModel() {
    var pieces by mutableStateOf(preview)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** A piece id, or [BATCH_ALL] / [BATCH_SELECTED] while Add all / Add selected runs. */
    var busy by mutableStateOf<String?>(null)
        private set
    var selected by mutableStateOf(emptySet<String>())
        private set
    /** Why a piece wasn't added by the last batch (also in its `error` on the next load). */
    var reasons by mutableStateOf(emptyMap<String, String>())
        internal set
    val key = StudioActionKey()

    val waitingIds: List<String> get() = pieces?.items.orEmpty().filter { it.status == "waiting" }.map { it.id }
    val chosen: List<String> get() = StudioBatch.chosen(selected, waitingIds)
    val allChosen: Boolean get() = StudioBatch.allChosen(selected, waitingIds)

    fun toggle(id: String) {
        selected = if (id in selected) selected - id else selected + id
    }

    fun toggleAll() {
        selected = if (allChosen) emptySet() else waitingIds.toSet()
    }

    /** The reason shown on a piece's card: the last batch's, else the server's `error`. */
    fun reason(piece: StudioSitePiece): String? = reasons[piece.id] ?: piece.error?.ifBlank { null }

    /**
     * Add all ([all]) or Add selected: each piece through the single "add" path on the server. The
     * key is kept on a failure (a retry can't add twice) and renewed after an answer.
     */
    suspend fun addMany(all: Boolean): StudioBatchOutcome {
        val store = store ?: return StudioBatchOutcome("Studio isn't open.", success = false)
        val ids = StudioBatch.ids(all, selected, waitingIds)
        if (!all && ids == null) return StudioBatchOutcome("Choose pieces first.", success = false)
        busy = if (all) BATCH_ALL else BATCH_SELECTED
        return try {
            val r = store.addWebsitePieces(ids, key.current)
            key.renew()
            pieces = r.pieces
            selected = emptySet()
            reasons = StudioBatch.reasons(reasons, r.result)
            StudioBatch.addOutcome(r.result)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            StudioBatchOutcome("That didn't go through. ${APIError.messageFor(if (e is APIError) e else APIError.network(e))}", success = false)
        } finally {
            busy = null
        }
    }

    companion object {
        const val BATCH_ALL = "batch:all"
        const val BATCH_SELECTED = "batch:selected"

        fun preview(pieces: StudioSitePieces, selected: Set<String> = emptySet(), reasons: Map<String, String> = emptyMap()) =
            StudioWebsitePiecesModel(null, pieces).also {
                it.selected = selected
                it.reasons = reasons
            }
    }

    suspend fun load() {
        val store = store ?: return
        try {
            pieces = store.websitePieces()
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }

    suspend fun act(id: String, add: Boolean): String? {
        val store = store ?: return null
        busy = id
        return try {
            val r = store.websitePiece(id, add)
            pieces = r
            null
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (e.isConflict) { load(); "Yard got there first. The list is up to date." } else e.message
        } catch (e: Exception) {
            APIError.network(e).message
        } finally {
            busy = null
        }
    }
}

@Composable
fun StudioWebsitePiecesView() {
    val studio = LocalStudioStore.current
    val model: StudioWebsitePiecesModel = viewModel(key = "studio-pieces-${studio.generation}") { StudioWebsitePiecesModel(studio) }
    LaunchedEffect(model) { model.load() }
    StudioWebsitePiecesScreen(model)
}

@Composable
internal fun StudioWebsitePiecesScreen(model: StudioWebsitePiecesModel) {
    val nav = LocalStudioNav.current
    val toast = LocalToastCenter.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }
    fun addMany(all: Boolean) {
        haptics.click()
        scope.launch {
            val out = model.addMany(all)
            if (out.success) haptics.success() else haptics.reject()
            toast.show(out.message, if (out.success) Toast.Style.Success else Toast.Style.Error)
        }
    }
    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        YardTopBar("New from your website", back = back)
        val data = model.pieces
        when {
            data == null && model.error != null -> EmptyState.Error(model.error.orEmpty(), Modifier.weight(1f)) { model.load() }
            data == null -> Column(Modifier.padding(Spacing.gutter)) { Skeleton(Modifier.fillMaxWidth().height(120.dp)) }
            data.items.isEmpty() -> EmptyState("All caught up", Modifier.weight(1f), message = "New products found on ${data.site ?: "your website"} show here.", icon = Icons.Outlined.Language)
            else -> LazyColumn(
                Modifier.weight(1f),
                contentPadding = PaddingValues(Spacing.gutter),
                verticalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                val waiting = model.waitingIds
                if (data.mayAdd && waiting.isNotEmpty()) {
                    item(key = "batch") {
                        Column(
                            Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.l),
                            verticalArrangement = Arrangement.spacedBy(Spacing.m),
                        ) {
                            YardButton(
                                "Add all (${waiting.size})",
                                icon = Icons.Filled.DoneAll,
                                isLoading = model.busy == StudioWebsitePiecesModel.BATCH_ALL,
                                enabled = model.busy == null,
                            ) { addMany(all = true) }
                            if (model.chosen.isNotEmpty() && !model.allChosen) {
                                YardButton(
                                    "Add selected (${model.chosen.size})",
                                    icon = Icons.Filled.Check,
                                    style = YardButtonStyle.Secondary,
                                    isLoading = model.busy == StudioWebsitePiecesModel.BATCH_SELECTED,
                                    enabled = model.busy == null,
                                ) { addMany(all = false) }
                            }
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .semantics { role = Role.Checkbox; selected = model.allChosen }
                                    .pressableClick(onClickLabel = "Select all waiting pieces") { haptics.tick(); model.toggleAll() },
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                            ) {
                                StudioTick(model.allChosen)
                                Text(
                                    if (model.chosen.isEmpty()) "Select all" else "${model.chosen.size} of ${waiting.size} selected",
                                    style = YardFonts.captionEmphasis,
                                    color = Color.yard.ink2,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            Text("Each piece is added with its photos, exactly as if you added it by itself.", style = YardFonts.caption, color = Color.yard.ink3)
                        }
                    }
                }
                items(data.items, key = { it.id }) { piece ->
                    val canPick = data.mayAdd && piece.status == "waiting"
                    val isPicked = piece.id in model.selected
                    Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(Spacing.m), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        Row(
                            Modifier.then(
                                if (canPick) {
                                    Modifier
                                        .semantics { role = Role.Checkbox; selected = isPicked }
                                        .pressableClick(onClickLabel = "Select ${piece.title}") { haptics.tick(); model.toggle(piece.id) }
                                } else {
                                    Modifier
                                },
                            ),
                            horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RemoteImage(piece.images.firstOrNull(), Modifier.size(72.dp).clip(YardShapes.small), maxPixelSize = 300, contentDescription = piece.title)
                            Column(Modifier.weight(1f)) {
                                Text(piece.title, style = YardFonts.headline, color = Color.yard.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                val price = piece.yardPriceMinor ?: piece.priceMinor
                                if (price != null) Text(studioMoney(price, piece.currency), style = YardFonts.callout.monospacedDigits(), color = Color.yard.ink2)
                                if (piece.sizes.isNotEmpty()) Text(piece.sizes.joinToString(" · "), style = YardFonts.caption, color = Color.yard.ink3, maxLines = 1)
                            }
                            if (canPick) StudioTick(isPicked)
                        }
                        piece.warnings.firstOrNull()?.let { Text(it, style = YardFonts.caption, color = Color.yard.ink3) }
                        model.reason(piece)?.let { why ->
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Color.yard.danger, modifier = Modifier.size(14.dp).padding(top = 1.dp))
                                Text(why, style = YardFonts.caption, color = Color.yard.danger)
                            }
                        }
                        if (canPick) {
                            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                                YardButton("Skip", style = YardButtonStyle.Secondary, size = YardButtonSize.Medium, modifier = Modifier.weight(1f), enabled = model.busy == null) {
                                    haptics.click()
                                    scope.launch { model.act(piece.id, add = false)?.let { toast.show(it, Toast.Style.Error) } }
                                }
                                YardButton("Add", size = YardButtonSize.Medium, modifier = Modifier.weight(1f), isLoading = model.busy == piece.id, enabled = model.busy == null) {
                                    haptics.click()
                                    scope.launch {
                                        val msg = model.act(piece.id, add = true)
                                        if (msg == null) { haptics.success(); toast.show("Added to your products", Toast.Style.Success) } else { haptics.reject(); toast.show(msg, Toast.Style.Error) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// endregion
