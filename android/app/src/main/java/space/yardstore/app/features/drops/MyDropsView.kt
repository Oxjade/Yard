package space.yardstore.app.features.drops

import android.content.Context
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.NotificationsOff
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.Formatters
import space.yardstore.app.core.models.Drop
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.SectionHeader
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * "Your drops": every draw the shopper entered (with results and purchase windows) and every
 * release reminder they set. GET /api/drops/me (shopper only). Mirrors MyDropsView.swift.
 */
@Composable
fun MyDropsView() {
    val appContext = LocalContext.current.applicationContext
    val model: MyDropsViewModel = viewModel { MyDropsViewModel(appContext) }
    MyDropsScreen(model)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MyDropsScreen(model: MyDropsViewModel) {
    val session = LocalSessionStore.current
    val router = LocalRouter.current
    val signedIn = session.isSignedIn

    LaunchedEffect(signedIn) { if (signedIn) model.load() else model.reset() }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Your drops")
        if (!signedIn) {
            EmptyState.SignedOut(
                title = "Your drops",
                message = "Sign in to see every draw you enter and every release reminder you set, across your followed brands.",
            ) { router.present(Route.SignIn) }
            return@Column
        }
        when (val state = model.state) {
            MyDropsViewModel.LoadState.Loading -> DropsSkeleton()
            is MyDropsViewModel.LoadState.Failed -> EmptyState.Error(state.error) { model.loadNow() }
            MyDropsViewModel.LoadState.Loaded -> {
                val response = model.response
                if (response != null) {
                    PullToRefreshBox(isRefreshing = model.isRefreshing, onRefresh = { model.refresh() }, modifier = Modifier.fillMaxSize()) {
                        MyDropsList(model, response)
                    }
                }
            }
        }
    }
}

@Composable
private fun MyDropsList(model: MyDropsViewModel, response: MyDropsResponse) {
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val entries = response.entries.filter { it.status != "withdrawn" }
    val reminders = response.reminders.filter { it.drop != null }
    val bottom = Spacing.xxxl + WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    fun removeReminder(drop: Drop) {
        scope.launch {
            try {
                model.removeReminder(drop, context)
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                toast.show("Reminder removed", Toast.Style.Info)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toast.show(e)
            }
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = bottom)) {
        item(key = "header") {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter).padding(top = Spacing.s),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                YardDisplayText("Your drops", size = 48.sp)
                Text(
                    "Every draw you enter and every reminder you set, across the brands you follow.",
                    style = YardFonts.callout,
                    color = Color.yard.ink2,
                )
            }
        }

        item(key = "entries-title") {
            SectionHeader("Draw entries", Modifier.padding(top = Spacing.xxl, bottom = Spacing.m), subtitle = "Results and winner purchase windows.", display = true)
        }
        if (entries.isEmpty()) {
            item(key = "entries-empty") { MyDropsEmptyLine("You haven't entered a draw yet.") }
        } else {
            items(entries, key = { "entry-${it.id}" }) { entry ->
                DropListRow(
                    drop = entry.drop,
                    caption = MyDropsText.entryCaption(entry),
                    entryStatus = entry.status,
                    footnote = MyDropsText.windowFootnote(entry),
                    modifier = Modifier
                        .padding(horizontal = Spacing.gutter, vertical = Spacing.xs)
                        .pressableClick { router.push(Route.Drop(entry.drop.slug)) },
                )
            }
        }

        item(key = "reminders-title") {
            SectionHeader("Reminders", Modifier.padding(top = Spacing.xxl, bottom = Spacing.m), subtitle = "Drops you asked us to notify you about.", display = true)
        }
        if (reminders.isEmpty()) {
            item(key = "reminders-empty") { MyDropsEmptyLine("You haven't set a drop reminder yet.") }
        } else {
            items(reminders, key = { "reminder-${it.id}" }) { reminder ->
                val drop = reminder.drop ?: return@items
                MyDropsReminderRow(
                    drop = drop,
                    caption = MyDropsText.reminderCaption(reminder, drop, Instant.now()),
                    onOpen = { router.push(Route.Drop(drop.slug)) },
                    onRemove = { removeReminder(drop) },
                )
            }
        }

        item(key = "explore") {
            Box(Modifier.padding(horizontal = Spacing.gutter).padding(top = Spacing.xxl)) {
                YardButton(
                    "Explore drops",
                    icon = Icons.Outlined.AutoAwesome,
                    style = YardButtonStyle.Secondary,
                    size = YardButtonSize.Medium,
                    fullWidth = false,
                ) { router.push(Route.Drops) }
            }
        }
    }
}

