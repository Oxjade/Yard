package space.yardstore.app.features.drops

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.DropDetailResponse
import space.yardstore.app.core.models.DropViewerState
import space.yardstore.app.core.models.Product
import space.yardstore.app.core.models.ProductsPage
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.designsystem.components.Toast
import java.time.Instant

/**
 * One drop: GET /api/drops/{id or slug} (drop + the signed-in shopper's state), then its pieces via
 * GET /api/catalog/products?ids=…  Reloads quietly when the countdown crosses a phase.
 * Mirrors DropDetailViewModel.swift.
 *
 * [appContext] is the application context (for the local reminder alarm); null in unit tests.
 */
class DropDetailViewModel(
    val id: String,
    private val appContext: Context? = null,
    private val api: APIClient = APIClient.shared,
) : ViewModel() {
    sealed interface LoadState {
        data object Loading : LoadState
        data object Loaded : LoadState
        data class Failed(val error: Throwable) : LoadState
    }

    var state by mutableStateOf<LoadState>(LoadState.Loading); private set
    var drop by mutableStateOf<Drop?>(null); private set
    var me by mutableStateOf<DropViewerState?>(null); private set
    var products by mutableStateOf<List<Product>>(emptyList()); private set
    var productsFailed by mutableStateOf(false); private set
    var isWorking by mutableStateOf(false); private set
    var isRefreshing by mutableStateOf(false); private set

    /** The phase the last load saw, and the phase a reload was last requested for. */
    var loadedPhase: DropLivePhase? = null; private set
    private var requestedPhase: DropLivePhase? = null

    /** Previews only. */
    constructor(previewDrop: Drop, products: List<Product>, me: DropViewerState? = null) : this(previewDrop.id) {
        drop = previewDrop
        this.products = products
        this.me = me
        loadedPhase = previewDrop.livePhase(Instant.now())
        state = LoadState.Loaded
    }

    fun loadIfNeeded() {
        if (drop == null) viewModelScope.launch { load() }
    }

    fun reload() {
        viewModelScope.launch { load() }
    }

    fun refresh() {
        if (isRefreshing) return
        viewModelScope.launch {
            isRefreshing = true
            try { load() } finally { isRefreshing = false }
        }
    }

    suspend fun load() {
        try {
            val detail = api.get<DropDetailResponse>("/api/drops/${Config.encodePath(id)}")
            val needsProducts = drop == null || drop?.productIds != detail.drop.productIds || productsFailed
            drop = detail.drop
            me = detail.me
            loadedPhase = detail.drop.livePhase(Instant.now())
            state = LoadState.Loaded
            if (needsProducts) loadProducts(detail.drop.productIds)
            val viewer = detail.me
            if (viewer != null && appContext != null) DropLocalReminder.sync(appContext, detail.drop, viewer.reminder)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // A quiet reload that fails keeps what is on screen; only the first load shows the error.
            if (drop == null) state = LoadState.Failed(e)
        }
    }

    /** Called as the clock ticks: crossing a boundary (entries open/close, release, end) reloads once per new phase. */
    fun phaseDidChange(phase: DropLivePhase) {
        val loaded = loadedPhase ?: return
        if (phase == loaded || requestedPhase == phase) return
        requestedPhase = phase
        viewModelScope.launch { load() }
    }

    private suspend fun loadProducts(ids: List<String>) {
        if (ids.isEmpty()) {
            products = emptyList()
            productsFailed = false
            return
        }
        val query = ids.take(60).map { "ids" to it } + ("limit" to "60")
        try {
            val page = api.get<ProductsPage>("/api/catalog/products", query)
            val byId = LinkedHashMap<String, Product>()
            for (p in page.products) byId.putIfAbsent(p.id, p)
            products = ids.mapNotNull { byId[it] }
            productsFailed = false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            productsFailed = true
        }
    }

    /** Reminder on/off; returns the toast. */
    suspend fun toggleReminder(context: Context?, permission: DropNotificationPermission?): DropToastMessage {
        val drop = drop ?: return DropToastMessage("", Toast.Style.Info)
        if (isWorking) return DropToastMessage("", Toast.Style.Info)
        isWorking = true
        try {
            val turnOn = !(me?.reminder ?: false)
            val outcome = DropActions.setReminder(turnOn, drop, context, permission)
            load()
            return DropActions.reminderMessage(turnOn, outcome)
        } finally {
            isWorking = false
        }
    }

    /** Draw entry on/off; returns the toast text. */
    suspend fun toggleEntry(): String {
        val drop = drop ?: return ""
        if (isWorking) return ""
        isWorking = true
        try {
            val entered = isEntered
            DropActions.setEntry(!entered, drop.id)
            load()
            return if (entered) "Entry withdrawn" else "Entered the draw"
        } finally {
            isWorking = false
        }
    }

    val isEntered: Boolean
        get() {
            val entry = me?.entry ?: return false
            return entry.status != "withdrawn"
        }
}
