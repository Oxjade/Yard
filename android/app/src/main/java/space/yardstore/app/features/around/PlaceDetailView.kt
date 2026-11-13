package space.yardstore.app.features.around

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Directions
import androidx.compose.material.icons.outlined.LocalOffer
import androidx.compose.material.icons.outlined.LocationOff
import androidx.compose.material.icons.outlined.Photo
import androidx.compose.material.icons.outlined.Share
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
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import space.yardstore.app.app.Route
import space.yardstore.app.core.Config
import space.yardstore.app.core.models.YardDate
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.networking.HTTPMethod
import space.yardstore.app.core.stores.LocalFollowStore
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.BrandAvatar
import space.yardstore.app.designsystem.components.Card
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.PriceText
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.SkeletonShape
import space.yardstore.app.designsystem.components.Tag
import space.yardstore.app.designsystem.components.TagStyle
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonSize
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * How Around leaves for the rest of the app. On iOS the list lives in a modal sheet that must
 * close first; on Android the sheet is part of the screen, so this simply pushes or presents.
 */
sealed interface AroundExit {
    data class Push(val route: Route) : AroundExit
    data class Present(val route: Route) : AroundExit
}

/** Loads one place (GET /api/around/places/{id}); scoped per place id so going back and forth keeps it. */
class PlaceDetailModel(
    private val placeId: String,
    private val api: APIClient = APIClient.shared,
    preview: AroundPlaceDetail? = null,
    /** Tests only: an absolute origin (MockWebServer) prefixed to the API path. */
    private val baseUrl: String = "",
) : ViewModel() {
    var detail by mutableStateOf(preview); private set
    var loadError by mutableStateOf<Throwable?>(null); private set
    var isLoading by mutableStateOf(false); private set

    fun load() {
        viewModelScope.launch { loadNow() }
    }

    suspend fun loadNow() {
        isLoading = true
        loadError = null
        try {
            val raw = api.data(HTTPMethod.GET, "$baseUrl/api/around/places/${Config.encodePath(placeId)}")
            detail = withContext(Dispatchers.Default) {
                try {
                    AroundPlaceDetailResponse.decode(raw).place
                } catch (e: Exception) {
                    throw APIError.decoding(e)
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: APIError) {
            if (!e.isCancelled) loadError = e
        } catch (e: Exception) {
            loadError = e
        } finally {
            isLoading = false
        }
    }
}

/**
 * One place: photos, brand with Follow, address and status, Visit storefront (the one acid
 * action), Directions in the maps app, opening hours or dates, what's happening there and featured
 * pieces. Shown inside the Around sheet. Mirrors `PlaceDetailView.swift`.
 */
@Composable
fun PlaceDetailView(
    placeId: String,
    summary: AroundPlace?,
    distanceMeters: Double?,
    logoUrl: String?,
    onBack: () -> Unit,
    onExit: (AroundExit) -> Unit,
    modifier: Modifier = Modifier,
    previewDetail: AroundPlaceDetail? = null,
) {
    val model: PlaceDetailModel = viewModel(key = "around-place-$placeId") { PlaceDetailModel(placeId, preview = previewDetail) }
    LaunchedEffect(placeId) { if (model.detail == null && !model.isLoading) model.loadNow() }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = Instant.now()
        }
    }
    val context = LocalContext.current
    val detail = model.detail
    val place = detail?.summary ?: summary
    val error = model.loadError

    Column(modifier.fillMaxSize()) {
        // Bar: back, title, share (iOS navigation bar inside the sheet's NavigationStack).
        Box(Modifier.fillMaxWidth().padding(horizontal = Spacing.s).height(48.dp), contentAlignment = Alignment.Center) {
            Text(
                place?.brand?.name ?: "Place",
                style = YardFonts.headline,
                color = Color.yard.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(horizontal = 56.dp),
            )
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                GlassIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", size = 38.dp, onClick = onBack)
                Spacer(Modifier.weight(1f))
                GlassIconButton(Icons.Outlined.Share, "Share this place", size = 38.dp) {
                    sharePlace(context, Config.webUrl("/around?place=$placeId"))
                }
            }
        }
        AnimatedContent(
            targetState = when {
                place != null -> 0
                error != null -> 1
                else -> 2
            },
            transitionSpec = { fadeIn() togetherWith fadeOut() },
            label = "place-detail",
        ) { state ->
            when (state) {
                0 -> if (place != null) PlaceDetailContent(place, detail, error, distanceMeters, logoUrl, now, onExit) { model.loadNow() }
                1 -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(top = Spacing.xxl)) {
                    error?.let { PlaceDetailError(it) { model.loadNow() } }
                }
                else -> PlaceDetailSkeleton()
            }
        }
    }
}