/** A reminder row; long-press → "Remove reminder" (iOS context menu). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MyDropsReminderRow(drop: Drop, caption: String, onOpen: () -> Unit, onRemove: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    val haptics = LocalHapticFeedback.current
    Box(Modifier.padding(horizontal = Spacing.gutter, vertical = Spacing.xs)) {
        DropListRow(
            drop = drop,
            caption = caption,
            modifier = Modifier
                .clip(YardShapes.card)
                .combinedClickable(
                    onClickLabel = "Open drop",
                    onLongClickLabel = "Remove reminder",
                    onLongClick = {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        menu = true
                    },
                    onClick = onOpen,
                ),
        )
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Color.yard.surface2) {
            DropdownMenuItem(
                text = { Text("Remove reminder", style = YardFonts.body, color = Color.yard.danger) },
                leadingIcon = { Icon(Icons.Outlined.NotificationsOff, contentDescription = null, tint = Color.yard.danger) },
                onClick = {
                    menu = false
                    onRemove()
                },
            )
        }
    }
}

@Composable
private fun MyDropsEmptyLine(text: String) {
    Text(text, style = YardFonts.callout, color = Color.yard.ink3, modifier = Modifier.padding(horizontal = Spacing.gutter))
}

/** Captions for "Your drops" rows (pure, unit-tested). */
object MyDropsText {
    fun entryCaption(entry: MyDropsResponse.Entry): String {
        val ends = YardDate.parse(entry.windowEndsAt)
        if (entry.status == "won" && ends != null) return "Purchase by ${Formatters.dateTime(ends)} · your time"
        val at = YardDate.parse(entry.enteredAt)
        if (entry.status == "entered" && at != null) return "Entered ${Formatters.dateTime(at)} · your time"
        entry.rank?.let { return "Queue position $it" }
        return "Draw result is available on the drop page."
    }

    fun windowFootnote(entry: MyDropsResponse.Entry): String? {
        val minutes = entry.drop.purchaseWindowMinutes
        if (!entry.drop.isDraw || entry.status != "won" || minutes == null) return null
        return "Purchase window: ${DropText.windowLength(minutes)}"
    }

    fun reminderCaption(reminder: MyDropsResponse.Reminder, drop: Drop, now: Instant): String {
        val phase = drop.livePhase(now)
        val opens = drop.reminderOpenDate(now)
        if (phase == DropLivePhase.Upcoming && opens != null) {
            val verb = if (drop.isDrawWaiting(phase, now)) "Entries open" else "Opens"
            return "$verb ${Formatters.dateTime(opens)} · ${Formatters.future(opens, now)}"
        }
        val set = YardDate.parse(reminder.setAt)
        if (set != null) return "Reminder set ${Formatters.dateTime(set)} · ${drop.statusLabel(phase)}"
        return drop.statusLabel(phase)
    }
}

/** GET /api/drops/me. [appContext] keeps this phone's alerts in sync; null in unit tests. */
class MyDropsViewModel(
    private val appContext: Context? = null,
    private val api: APIClient = APIClient.shared,
) : ViewModel() {
    sealed interface LoadState {
        data object Loading : LoadState
        data object Loaded : LoadState
        data class Failed(val error: Throwable) : LoadState
    }

    var state by mutableStateOf<LoadState>(LoadState.Loading); private set
    var response by mutableStateOf<MyDropsResponse?>(null); private set
    var isRefreshing by mutableStateOf(false); private set

    /** Previews only. */
    constructor(preview: MyDropsResponse) : this(appContext = null) {
        response = preview
        state = LoadState.Loaded
    }

    fun load() {
        viewModelScope.launch { loadNow() }
    }

    fun refresh() {
        if (isRefreshing) return
        viewModelScope.launch {
            isRefreshing = true
            try { loadNow() } finally { isRefreshing = false }
        }
    }

    suspend fun loadNow() {
        if (response == null) state = LoadState.Loading
        try {
            val r = api.get<MyDropsResponse>("/api/drops/me")
            response = r
            state = LoadState.Loaded
            // Keep this phone's "10 minutes before" alerts in line with reminders set anywhere.
            val context = appContext
            if (context != null) {
                for (reminder in r.reminders) reminder.drop?.let { DropLocalReminder.sync(context, it, reminderOn = true) }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (response == null) state = LoadState.Failed(e)
        }
    }

    /** DELETE the reminder (and its local alert), then reload. Throws on failure. */
    suspend fun removeReminder(drop: Drop, context: Context?) {
        DropActions.setReminder(false, drop, context, permission = null)
        loadNow()
    }

    fun reset() {
        response = null
        state = LoadState.Loading
    }
}

@Preview(name = "MyDropsView — dark")
@Composable
private fun MyDropsDarkPreview() = YardPreview(darkTheme = true) {
    MyDropsScreen(
        MyDropsViewModel(
            preview = MyDropsResponse(
                entries = listOf(MyDropsResponse.Entry(drop = DropsPreviewFixtures.draw, status = "entered", enteredAt = "2026-11-12T10:00:00.000Z")),
                reminders = listOf(MyDropsResponse.Reminder(dropId = DropsPreviewFixtures.upcoming.id, setAt = "2026-11-12T10:00:00.000Z", drop = DropsPreviewFixtures.upcoming)),
            ),
        ),
    )
}

@Preview(name = "MyDropsView — light")
@Composable
private fun MyDropsLightPreview() = YardPreview(darkTheme = false) {
    MyDropsScreen(MyDropsViewModel(preview = MyDropsResponse()))
}

@Preview(name = "MyDropsView — signed out")
@Composable
private fun MyDropsSignedOutPreview() = YardPreview(darkTheme = true, signedIn = false) { MyDropsView() }
