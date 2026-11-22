package space.yardstore.app.features.product

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductOption
import space.yardstore.app.core.models.ProductResponse
import space.yardstore.app.core.models.ProductVariant
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.CartStore
import java.util.Locale

/**
 * What the main button can do right now (port of the website's `Action` in product-view.tsx;
 * drop phases are left to the drop screen). Mirrors `ProductBuyAction` in ProductDetailModel.swift.
 */
enum class ProductBuyAction(val label: String) {
    /** The brand isn't selling yet: "Notify me". */
    Opening("Notify me"),
    /** Nothing left (for the chosen variant or the whole piece). */
    SoldOut("Sold out"),
    /** A size (or another option) still has to be chosen. */
    ChooseSize("Select a size"),
    /** Everything that can be bought is already in the bag. */
    Limit("View bag"),
    /** Add to bag. */
    Ready("Add to bag"),
}

/**
 * Loads one product (GET /api/catalog/products/{slug}) plus its rails and delivery estimate, and
 * holds the option selection. Selection rules follow src/components/market/product/use-product-selection.ts:
 * a colour-like option starts on its first value in stock; "Size" starts unchosen.
 */
class ProductDetailModel(
    val slug: String,
    private val api: APIClient = APIClient.shared,
) : ViewModel() {
    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data object NotFound : Phase
        data class Failed(val message: String) : Phase
    }

    enum class StockTone { Ok, Low, Out, Muted }

    var phase: Phase by mutableStateOf(Phase.Loading); private set
    var product: Product? by mutableStateOf(null); private set

    /** Option name → chosen value. */
    var selection: Map<String, String> by mutableStateOf(emptyMap()); private set
    var quantity: Int by mutableIntStateOf(1)

    var moreFromBrand: List<Product> by mutableStateOf(emptyList()); private set
    var similar: List<Product> by mutableStateOf(emptyList()); private set
    var railsLoaded: Boolean by mutableStateOf(false); private set

    var estimate: ProductEstimate? by mutableStateOf(null); private set
    var estimateLoading: Boolean by mutableStateOf(false); private set
    var estimateFailed: Boolean by mutableStateOf(false); private set
    var estimateCountry: String by mutableStateOf("NG"); private set

    /** Back-in-stock watch state per variant id. */
    var watching: Map<String, Boolean> by mutableStateOf(emptyMap()); private set
    var watchBusy: Boolean by mutableStateOf(false); private set

    /** Pull to refresh in flight (Android: the iOS `.refreshable` spinner). */
    var isRefreshing: Boolean by mutableStateOf(false); private set

    /** Preview-only: a model that already holds a product. */
    constructor(preview: Product) : this(preview.slug) {
        product = preview
        phase = Phase.Loaded
        selection = initialSelection(preview)
        railsLoaded = true
    }

    // region Loading

    /** Starts the first load (no-op once a product is held). */
    fun start(destinationCountry: String?, currency: String) {
        if (product != null) return
        viewModelScope.launch { load(destinationCountry, currency) }
    }

    /**
     * Pull to refresh. A failure while a product is already shown keeps the page as it is and is
     * reported through [onFailure] (the screen toasts it; iOS swallows it silently).
     */
    fun refresh(destinationCountry: String?, currency: String, onFailure: (String) -> Unit = {}) {
        if (isRefreshing) return
        viewModelScope.launch {
            isRefreshing = true
            try {
                load(destinationCountry, currency)?.let(onFailure)
            } finally {
                isRefreshing = false
            }
        }
    }

    /**
     * Loads the product, then its rails and delivery estimate. Returns the error message when the
     * product request fails while a product is already held (a refresh); otherwise null (a first-load
     * failure goes to [phase] instead).
     */
    suspend fun load(destinationCountry: String?, currency: String): String? {
        if (product == null) phase = Phase.Loading
        try {
            val response: ProductResponse = api.get("/api/catalog/products/${Config.encodePath(slug)}")
            val isNew = product?.id != response.product.id
            product = response.product
            if (isNew) {
                selection = initialSelection(response.product)
                quantity = 1
            }
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (e.isCancelled) return null
            if (product == null) {
                phase = if (e.isNotFound) Phase.NotFound else Phase.Failed(e.message)
                return null
            }
            return e.message
        } catch (e: Exception) {
            if (product == null) {
                phase = Phase.Failed(APIError.messageFor(e))
                return null
            }
            return APIError.messageFor(e)
        }
        val loaded = product ?: return null
        coroutineScope {
            launch { loadRails(loaded) }
            launch { loadEstimate(loaded, destinationCountry, currency) }
        }
        return null
    }

    private suspend fun loadRails(p: Product) = coroutineScope {
        val brandPage = async {
            fetchPage(listOf("brand" to p.brandId, "sort" to "new", "limit" to "9"), skip = p.brandId.isEmpty())
        }
        val categoryPage = async {
            fetchPage(listOf("category" to p.category, "sort" to "new", "limit" to "24"), skip = p.category.isEmpty())
        }
        val b = brandPage.await()
        val c = categoryPage.await()
        moreFromBrand = (b?.products ?: emptyList()).filter { it.id != p.id }.take(8)
        similar = (c?.products ?: emptyList()).filter { it.id != p.id && it.brandId != p.brandId }.take(8)
        railsLoaded = true
    }

    private suspend fun fetchPage(query: List<Pair<String, String?>>, skip: Boolean): ProductsPage? {
        if (skip) return null
        return try {
            api.get<ProductsPage>("/api/catalog/products", query)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    /** Retry button in the delivery card. */
    fun retryEstimate(destinationCountry: String?, currency: String) {
        val p = product ?: return
        viewModelScope.launch { loadEstimate(p, destinationCountry, currency) }
    }

    suspend fun loadEstimate(p: Product, destinationCountry: String?, currency: String) {
        val device = Locale.getDefault().country.uppercase().ifEmpty { null }
        val candidate = destinationCountry?.uppercase()?.takeIf { it in MARKETS }
            ?: device?.takeIf { it in MARKETS }
            ?: "NG"
        estimateCountry = candidate
        estimateLoading = true
        estimateFailed = false
        try {
            estimate = api.get<ProductEstimate>(
                "/api/shipping/estimate",
                listOf("product" to p.id, "to" to candidate, "cur" to currency),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if ((e as? APIError)?.isCancelled == true) return
            estimate = null
            estimateFailed = true
        } finally {
            estimateLoading = false
        }
    }

    // endregion

    // region Options

    /** The option axis named "Size" (case-insensitive), if any. */
    val sizeOption: ProductOption? get() = product?.options?.firstOrNull { isSizeName(it.name) }

    /** Options other than size (colour and anything else), shown as chips/swatches above size. */
    val otherOptions: List<ProductOption> get() = product?.options?.filter { !isSizeName(it.name) } ?: emptyList()

    /** The brand isn't selling yet: every size reads as open, the action is Notify me. */
    val isOpening: Boolean get() = product?.isNotForSale ?: false

    /** Variants matching every chosen value except [excluding]'s axis. */
    private fun variantsMatchingSelectionExcept(excluding: String?): List<ProductVariant> {
        val p = product ?: return emptyList()
        val sel = selection
        return p.variants.filter { v ->
            sel.all { (name, value) -> name == excluding || v.options[name]?.let { it == value } ?: true }
        }
    }

    /** Units available for [value] on [option], given the other chosen values. */
    fun stock(value: String, option: ProductOption): Int =
        variantsMatchingSelectionExcept(option.name)
            .filter { it.options[option.name] == value }
            .sumOf { maxOf(0, it.available) }

    /** The value exists in some variant for the current other choices. */
    fun exists(value: String, option: ProductOption): Boolean =
        variantsMatchingSelectionExcept(option.name).any { it.options[option.name] == value }

    fun choose(value: String, option: ProductOption) {
        val next = selection.toMutableMap()
        next[option.name] = value
        selection = next
        // Keep the size only if it is still in stock with the new choice (website rule).
        val size = sizeOption
        if (!isSizeName(option.name) && size != null) {
            val chosen = selection[size.name]
            if (chosen != null && stock(chosen, size) == 0) selection = selection - size.name
        }
        quantity = 1
    }

    /** Some axis still has no value. */
    val needsSelection: Boolean
        get() {
            val p = product ?: return false
            return p.options.any { selection[it.name] == null }
        }

    /** The variant for the full selection; with no options, the first variant. */
    val variant: ProductVariant?
        get() {
            val p = product ?: return null
            if (p.options.isEmpty()) return p.variants.firstOrNull()
            if (needsSelection) return null
            return p.variants.firstOrNull { v -> p.options.all { opt -> v.options[opt.name] == selection[opt.name] } }
        }

    /** The chosen variant's stock, or null when none is chosen. */
    val variantStock: Int? get() = variant?.let { maxOf(0, it.available) }

    /** Sizes in stock for the current other choices. */
    val sizesInStock: Int
        get() {
            val size = sizeOption ?: return 0
            return size.values.count { stock(it.value, size) > 0 }
        }

    /** Stock across the variants that match the non-size choices. */
    val stockForOtherChoices: Int
        get() = variantsMatchingSelectionExcept(sizeOption?.name).sumOf { maxOf(0, it.available) }

    /** The price to show: the chosen variant's, else the product's base price. */
    val priceMinor: Int get() = variant?.priceMinor ?: product?.priceMinor ?: 0

    fun inBag(cart: CartStore): Int {
        val v = variant ?: return 0
        return cart.line(v.id)?.qty ?: 0
    }

    /** The most that can still go in the bag (stock, 10-per-line cap, what's already there). */
    fun maxQuantity(cart: CartStore): Int {
        val s = variantStock
        val cap = if (s != null) minOf(MAX_PER_LINE, s) else MAX_PER_LINE
        return maxOf(0, cap - inBag(cart))
    }

    fun action(cart: CartStore): ProductBuyAction {
        val p = product ?: return ProductBuyAction.SoldOut
        if (isOpening) return ProductBuyAction.Opening
        val v = variant
        val soldOut = p.isSoldOut ||
            (v != null && variantStock == 0) ||
            (needsSelection && sizeOption != null && stockForOtherChoices == 0)
        if (soldOut) return ProductBuyAction.SoldOut
        if (needsSelection) return ProductBuyAction.ChooseSize
        if (v == null) return ProductBuyAction.SoldOut
        if (maxQuantity(cart) == 0) return ProductBuyAction.Limit
        return ProductBuyAction.Ready
    }

    /** "Only 2 left", "In stock", "3 of 6 sizes in stock"… (website `StockLine`). */
    fun stockLine(): Pair<String, StockTone> {
        if (isOpening) return "Opening soon" to StockTone.Muted
        val s = variantStock
        if (s != null && variant != null) {
            if (s == 0) return "Sold out" to StockTone.Out
            if (s <= LOW_STOCK) return "Only $s left" to StockTone.Low
            return "In stock" to StockTone.Ok
        }
        val size = sizeOption
        if (size != null) {
            if (stockForOtherChoices == 0) {
                val colour = otherOptions.firstOrNull()?.let { selection[it.name] }
                return (colour?.let { "Sold out in ${it.lowercase()}" } ?: "Sold out") to StockTone.Out
            }
            return "$sizesInStock of ${size.values.size} sizes in stock" to StockTone.Muted
        }
        if (product?.isSoldOut == true) return "Sold out" to StockTone.Out
        return "Choose your options" to StockTone.Muted
    }

    // endregion

    // region Back in stock

    fun isWatching(variantId: String): Boolean = watching[variantId] ?: false

    fun loadWatch(variantId: String) {
        if (watching[variantId] != null) return
        viewModelScope.launch {
            try {
                val w: ProductBackInStockWatch = api.get("/api/wishlist/back-in-stock/${Config.encodePath(variantId)}")
                watching = watching + (variantId to w.watching)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
            }
        }
    }

    /** Toggles the back-in-stock watch. Returns the new state; throws [APIError]. */
    suspend fun toggleWatch(variantId: String): Boolean {
        watchBusy = true
        try {
            val active = isWatching(variantId)
            if (active) {
                api.send(HTTPMethod.DELETE, "/api/wishlist/back-in-stock/${Config.encodePath(variantId)}")
            } else {
                api.send(HTTPMethod.POST, "/api/wishlist/back-in-stock", body = ProductBackInStockBody(variantId = variantId))
            }
            watching = watching + (variantId to !active)
            return !active
        } finally {
            watchBusy = false
        }
    }

    // endregion

    companion object {
        /** Website constants: `MAX_QTY_PER_LINE` (src/lib/stores/cart.ts) and `LOW_STOCK`. */
        const val MAX_PER_LINE = 10
        const val LOW_STOCK = 3

        /** The website's markets (src/config/markets.ts); estimates are only quoted to these. */
        val MARKETS: Set<String> = setOf("NG", "GH", "KE", "ZA", "GB", "FR", "DE", "US", "MX", "JP", "KR")

        fun isSizeName(name: String): Boolean = name.lowercase() == "size"

        fun initialSelection(product: Product): Map<String, String> {
            val out = mutableMapOf<String, String>()
            for (option in product.options) {
                if (isSizeName(option.name)) continue
                val inStock = option.values.firstOrNull { value ->
                    product.variants.any { it.options[option.name] == value.value && it.available > 0 }
                }
                val pick = inStock ?: option.values.firstOrNull()
                if (pick != null) out[option.name] = pick.value
            }
            // A size axis with a single value needs no choice.
            val size = product.options.firstOrNull { isSizeName(it.name) }
            if (size != null && size.values.size == 1) out[size.name] = size.values.first().value
            return out
        }

        /** The website's market names (src/config/markets.ts); other codes fall back to the system name. */
        fun countryName(code: String): String {
            val names = mapOf(
                "NG" to "Nigeria", "GH" to "Ghana", "KE" to "Kenya", "ZA" to "South Africa", "GB" to "United Kingdom",
                "FR" to "France", "DE" to "Germany", "US" to "United States", "MX" to "Mexico", "JP" to "Japan", "KR" to "South Korea",
            )
            val upper = code.uppercase()
            names[upper]?.let { return it }
            val display = Locale("", upper).getDisplayCountry(Locale.US)
            return display.ifEmpty { upper }
        }
    }
}
