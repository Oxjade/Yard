package space.yardstore.app.features.studio

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.launch
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.rememberYardHaptics
import space.yardstore.app.designsystem.yard
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
import java.util.UUID
import kotlin.coroutines.cancellation.CancellationException

// Suggestions from Yard (Accept all) and the shared batch rules that "New from your website › Add
// all" uses too (docs/APP.md › Studio in the app › Suggestions from Yard / New from your website).

// region Batch rules (pure, unit-tested)

/**
 * The action key for one batch tap. A failed request keeps it, so tapping again after a dropped
 * connection sends the same key and the server answers with the first result (nothing runs twice);
 * an answer renews it for the next tap. 32 chars of `0-9a-f` (the server takes 8–80 of `A–Z a–z 0–9 _ -`).
 */
class StudioActionKey(private val make: () -> String = { UUID.randomUUID().toString().replace("-", "") }) {
    var current: String = make()
        private set

    fun renew() {
        current = make()
    }
}

/** What a batch did, as one toast line. */
data class StudioBatchOutcome(val message: String, val success: Boolean)

object StudioBatch {
    /** "Accept selected" / "Add selected": the chosen ids still waiting, in list order. */
    fun chosen(selected: Set<String>, waiting: List<String>): List<String> = waiting.filter { it in selected }

    /** The selection covers everything waiting (then the buttons say "all"). */
    fun allChosen(selected: Set<String>, waiting: List<String>): Boolean =
        waiting.isNotEmpty() && chosen(selected, waiting).size == waiting.size

    /** The ids to send: null (= every waiting one) for an "all" tap, else the chosen ones. */
    fun ids(all: Boolean, selected: Set<String>, waiting: List<String>): List<String>? =
        if (all) null else chosen(selected, waiting).takeIf { it.isNotEmpty() }

    /** Reasons next to rows after a batch: answered ids lose theirs, skipped ids get theirs. */
    fun reasons(before: Map<String, String>, result: StudioBatchResult, prefix: String = ""): Map<String, String> {
        val next = before.toMutableMap()
        result.accepted.forEach { next.remove(it) }
        result.skipped.forEach { next[it.id] = prefix + it.reason.ifBlank { "This one couldn't be done." } }
        return next
    }

    private fun plural(n: Int, one: String, many: String = "${one}s") = "$n ${if (n == 1) one else many}"

    /** Accept all / Accept selected. */
    fun acceptOutcome(r: StudioBatchResult): StudioBatchOutcome {
        val left = stillNeedsYou(r)
        return if (r.accepted.isNotEmpty()) {
            StudioBatchOutcome("${plural(r.accepted.size, "suggestion")} accepted.$left", success = true)
        } else {
            StudioBatchOutcome("Nothing could be accepted.${left.ifEmpty { " Reload and try again." }}", success = false)
        }
    }

    /** Decline all / Decline selected. Nothing in the catalogue changes. */
    fun declineOutcome(r: StudioBatchResult): StudioBatchOutcome {
        val left = stillNeedsYou(r)
        return if (r.accepted.isNotEmpty()) {
            StudioBatchOutcome("${plural(r.accepted.size, "suggestion")} declined.$left", success = true)
        } else {
            StudioBatchOutcome("Nothing was declined.$left", success = false)
        }
    }

    /** Add all / Add selected (website pieces). */
    fun addOutcome(r: StudioBatchResult): StudioBatchOutcome {
        val left = if (r.skipped.isEmpty()) "" else " ${r.skipped.size} couldn't be added: the reason is on ${if (r.skipped.size == 1) "it" else "each"}."
        return if (r.accepted.isNotEmpty()) {
            StudioBatchOutcome("${plural(r.accepted.size, "piece")} added to your products.$left", success = true)
        } else {
            StudioBatchOutcome("Nothing was added.${left.ifEmpty { " Reload and try again." }}", success = false)
        }
    }

    private fun stillNeedsYou(r: StudioBatchResult): String {
        val n = r.skipped.size
        if (n == 0) return ""
        return " ${plural(n, "suggestion")} still ${if (n == 1) "needs" else "need"} you: the reason is next to ${if (n == 1) "it" else "each"}."
    }