@Composable
private fun PlaceDetailContent(
    p: AroundPlace,
    detail: AroundPlaceDetail?,
    error: Throwable?,
    distanceMeters: Double?,
    logoUrl: String?,
    now: Instant,
    onExit: (AroundExit) -> Unit,
    retry: suspend () -> Unit,
) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        PlacePhotos(p, detail)
        PlaceHeader(p, detail, distanceMeters, logoUrl, now, onExit)
        PlaceActions(p, detail, onExit)
        if (detail != null) {
            val starts = YardDate.parse(p.startsAt)
            val ends = YardDate.parse(p.endsAt)
            if (p.kind.isDated && starts != null && ends != null) {
                PlaceDatesSection(p, starts, ends)
            } else {
                PlaceHoursSection(detail, now)
            }
            PlaceEventsSection(detail, now, onExit)
            PlaceFeaturedSection(detail, onExit)
        } else if (error != null) {
            // The summary is known but the details failed: say so, never keep a skeleton spinning.
            PlaceDetailError(error, retry)
        } else {
            Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                Skeleton(Modifier.size(width = 120.dp, height = 14.dp), cornerRadius = 6.dp)
                Skeleton(Modifier.fillMaxWidth().height(160.dp), cornerRadius = Radius.small)
            }
        }
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
        Spacer(Modifier.height(Spacing.l))
    }
}

@Composable
private fun PlacePhotos(p: AroundPlace, detail: AroundPlaceDetail?) {
    val images = when {
        detail != null && detail.images.isNotEmpty() -> detail.images
        p.image != null -> listOf(p.image)
        else -> emptyList()
    }
    if (images.isEmpty()) return
    val screen = LocalConfiguration.current.screenWidthDp.dp
    val full = screen - Spacing.gutter * 2
    val width = if (images.size > 1) full * 0.88f else full
    LazyRow(
        contentPadding = PaddingValues(horizontal = Spacing.gutter),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        modifier = Modifier.padding(top = Spacing.s),
    ) {
        itemsIndexed(images, key = { i, im -> "$i-${im.src}" }) { _, image ->
            RemoteImage(
                image.url,
                Modifier.width(width).aspectRatio(4f / 3f).semantics { contentDescription = image.alt },
                maxPixelSize = 1400,
                contentDescription = image.alt,
            ) {
                Icon(Icons.Outlined.Photo, contentDescription = null, tint = Color.yard.ink3)
            }
        }
    }
}

