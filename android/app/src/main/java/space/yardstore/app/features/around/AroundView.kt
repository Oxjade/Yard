package space.yardstore.app.features.around

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.outlined.LocationDisabled
import androidx.compose.material.icons.outlined.LocationSearching
import androidx.compose.material.icons.outlined.Map
import androidx.compose.material.icons.outlined.PinDrop
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.YardDisplayText
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.GlassIconButton
import space.yardstore.app.designsystem.components.LocalToastCenter
import space.yardstore.app.designsystem.components.Toast
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard
import java.time.Instant

/**
 * Around: independent brands' stores, showrooms, pop-ups and exhibitions on a map, with a bottom
 * sheet listing the places in view, nearest first (website: /around, src/components/around).
 * Data: GET /api/around/places?scope=world, then GET /api/around/places/{id} for a place. The
 * shopper's location stays on the device. Mirrors `AroundView.swift`.
 */
@Composable
fun AroundView() {
    val model: AroundViewModel = viewModel { AroundViewModel() }
    AroundScreen(model)
}

@Composable
internal fun AroundScreen(model: AroundViewModel) {
    val router = LocalRouter.current
    val toast = LocalToastCenter.current
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    val inPreview = LocalInspectionMode.current

    val locator = remember { AroundLocationManager(context) }
    val map = remember { AroundMapController() }
    val sheet = rememberAroundSheetState(AroundDetent.Peek)

    var region by remember { mutableStateOf<AroundRegion?>(null) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    /** The sheet's one-deep stack (iOS `sheetPath`): the place shown in detail, if any. */
    var detailId by rememberSaveable { mutableStateOf<String?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var isSearching by remember { mutableStateOf(false) }
    var hasCenteredOnUser by rememberSaveable { mutableStateOf(false) }
    var hasFramed by rememberSaveable { mutableStateOf(false) }
    var now by remember { mutableStateOf(Instant.now()) }

    fun flyToUser() {
        val me = locator.location ?: return
        hasCenteredOnUser = true
        detailId = null
        map.flyTo(AroundRegion.around(me, 20_000.0))
    }

    fun select(place: AroundPlace) {
        selectedId = place.id
        detailId = place.id
        if (sheet.detent == AroundDetent.Peek) sheet.animateTo(AroundDetent.Medium)
        focus.clearFocus()
        // Keep the zoom when already close; pull the pin into the upper half, above the sheet.
        val currentLat = region?.latitudeDelta ?: 0.05
        val currentLng = region?.longitudeDelta ?: 0.05
        val (latSpan, lngSpan) = if (currentLat > 0.5) 0.04 to 0.04 else currentLat to currentLng
        val center = AroundCoordinate(place.lat - latSpan * 0.22, place.lng)
        map.flyTo(AroundRegion(center, latSpan, lngSpan))
    }

    fun showAll() {
        detailId = null
        val fit = AroundViewModel.regionFitting(model.places.map { it.coordinate })
        map.flyTo(fit ?: AroundRegion(AroundCoordinate(20.0, 0.0), 140.0, 340.0))
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        locator.onPermissionResult(result.values.any { it })
    }

    fun locate() {
        if (locator.isDenied(context.findActivity())) {
            toast.show("Location is off for Yard. Turn it on in Settings to see places near you.", Toast.Style.Info, Icons.Outlined.LocationDisabled)
            return
        }
        if (locator.requestLocation()) {
            permissionLauncher.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
        }
    }

    fun runSearch() {
        val q = query.trim()
        if (q.isEmpty() || isSearching) return
        isSearching = true
        scope.launch {
            val target = model.regionForSearch(q, context)
            isSearching = false
            if (target != null) {
                focus.clearFocus()
                detailId = null
                if (sheet.detent == AroundDetent.Peek) sheet.animateTo(AroundDetent.Medium)
                map.flyTo(target)
            } else {
                toast.show("Couldn't find “$q”. Try Lagos, London, Seoul…", Toast.Style.Info)
            }
        }
    }

    fun leave(exit: AroundExit) {
        when (exit) {
            is AroundExit.Push -> router.push(exit.route)
            is AroundExit.Present -> router.present(exit.route)
        }
    }

    // Load once per visit (the list is cached server-side) and tick the clock for status lines.
    LaunchedEffect(Unit) { if (!inPreview) model.loadNow() }
    LaunchedEffect(Unit) {
        while (true) {
            delay(60_000)
            now = Instant.now()
        }
    }

    // Location only while the screen is visible.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> if (!inPreview) locator.startIfAuthorized()
                Lifecycle.Event.ON_STOP -> locator.stop()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose {
            lifecycle.removeObserver(observer)
            locator.stop()
        }
    }

    LaunchedEffect(locator.requestedFixCount) { if (locator.requestedFixCount > 0) flyToUser() }
    LaunchedEffect(locator.fixCount) {
        if (locator.fixCount > 0 && !hasCenteredOnUser && selectedId == null) flyToUser()
    }
    // iOS `.automatic`: frame every place once they arrive, unless the camera already has a job.
    LaunchedEffect(model.places) {
        if (!hasFramed && model.places.isNotEmpty()) {
            hasFramed = true
            if (!hasCenteredOnUser && selectedId == null) {
                AroundViewModel.regionFitting(model.places.map { it.coordinate })?.let { map.flyTo(it, animated = false) }
            }
        }
    }
    LaunchedEffect(detailId) { if (detailId == null) selectedId = null }
    LaunchedEffect(model.error != null) { if (model.error != null) sheet.animateTo(AroundDetent.Medium) }
    // iOS `onMapCameraChange(frequency: .onEnd)`: the region once the camera settles.
    LaunchedEffect(map) {
        snapshotFlow { map.cameraTick }.collectLatest {
            delay(250)
            map.currentRegion()?.let { region = it }
        }
    }

    BackHandler(enabled = detailId != null) { detailId = null }

    val visiblePlaces = remember(model.places, region, locator.location) { model.visiblePlaces(region, locator.location) }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Around")
        AroundSearchBar(
            query = query,
            onQueryChange = { query = it },
            isSearching = isSearching,
            isLocated = locator.isAuthorized,
            onSearch = { runSearch() },
            onLocate = { locate() },
        )
        Box(Modifier.weight(1f).fillMaxWidth()) {
            AroundMap(
                controller = map,
                places = model.places,
                logoUrl = { model.logoUrl(it) },
                selectedId = selectedId,
                now = now,
                userLocation = if (locator.isAuthorized) locator.location else null,
                onSelect = { select(it) },
                modifier = Modifier.fillMaxSize(),
            )
            AroundSheet(sheet, Modifier.fillMaxSize()) {
                AnimatedContent(
                    targetState = detailId,
                    transitionSpec = {
                        val forward = targetState != null
                        if (forward) {
                            (slideInHorizontally(tween(300)) { it } + fadeIn()) togetherWith (slideOutHorizontally(tween(300)) { -it / 4 } + fadeOut())
                        } else {
                            (slideInHorizontally(tween(300)) { -it / 4 } + fadeIn()) togetherWith (slideOutHorizontally(tween(300)) { it } + fadeOut())
                        }
                    },
                    label = "around-sheet",
                ) { id ->
                    if (id == null) {
                        AroundPlacesList(
                            places = visiblePlaces,
                            totalCount = model.places.size,
                            isLoading = model.isLoading || !(model.hasLoaded || model.error != null),
                            error = if (model.places.isEmpty()) model.error else null,
                            isLocated = locator.location != null,
                            selectedId = selectedId,
                            now = now,
                            logo = { model.logoUrl(it) },
                            distanceText = { p -> locator.location?.let { AroundTime.distance(p.coordinate.distanceTo(it)) } },
                            onSelect = { select(it) },
                            onRetry = { model.loadNow() },
                            onShowAll = { showAll() },
                            onBrowseBrands = { leave(AroundExit.Push(Route.BrandsDirectory)) },
                        )
                    } else {
                        val summary = model.place(id)
                        PlaceDetailView(
                            placeId = id,
                            summary = summary,
                            distanceMeters = summary?.let { s -> locator.location?.let { s.coordinate.distanceTo(it) } },
                            logoUrl = summary?.let { model.logoUrl(it) },
                            onBack = { detailId = null },
                            onExit = { leave(it) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun AroundSearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
    isSearching: Boolean,
    isLocated: Boolean,
    onSearch: () -> Unit,
    onLocate: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = Spacing.gutter, vertical = Spacing.s),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier
                .weight(1f)
                .height(44.dp)
                .background(Color.yard.surface.copy(alpha = 0.72f), YardShapes.pill)
                .border(BorderStroke(1.dp, Color.yard.line), YardShapes.pill)
                .padding(horizontal = Spacing.m),
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.Search, contentDescription = null, tint = Color.yard.ink2, modifier = Modifier.size(20.dp))
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (query.isEmpty()) Text("Search a city or area", style = YardFonts.body, color = Color.yard.ink3, maxLines = 1)
                BasicTextField(
                    value = query,
                    onValueChange = onQueryChange,
                    singleLine = true,
                    textStyle = YardFonts.body.copy(color = Color.yard.ink),
                    cursorBrush = SolidColor(Color.yard.ink),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.Words,
                        autoCorrectEnabled = false,
                        imeAction = ImeAction.Search,
                    ),
                    keyboardActions = KeyboardActions(onSearch = { onSearch() }),
                    modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Search a city or area" },
                )
            }
            if (isSearching) {
                CircularProgressIndicator(Modifier.size(16.dp), color = Color.yard.ink2, strokeWidth = 2.dp)
            } else if (query.isNotEmpty()) {
                Icon(
                    Icons.Filled.Cancel,
                    contentDescription = "Clear search",
                    tint = Color.yard.ink3,
                    modifier = Modifier.size(20.dp).pressableClick { onQueryChange("") },
                )
            }
        }
        GlassIconButton(
            if (isLocated) Icons.Filled.MyLocation else Icons.Outlined.LocationSearching,
            contentDescription = "Show places near me",
            size = 44.dp,
            onClick = onLocate,
        )
    }
}

/**
 * The sheet's list: header, then the places in view nearest first, with loading, error and the two
 * empty states (nothing on Around at all; nothing in this part of the map).
 */
@Composable
fun AroundPlacesList(
    places: List<AroundPlace>,
    totalCount: Int,
    isLoading: Boolean,
    error: Throwable?,
    isLocated: Boolean,
    selectedId: String?,
    now: Instant,
    logo: (AroundPlace) -> String?,
    distanceText: (AroundPlace) -> String?,
    onSelect: (AroundPlace) -> Unit,
    onRetry: suspend () -> Unit,
    onShowAll: () -> Unit,
    onBrowseBrands: () -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = Spacing.gutter, end = Spacing.gutter, top = Spacing.l, bottom = Spacing.xxl),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        item(key = "header", contentType = "header") {
            Column(Modifier.padding(bottom = Spacing.xs), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                YardDisplayText("Around", size = 30.sp)
                Text(aroundListSubtitle(places.size, totalCount, isLoading, error != null, isLocated), style = YardFonts.caption, color = Color.yard.ink2)
            }
        }
        when {
            error != null -> item(key = "error") {
                EmptyState.Error(error, Modifier.padding(top = Spacing.l), retry = onRetry)
            }
            isLoading && totalCount == 0 -> items(3, key = { "skeleton-$it" }, contentType = { "skeleton" }) { AroundRowSkeleton() }
            totalCount == 0 -> item(key = "empty-all") {
                EmptyState(
                    "No places on Yard Around yet",
                    modifier = Modifier.padding(top = Spacing.l),
                    message = "When brands open stores, showrooms and pop-ups, they show up here. Until then, shop them online.",
                    icon = Icons.Outlined.PinDrop,
                    actionTitle = "Browse brands",
                    action = onBrowseBrands,
                )
            }
            places.isEmpty() -> item(key = "empty-here") {
                EmptyState(
                    "No places here yet",
                    modifier = Modifier.padding(top = Spacing.l),
                    message = "Zoom out or pick another city.",
                    icon = Icons.Outlined.Map,
                    actionTitle = "Show all places",
                    action = onShowAll,
                )
            }
            else -> items(places, key = { it.id }, contentType = { "place" }) { place ->
                AroundPlaceRow(
                    place = place,
                    logoUrl = logo(place),
                    distanceText = distanceText(place),
                    now = now,
                    isSelected = place.id == selectedId,
                    modifier = Modifier.animateItem().pressableClick { onSelect(place) },
                )
            }
        }
        item(key = "nav-inset") { Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars)) }
    }
}

