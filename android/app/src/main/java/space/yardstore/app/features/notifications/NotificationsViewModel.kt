package space.yardstore.app.features.notifications

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import java.time.LocalDate
import java.time.ZoneId
import kotlin.coroutines.cancellation.CancellationException

/**
 * Loads and marks the shopper's in-app notifications. Mirrors `NotificationsViewModel.swift`.
 *
 * - GET  /api/notifications?as=shopper              → `{ items }` (newest first, max 100)
 * - POST /api/notifications/read?as=shopper         `{ keys: [key] }` or `{ all: true }`, optional `read: false`
 */
class NotificationsViewModel(
    private val api: APIClient = APIClient.shared,
    items: List<ShopperNotification>? = null,
    /** Tests only: an absolute origin (MockWebServer) prefixed to the API paths. */
    private val origin: String = "",
) : ViewModel() {
    sealed interface Phase {
        data object Idle : Phase
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val message: String) : Phase
    }

    enum class Filter { All, Unread }

    var items by mutableStateOf<List<ShopperNotification>>(emptyList()); private set
    var phase by mutableStateOf<Phase>(Phase.Idle); private set
    var isMarkingAll by mutableStateOf(false); private set
    var filter by mutableStateOf(Filter.All)

    init {
        if (items != null) {
            this.items = items
            phase = Phase.Loaded
        }
    }

    val unreadCount: Int get() = items.count { !it.read }

    val visible: List<ShopperNotification>
        get() = when (filter) {
            Filter.All -> items
            Filter.Unread -> items.filter { !it.read }
        }

    /** Today / Earlier, keeping the server's newest-first order. */
    val sections: List<NotificationsSection>
        get() {
            val zone = ZoneId.systemDefault()
            val today = LocalDate.now(zone)
            val (todays, earlier) = visible.partition { n -> n.date?.atZone(zone)?.toLocalDate() == today }
            return buildList {
                if (todays.isNotEmpty()) add(NotificationsSection("Today", todays))
                if (earlier.isNotEmpty()) add(NotificationsSection("Earlier", earlier))
            }
        }

    fun load(): Job = viewModelScope.launch {
        if (items.isEmpty()) phase = Phase.Loading
        try {
            val response: NotificationsListResponse = api.get("$origin/api/notifications", listOf("as" to "shopper"))
            items = response.notifications
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (e is APIError && e.isCancelled) return@launch
            // With items on screen a failed refresh keeps them.
            if (items.isEmpty()) phase = Phase.Failed(APIError.messageFor(e))
        }
    }

    /** Clears everything (sign out). */
    fun reset() {
        items = emptyList()
        phase = Phase.Idle
        filter = Filter.All
    }

    /** Marks one notification read (or unread). Optimistic; rolls back and reports on failure. */
    fun setRead(read: Boolean, notification: ShopperNotification, onError: (Throwable) -> Unit = {}): Job? {
        val index = items.indexOfFirst { it.id == notification.id }
        if (index < 0) return null
        val previous = items[index].read
        if (previous == read) return null
        items = items.map { if (it.id == notification.id) it.copy(read = read) else it }
        return viewModelScope.launch {
            try {
                api.post<NotificationsReadResult>(
                    "$origin/api/notifications/read",
                    body = NotificationsReadBody(keys = listOf(notification.eventKey), read = read),
                    query = listOf("as" to "shopper"),
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                items = items.map { if (it.id == notification.id) it.copy(read = previous) else it }
                onError(e)
            }
        }
    }

    /** Marks every notification read. Optimistic; rolls back and reports on failure. */
    fun markAllRead(onSuccess: () -> Unit = {}, onError: (Throwable) -> Unit = {}): Job? {
        if (unreadCount == 0 || isMarkingAll) return null
        val snapshot = items
        isMarkingAll = true
        items = items.map { it.copy(read = true) }
        return viewModelScope.launch {
            try {
                api.post<NotificationsReadResult>(
                    "$origin/api/notifications/read",
                    body = NotificationsReadBody(all = true),
                    query = listOf("as" to "shopper"),
                )
                onSuccess()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                items = snapshot
                onError(e)
            } finally {
                isMarkingAll = false
            }
        }
    }
}

/** A "Today" / "Earlier" group of the list. */
data class NotificationsSection(val title: String, val items: List<ShopperNotification>) {
    val id: String get() = title
}