@Composable
private fun PlaceHeader(
    p: AroundPlace,
    detail: AroundPlaceDetail?,
    distanceMeters: Double?,
    logoUrl: String?,
    now: Instant,
    onExit: (AroundExit) -> Unit,
) {
    val follows = LocalFollowStore.current
    val session = LocalSessionStore.current
    val toast = LocalToastCenter.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var followBusy by remember { mutableStateOf(false) }
    val following = follows.isFollowing(p.brand.id)

    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.weight(1f).pressableClick { onExit(AroundExit.Push(Route.Brand(handle = p.brand.handle))) },
                horizontalArrangement = Arrangement.spacedBy(Spacing.m),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                BrandAvatar(name = p.brand.name, logoUrl = logoUrl, size = 48.dp, verified = p.brand.verified)
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(p.brand.name, style = YardFonts.headline, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(p.name, style = YardFonts.caption, color = Color.yard.ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            Spacer(Modifier.width(Spacing.s))
            YardButton(
                if (following) "Following" else "Follow",
                style = if (following) YardButtonStyle.Secondary else YardButtonStyle.Inverted,
                size = YardButtonSize.Small,
                isLoading = followBusy,
                fullWidth = false,
            ) {
                if (!session.isSignedIn) {
                    onExit(AroundExit.Present(Route.SignIn))
                    return@YardButton
                }
                followBusy = true
                scope.launch {
                    try {
                        follows.toggle(p.brand.id)
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        toast.show(e)
                    } finally {
                        followBusy = false
                    }
                }
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Tag(p.categoryKindText, icon = p.kind.icon)
            if (p.sample) Tag("Sample place", style = TagStyle.Violet)
        }

        Column(verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            if (detail != null && detail.addressLine.isNotEmpty()) {
                Text(detail.addressLine, style = YardFonts.body, color = Color.yard.ink)
            }
            Text(
                listOf(p.neighbourhood.orEmpty(), p.city, AroundCountry.name(p.country)).filter { it.isNotEmpty() }.joinToString(", "),
                style = YardFonts.callout,
                color = Color.yard.ink2,
            )
            if (distanceMeters != null) {
                Text("${AroundTime.distance(distanceMeters)} from you", style = YardFonts.caption.monospacedDigits(), color = Color.yard.ink2)
            }
            AroundTime.statusLine(p, now)?.let { AroundStatusText(it) }
        }

        val text = detail?.description
        if (!text.isNullOrEmpty()) {
            Text(text, style = YardFonts.callout, color = Color.yard.ink2)
        }
    }
}

@Composable
private fun PlaceActions(p: AroundPlace, detail: AroundPlaceDetail?, onExit: (AroundExit) -> Unit) {
    val context = LocalContext.current
    val toast = LocalToastCenter.current
    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        YardButton("Visit storefront", style = YardButtonStyle.Primary) {
            onExit(AroundExit.Push(Route.Brand(handle = p.brand.handle)))
        }
        if (p.sample) {
            Text("Sample location — not a real address.", style = YardFonts.caption, color = Color.yard.ink2)
        } else if (detail != null) {
            YardButton("Directions", icon = Icons.Outlined.Directions, style = YardButtonStyle.Secondary) {
                if (!openDirections(context, detail)) toast.show("No maps app found to open directions.")
            }
            Text(
                "Opens your maps app",
                style = YardFonts.caption,
                color = Color.yard.ink3,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun PlaceSectionTitle(title: String, aside: String? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
        Text(title, style = YardFonts.headline, color = Color.yard.ink, modifier = Modifier.weight(1f))
        if (aside != null) Text(aside, style = YardFonts.caption, color = Color.yard.ink2)
    }
}

@Composable
private fun PlaceHoursSection(d: AroundPlaceDetail, now: Instant) {
    val p = d.summary
    if (p.hours == null && !p.byAppointment) return
    val aside = if (AroundTime.sameClock(p.timeZone, now)) null else "${p.city} time (${AroundTime.zoneShort(p.timeZone, now)})"
    val today = AroundTime.localClock(now, p.timeZone).first
    val state = AroundTime.openState(p.hours, p.timeZone, now)
    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        PlaceSectionTitle("Opening hours", aside)
        if (state != null) {
            AroundStatusText(
                AroundStatusLine(
                    AroundTime.openNowLine(state),
                    if (state is AroundOpenState.Open) AroundStatusLine.Tone.Open else AroundStatusLine.Tone.Neutral,
                ),
            )
        }
        val hours = p.hours
        if (hours != null) {
            Card(padding = Spacing.m) {
                AroundHours.dayKeys.forEachIndexed { i, day ->
                    val isToday = day == today
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 7.dp)
                            .semantics(mergeDescendants = true) { selected = isToday },
                    ) {
                        val style = if (isToday) YardFonts.bodyEmphasis else YardFonts.body
                        val color = if (isToday) Color.yard.ink else Color.yard.ink2
                        Text(AroundHours.dayLabels[day] ?: day, style = style, color = color, modifier = Modifier.weight(1f))
                        Text(hours.label(day), style = style.monospacedDigits(), color = color)
                    }
                    if (i != AroundHours.dayKeys.lastIndex) YardDivider()
                }
            }
        }
        if (p.byAppointment) {
            Text(d.hoursNote?.let { "By appointment. $it" } ?: "By appointment", style = YardFonts.caption, color = Color.yard.ink2)
        } else if (!d.hoursNote.isNullOrEmpty()) {
            Text(d.hoursNote, style = YardFonts.caption, color = Color.yard.ink2)
        }
    }
}