    /** Home's to-do and the Products card: "Yard prepared 12 products for you" + "Accept all in one tap". */
    fun preparedLine(waiting: List<StudioProposal>): Pair<String, String> {
        val n = waiting.size
        val title = if (waiting.all { it.isNew }) {
            "Yard prepared $n ${if (n == 1) "product" else "products"} for you"
        } else {
            "Yard has $n ${if (n == 1) "suggestion" else "suggestions"} for you"
        }
        return title to "Accept ${if (n == 1) "it" else "all"} in one tap"
    }
}

// endregion

// region Model

enum class StudioBatchKind { All, Selected, Decline }

class StudioSuggestionsModel(private val store: StudioStore?, preview: List<StudioProposal>? = null) : ViewModel() {
    var items by mutableStateOf(preview)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    /** Select mode: rows show a tick to choose; Accept selected / Decline selected act on them. */
    var selecting by mutableStateOf(false)
    var selected by mutableStateOf(emptySet<String>())
        private set
    /** Why a suggestion stayed waiting after the last batch (it's still in the list, with the reason). */
    var reasons by mutableStateOf(emptyMap<String, String>())
        internal set
    var busy by mutableStateOf<StudioBatchKind?>(null)
        private set
    var confirmDecline by mutableStateOf(false)
    var declineReason by mutableStateOf("")
    val key = StudioActionKey()

    val waiting: List<StudioProposal> get() = items.orEmpty().filter { it.isPending }
    val past: List<StudioProposal> get() = items.orEmpty().filter { !it.isPending }
    private val waitingIds: List<String> get() = waiting.map { it.id }
    val chosen: List<String> get() = StudioBatch.chosen(selected, waitingIds)
    val allChosen: Boolean get() = StudioBatch.allChosen(selected, waitingIds)
    /** Accept selected / Decline selected show while part of the list is chosen. */
    val partial: Boolean get() = chosen.isNotEmpty() && !allChosen

    fun toggle(id: String) {
        selected = if (id in selected) selected - id else selected + id
    }

    fun toggleAll() {
        selected = if (allChosen) emptySet() else waitingIds.toSet()
    }

    fun stopSelecting() {
        selecting = false
        selected = emptySet()
    }

    suspend fun load() {
        val store = store ?: return
        try {
            items = store.proposals("all").items
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            error = APIError.messageFor(if (e is APIError) e else APIError.network(e))
        }
    }

    /**
     * Runs one batch. On an answer the key is renewed, the selection cleared and the list reloaded;
     * on a failure the key is kept, so the next tap retries the same request.
     */
    suspend fun run(kind: StudioBatchKind): StudioBatchOutcome {
        val store = store ?: return StudioBatchOutcome("Studio isn't open.", success = false)
        busy = kind
        try {
            val result = when (kind) {
                StudioBatchKind.All -> store.acceptProposals(null, key.current)
                StudioBatchKind.Selected -> store.acceptProposals(StudioBatch.ids(false, selected, waitingIds) ?: return StudioBatchOutcome("Choose suggestions first.", false), key.current)
                StudioBatchKind.Decline -> store.declineProposals(StudioBatch.ids(chosen.isEmpty(), selected, waitingIds), declineReason, key.current)
            }
            key.renew()
            selected = emptySet()
            selecting = false
            confirmDecline = false
            declineReason = ""
            reasons = StudioBatch.reasons(reasons, result, prefix = if (kind == StudioBatchKind.Decline) "Not declined: " else "")
            load()
            return if (kind == StudioBatchKind.Decline) StudioBatch.declineOutcome(result) else StudioBatch.acceptOutcome(result)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            val message = APIError.messageFor(if (e is APIError) e else APIError.network(e))
            return StudioBatchOutcome("That didn't go through. $message", success = false)
        } finally {
            busy = null
        }
    }

    companion object {
        fun preview(items: List<StudioProposal>, selecting: Boolean = false, selected: Set<String> = emptySet(), reasons: Map<String, String> = emptyMap(), confirmDecline: Boolean = false) =
            StudioSuggestionsModel(null, items).also {
                it.selecting = selecting
                it.selected = selected
                it.reasons = reasons
                it.confirmDecline = confirmDecline
            }
    }
}

// endregion

// region Screen