/** The list header's subtitle (iOS `AroundPlacesList.subtitle`). */
internal fun aroundListSubtitle(visible: Int, total: Int, isLoading: Boolean, failed: Boolean, isLocated: Boolean): String {
    if (failed) return "Stores, showrooms, pop-ups and exhibitions"
    if (isLoading && total == 0) return "Loading places…"
    if (total == 0) return "Stores, showrooms, pop-ups and exhibitions"
    val count = "$visible ${if (visible == 1) "place" else "places"} in view"
    return if (isLocated && visible > 1) "$count · nearest first" else count
}

private fun Context.findActivity(): Activity? {
    var c: Context? = this
    while (c is ContextWrapper) {
        if (c is Activity) return c
        c = c.baseContext
    }
    return null
}

@Preview(name = "Around — dark")
@Composable
private fun AroundDark() = YardPreview(darkTheme = true) { AroundScreen(AroundViewModel(AroundFixtures.places)) }

@Preview(name = "Around — light")
@Composable
private fun AroundLight() = YardPreview(darkTheme = false) { AroundScreen(AroundViewModel(AroundFixtures.places)) }

@Preview(name = "Around list empty — dark")
@Composable
private fun AroundListEmptyDark() = YardPreview(darkTheme = true) {
    AroundPlacesList(
        places = emptyList(), totalCount = 0, isLoading = false, error = null, isLocated = false, selectedId = null, now = Instant.now(),
        logo = { null }, distanceText = { null }, onSelect = {}, onRetry = {}, onShowAll = {}, onBrowseBrands = {},
    )
}

@Preview(name = "Around list — light")
@Composable
private fun AroundListLight() = YardPreview(darkTheme = false) {
    AroundPlacesList(
        places = AroundFixtures.places, totalCount = 2, isLoading = false, error = null, isLocated = true, selectedId = null, now = Instant.now(),
        logo = { null }, distanceText = { "1.2 km" }, onSelect = {}, onRetry = {}, onShowAll = {}, onBrowseBrands = {},
    )
}