@Composable
private fun PlaceDatesSection(p: AroundPlace, starts: Instant, ends: Instant) {
    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        PlaceSectionTitle("Dates", "${p.city} time (${AroundTime.zoneShort(p.timeZone, starts)})")
        Card(padding = Spacing.m) {
            Text(AroundTime.dateRange(starts, ends, p.timeZone), style = YardFonts.bodyEmphasis, color = Color.yard.ink)
            Spacer(Modifier.height(Spacing.xs))
            Text(
                "From ${AroundTime.dayTimeIn(starts, p.timeZone)} to ${AroundTime.dayTimeIn(ends, p.timeZone)}",
                style = YardFonts.caption.monospacedDigits(),
                color = Color.yard.ink2,
            )
        }
    }
}

@Composable
private fun PlaceEventsSection(d: AroundPlaceDetail, now: Instant, onExit: (AroundExit) -> Unit) {
    if (d.events.isEmpty()) return
    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        PlaceSectionTitle("Happening here")
        for (event in d.events) {
            PlaceEventCard(event, d.summary.timeZone, now, onExit)
        }
    }
}

/** "On now, until Sat 7 Nov, 18:00" for a live event, else its date range ("" when dates are missing). */
internal fun aroundEventWhen(e: AroundEvent, tz: String, now: Instant): Pair<String, Boolean> {
    val starts = YardDate.parse(e.startsAt)
    val ends = YardDate.parse(e.endsAt)
    val live = starts?.let { it <= now } ?: false
    if (starts == null || ends == null) return "" to live
    return (if (live) "On now, until ${AroundTime.dayTimeIn(ends, tz)}" else AroundTime.dateRange(starts, ends, tz)) to live
}

@Composable
private fun PlaceEventCard(e: AroundEvent, tz: String, now: Instant, onExit: (AroundExit) -> Unit) {
    val (whenText, live) = aroundEventWhen(e, tz, now)
    Card(padding = Spacing.m) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
            Icon(
                Icons.Outlined.CalendarMonth,
                contentDescription = null,
                tint = Color.yard.ink2,
                modifier = Modifier.padding(top = 2.dp).size(18.dp),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
                Text(e.title, style = YardFonts.bodyEmphasis, color = Color.yard.ink)
                if (whenText.isNotEmpty()) {
                    AroundStatusText(AroundStatusLine(whenText, if (live) AroundStatusLine.Tone.Live else AroundStatusLine.Tone.Neutral))
                }
                Text(e.kind.label, style = YardFonts.micro, color = Color.yard.ink3)
                if (!e.description.isNullOrEmpty()) {
                    Text(e.description, style = YardFonts.caption, color = Color.yard.ink2)
                }
                if (!e.promoText.isNullOrEmpty()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.xs), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Outlined.LocalOffer, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(14.dp))
                        Text(e.promoText, style = YardFonts.caption, color = Color.yard.ink)
                    }
                }
                val drop = e.drop
                if (drop != null) {
                    Text(
                        "See ${drop.name}",
                        style = YardFonts.captionEmphasis.copy(textDecoration = TextDecoration.Underline),
                        color = Color.yard.ink,
                        modifier = Modifier.pressableClick { onExit(AroundExit.Push(Route.Drop(id = drop.slug.ifEmpty { drop.id }))) },
                    )
                }
                if (e.sample) Tag("Sample", style = TagStyle.Violet)
            }
        }
    }
}