@Composable
fun StudioSuggestionsView(focusAcceptAll: Boolean) {
    val studio = LocalStudioStore.current
    val model: StudioSuggestionsModel = viewModel(key = "studio-suggestions-${studio.generation}") { StudioSuggestionsModel(studio) }
    LaunchedEffect(model) { model.load() }
    StudioSuggestionsScreen(model, focusAcceptAll, canPublish = studio.can("content.publish"))
}

@Composable
internal fun StudioSuggestionsScreen(model: StudioSuggestionsModel, focusAcceptAll: Boolean, canPublish: Boolean) {
    val nav = LocalStudioNav.current
    val toast = LocalToastCenter.current
    val haptics = rememberYardHaptics()
    val scope = rememberCoroutineScope()
    val back = remember(nav) { BackAction(isClose = false) { nav.pop() } }

    fun run(kind: StudioBatchKind) {
        haptics.click()
        scope.launch {
            val out = model.run(kind)
            if (out.success) haptics.success() else haptics.reject()
            toast.show(out.message, if (out.success) Toast.Style.Success else Toast.Style.Error)
        }
    }

    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        YardTopBar("Suggestions from Yard", back = back)
        val list = model.items
        when {
            list == null && model.error != null -> EmptyState.Error(model.error.orEmpty(), Modifier.weight(1f)) { model.load() }
            list == null -> Column(Modifier.padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
                Skeleton(Modifier.fillMaxWidth().height(150.dp))
                repeat(3) { Skeleton(Modifier.fillMaxWidth().height(64.dp)) }
            }
            list.isEmpty() -> EmptyState(
                "No suggestions yet",
                Modifier.weight(1f),
                message = "When the Yard team suggests a product or a change, it shows here and you get a notification.",
                icon = Icons.Outlined.AutoAwesome,
            )
            else -> LazyColumn(
                Modifier.weight(1f),
                contentPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.s, bottom = Spacing.xl),
                verticalArrangement = Arrangement.spacedBy(Spacing.m),
            ) {
                item(key = "intro") {
                    Text(
                        "Products and changes the Yard team suggested for your catalogue. Nothing changes until you accept.",
                        style = YardFonts.callout,
                        color = Color.yard.ink2,
                    )
                }
                val waiting = model.waiting
                if (waiting.isNotEmpty()) {
                    item(key = "actions") {
                        if (canPublish) {
                            AcceptAllCard(model, waiting, focused = focusAcceptAll, onRun = ::run)
                        } else {
                            Text("Only people who can publish for this brand can accept suggestions.", style = YardFonts.caption, color = Color.yard.ink3)
                        }
                    }
                }
                item(key = "waiting-title") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Waiting for you", style = YardFonts.title, color = Color.yard.ink, modifier = Modifier.weight(1f).semantics { heading() })
                        if (canPublish && waiting.isNotEmpty()) {
                            Text(
                                if (model.selecting) "Done" else "Select",
                                style = YardFonts.captionEmphasis,
                                color = Color.yard.ink,
                                modifier = Modifier
                                    .background(Color.yard.surface2, YardShapes.pill)
                                    .pressableClick(onClickLabel = if (model.selecting) "Stop selecting" else "Select suggestions") {
                                        haptics.tick()
                                        if (model.selecting) model.stopSelecting() else model.selecting = true
                                    }
                                    .padding(horizontal = 14.dp, vertical = 8.dp),
                            )
                        }
                    }
                }
                if (waiting.isEmpty()) {
                    item(key = "nothing") { Text("Nothing waiting.", style = YardFonts.callout, color = Color.yard.ink2) }
                } else {
                    item(key = "waiting") {
                        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.xs)) {
                            if (model.selecting) {
                                SelectRow(
                                    label = if (model.chosen.isEmpty()) "Select all" else "${model.chosen.size} of ${waiting.size} selected",
                                    on = model.allChosen,
                                ) { haptics.tick(); model.toggleAll() }
                            }
                            waiting.forEach { p ->
                                SuggestionRow(
                                    p,
                                    reason = model.reasons[p.id],
                                    selecting = model.selecting,
                                    isSelected = p.id in model.selected,
                                ) {
                                    if (model.selecting) {
                                        haptics.tick()
                                        model.toggle(p.id)
                                    } else {
                                        p.productId?.let { nav.push(StudioRoute.Product(it)) }
                                    }
                                }
                            }
                        }
                    }
                }
                val past = model.past
                if (past.isNotEmpty()) {
                    item(key = "past-title") { Text("Answered", style = YardFonts.title, color = Color.yard.ink, modifier = Modifier.semantics { heading() }) }
                    item(key = "past") {
                        Column(Modifier.fillMaxWidth().background(Color.yard.surface, YardShapes.card).padding(vertical = Spacing.xs)) {
                            past.forEach { p ->
                                SuggestionRow(p, reason = null, selecting = false, isSelected = false) {
                                    p.productId?.let { nav.push(StudioRoute.Product(it)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Accept all (slide), Accept selected, Decline all / Decline selected behind an inline confirm. */
@Composable
private fun AcceptAllCard(model: StudioSuggestionsModel, waiting: List<StudioProposal>, focused: Boolean, onRun: (StudioBatchKind) -> Unit) {
    val haptics = rememberYardHaptics()
    val (title, detail) = StudioBatch.preparedLine(waiting)
    val busy = model.busy != null
    Column(
        Modifier
            .fillMaxWidth()
            .animateContentSize()
            .background(Color.yard.surface, YardShapes.card)
            .then(if (focused) Modifier.border(2.dp, Color.yard.acid, YardShapes.card) else Modifier)
            .padding(Spacing.l),
        verticalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(40.dp).background(Color.yard.violetFill, CircleShape), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.AutoAwesome, contentDescription = null, tint = Color.yard.onVioletFill, modifier = Modifier.size(20.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(title, style = YardFonts.headline, color = Color.yard.ink, modifier = Modifier.semantics { heading() })
                Text(detail, style = YardFonts.caption, color = Color.yard.ink2)
            }
        }
        SlideToComplete(
            "Slide to accept all (${waiting.size})",
            enabled = !busy,
            isLoading = model.busy == StudioBatchKind.All,
        ) { onRun(StudioBatchKind.All) }
        if (model.partial) {
            YardButton(
                "Accept selected (${model.chosen.size})",
                icon = Icons.Filled.Check,
                style = YardButtonStyle.Secondary,
                isLoading = model.busy == StudioBatchKind.Selected,
                enabled = !busy,
            ) { onRun(StudioBatchKind.Selected) }
        }
        Text(
            "Each one is added exactly as if you accepted it by itself. Anything that can't be stays here with the reason.",
            style = YardFonts.caption,
            color = Color.yard.ink3,
        )
        if (!model.confirmDecline) {
            YardButton(
                if (model.partial) "Decline selected (${model.chosen.size})" else "Decline all",
                style = YardButtonStyle.Secondary,
                size = YardButtonSize.Medium,
                enabled = !busy,
            ) { haptics.tick(); model.confirmDecline = true }
        }
        AnimatedVisibility(model.confirmDecline) {
            val n = if (model.chosen.isNotEmpty()) model.chosen.size else waiting.size
            Column(
                Modifier
                    .fillMaxWidth()
                    .border(1.dp, Color.yard.danger.copy(alpha = 0.4f), YardShapes.small)
                    .background(Color.yard.danger.copy(alpha = 0.06f), YardShapes.small)
                    .padding(Spacing.m),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                Text(
                    "Decline ${if (model.chosen.isNotEmpty() && !model.allChosen) "$n selected ${if (n == 1) "suggestion" else "suggestions"}" else "all $n ${if (n == 1) "suggestion" else "suggestions"}"}? Nothing in your catalogue changes, and Yard sees your answer.",
                    style = YardFonts.callout,
                    color = Color.yard.ink,
                )
                StudioTextField(
                    model.declineReason,
                    { model.declineReason = it.take(300) },
                    "e.g. We don't stock these any more.",
                    label = "Tell Yard why (optional)",
                    singleLine = false,
                    imeAction = ImeAction.Default,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    YardButton(
                        "Decline $n",
                        modifier = Modifier.weight(1f),
                        style = YardButtonStyle.Destructive,
                        size = YardButtonSize.Medium,
                        isLoading = model.busy == StudioBatchKind.Decline,
                        enabled = !busy,
                    ) { onRun(StudioBatchKind.Decline) }
                    YardButton("Keep them", modifier = Modifier.weight(1f), style = YardButtonStyle.Secondary, size = YardButtonSize.Medium, enabled = !busy) {
                        haptics.tick()
                        model.confirmDecline = false
                    }
                }
            }
        }
    }
}

/** A round tick: filled acid when chosen. */
@Composable
internal fun StudioTick(on: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(26.dp)
            .background(if (on) Color.yard.acid else Color.yard.surface2, CircleShape)
            .border(1.5.dp, if (on) Color.yard.acid else Color.yard.line, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (on) Icon(Icons.Filled.Check, contentDescription = null, tint = Color.yard.onAcid, modifier = Modifier.size(16.dp))
    }
}

@Composable
private fun SelectRow(label: String, on: Boolean, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .semantics { role = Role.Checkbox; selected = on }
            .pressableClick(onClickLabel = "Select all", onClick = onClick)
            .padding(horizontal = Spacing.l, vertical = Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        StudioTick(on)
        Text(label, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
    }
}

@Composable
private fun SuggestionRow(p: StudioProposal, reason: String?, selecting: Boolean, isSelected: Boolean, onClick: () -> Unit) {
    val tappable = selecting || p.productId != null
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (selecting) Modifier.semantics { role = Role.Checkbox; selected = isSelected } else Modifier)
            .then(if (tappable) Modifier.pressableClick(onClickLabel = if (selecting) "Select ${p.heading}" else p.heading, onClick = onClick) else Modifier)
            .padding(horizontal = Spacing.l, vertical = Spacing.m),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.m),
    ) {
        if (selecting) StudioTick(isSelected)
        RemoteImage(p.cover, Modifier.size(48.dp).clip(YardShapes.small), maxPixelSize = 200, contentDescription = null)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(p.heading, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(p.detail, style = YardFonts.caption, color = Color.yard.ink3, maxLines = 1)
            if (reason != null) {
                Row(
                    Modifier.padding(top = 2.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Icon(Icons.Outlined.WarningAmber, contentDescription = null, tint = Color.yard.danger, modifier = Modifier.size(14.dp).padding(top = 1.dp))
                    Text(reason, style = YardFonts.caption, color = Color.yard.danger)
                }
            }
        }
        if (!p.isPending) {
            Text(
                statusLabel(p.status),
                style = YardFonts.micro,
                color = Color.yard.ink2,
                modifier = Modifier.background(Color.yard.surface2, YardShapes.pill).padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
}

private fun statusLabel(status: String) = when (status) {
    "accepted" -> "Accepted"
    "declined" -> "Declined"
    "withdrawn" -> "Withdrawn"
    "superseded" -> "Replaced"
    else -> status.replaceFirstChar { it.uppercase() }
}

// endregion

// region Previews

private val previewSuggestions = listOf(
    StudioProposal("pr_1", title = "Amber room spray"),
    StudioProposal("pr_2", title = "Stoneware bowl"),
    StudioProposal("pr_3", kind = "edit", productId = "p_3", title = "Linen tote", fields = listOf("price", "images")),
    StudioProposal("pr_9", status = "accepted", productId = "p_9", title = "Stoneware mug"),
)

@androidx.compose.ui.tooling.preview.Preview(name = "Suggestions — light")
@Composable
private fun StudioSuggestionsLightPreview() = space.yardstore.app.designsystem.YardPreview(darkTheme = false) {
    androidx.compose.runtime.CompositionLocalProvider(LocalStudioNav provides remember { StudioNav() }) {
        StudioSuggestionsScreen(remember { StudioSuggestionsModel.preview(previewSuggestions, reasons = mapOf("pr_3" to "The product changed since Yard suggested this.")) }, focusAcceptAll = true, canPublish = true)
    }
}

@androidx.compose.ui.tooling.preview.Preview(name = "Suggestions — dark, selecting")
@Composable
private fun StudioSuggestionsDarkPreview() = space.yardstore.app.designsystem.YardPreview(darkTheme = true) {
    androidx.compose.runtime.CompositionLocalProvider(LocalStudioNav provides remember { StudioNav() }) {
        StudioSuggestionsScreen(remember { StudioSuggestionsModel.preview(previewSuggestions, selecting = true, selected = setOf("pr_2")) }, focusAcceptAll = false, canPublish = true)
    }
}

// endregion