@Composable
private fun PlaceFeaturedSection(d: AroundPlaceDetail, onExit: (AroundExit) -> Unit) {
    if (d.featured.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Box(Modifier.padding(horizontal = Spacing.gutter)) { PlaceSectionTitle("Pieces here") }
        LazyRow(
            contentPadding = PaddingValues(horizontal = Spacing.gutter),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        ) {
            items(d.featured, key = { it.id }) { item ->
                Column(
                    Modifier.width(132.dp).pressableClick { onExit(AroundExit.Push(Route.Product(slug = item.slug))) },
                    verticalArrangement = Arrangement.spacedBy(Spacing.xs),
                ) {
                    RemoteImage(
                        item.imageUrl,
                        Modifier.size(width = 132.dp, height = 165.dp).clipImage(),
                        maxPixelSize = 500,
                        contentDescription = item.name,
                    ) {
                        Icon(Icons.Outlined.Photo, contentDescription = null, tint = Color.yard.ink3)
                    }
                    Text(item.name, style = YardFonts.caption, color = Color.yard.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    item.price?.let { PriceText(minor = it.amount, currency = it.currency, style = YardFonts.captionEmphasis) }
                }
            }
        }
    }
}

private fun Modifier.clipImage(): Modifier = this.then(Modifier.clip(YardShapes.image))

@Composable
private fun PlaceDetailError(error: Throwable, retry: suspend () -> Unit) {
    if (error is APIError && error.isNotFound) {
        EmptyState(
            "Not on Around any more",
            message = "This place isn't on Yard Around any more. It may have ended or been taken down.",
            icon = Icons.Outlined.LocationOff,
        )
    } else {
        EmptyState.Error(error, retry = retry)
    }
}

@Composable
private fun PlaceDetailSkeleton() {
    Column(Modifier.fillMaxSize().padding(Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.l)) {
        Skeleton(Modifier.fillMaxWidth().aspectRatio(4f / 3f))
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m), verticalAlignment = Alignment.CenterVertically) {
            Skeleton(Modifier.size(48.dp), shape = SkeletonShape.Circle)
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Skeleton(Modifier.size(width = 140.dp, height = 14.dp), cornerRadius = 6.dp)
                Skeleton(Modifier.size(width = 100.dp, height = 11.dp), cornerRadius = 6.dp)
            }
        }
        Skeleton(Modifier.fillMaxWidth().height(52.dp), shape = SkeletonShape.Capsule)
        Skeleton(Modifier.fillMaxWidth().height(180.dp), cornerRadius = Radius.card)
    }
}

// region Intents

private fun sharePlace(context: Context, url: String) {
    val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, url)
    }
    runCatching { context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
}

/** The address text a maps app should search for (area pins: the coordinate is only the area's centre). */
internal fun aroundDirectionsQuery(d: AroundPlaceDetail): String {
    val p = d.summary
    return listOf(d.addressLine, p.neighbourhood.orEmpty(), p.city, AroundCountry.name(p.country)).filter { it.isNotEmpty() }.joinToString(", ")
}

/**
 * Exact pins go to the maps app by coordinate; area pins by the address text, as the website does
 * with its map link (iOS opens Apple Maps the same two ways). Falls back to a web map.
 */
private fun openDirections(context: Context, d: AroundPlaceDetail): Boolean {
    val p = d.summary
    val geo = if (p.pinPrecision == "street") {
        val label = Uri.encode("${p.brand.name} — ${p.name}")
        Uri.parse("geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}($label)")
    } else {
        Uri.parse("geo:0,0?q=${Uri.encode(aroundDirectionsQuery(d))}")
    }
    val web = if (p.pinPrecision == "street") {
        Uri.parse("https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lng}")
    } else {
        Uri.parse("https://www.openstreetmap.org/search?query=${Uri.encode(aroundDirectionsQuery(d))}")
    }
    for (uri in listOf(geo, web)) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return true
        } catch (_: ActivityNotFoundException) {
            continue
        }
    }
    return false
}

// endregion

@Preview(name = "Place detail — dark")
@Composable
private fun PlaceDetailDark() = YardPreview(darkTheme = true) {
    PlaceDetailView(
        placeId = AroundFixtures.store.id,
        summary = AroundFixtures.store,
        distanceMeters = 1200.0,
        logoUrl = null,
        onBack = {},
        onExit = {},
        previewDetail = AroundFixtures.detail,
    )
}

@Preview(name = "Place detail — light")
@Composable
private fun PlaceDetailLight() = YardPreview(darkTheme = false) {
    PlaceDetailView(
        placeId = AroundFixtures.store.id,
        summary = AroundFixtures.store,
        distanceMeters = null,
        logoUrl = null,
        onBack = {},
        onExit = {},
        previewDetail = AroundFixtures.detail,
    )
}
