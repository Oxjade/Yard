package space.yardstore.app.features.shop

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.ArrowOutward
import androidx.compose.material.icons.outlined.GridView
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.app.Route
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.RemoteImage
import space.yardstore.app.designsystem.components.Skeleton
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardDivider
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.monospacedDigits
import space.yardstore.app.designsystem.yard

// The category index (website: /categories). Big photo cards, one per category, with live
// piece/brand counts from GET /api/catalog/categories, then a "Shop everything" call to action.
// Mirrors ios/Yard/Features/Shop/CategoriesView.swift.

class CategoriesModel private constructor(
    /** False for previews (fixed data, no network). */
    private val fetches: Boolean,
    initial: List<ShopCategory>?,
    private val api: APIClient = APIClient.shared,
    /** Tests only: prefix for API paths (a MockWebServer URL). */
    private val baseUrl: String = "",
) : ViewModel() {

    sealed interface Phase {
        data object Loading : Phase
        data object Loaded : Phase
        data class Failed(val error: Throwable) : Phase
    }

    constructor() : this(fetches = true, initial = null)

    /** Tests: a fetching model against another client/server. */
    internal constructor(api: APIClient, baseUrl: String) : this(true, null, api, baseUrl)

    companion object {
        /** Previews only: start with fixed categories. */
        fun preview(categories: List<ShopCategory>) = CategoriesModel(fetches = false, initial = categories)
    }

    var categories by mutableStateOf(initial ?: emptyList()); private set
    var phase by mutableStateOf<Phase>(if (initial != null) Phase.Loaded else Phase.Loading); private set
    var isPullRefreshing by mutableStateOf(false); private set

    private var job: Job? = null

    fun load(force: Boolean = false) {
        if (!fetches) return
        if (!force && job?.isActive == true) return
        job?.cancel()
        job = viewModelScope.launch { loadNow(force) }
    }

    /** Pull to refresh. */
    fun refresh() {
        if (!fetches || isPullRefreshing) return
        isPullRefreshing = true
        job?.cancel()
        job = viewModelScope.launch {
            try { loadNow(force = true) } finally { isPullRefreshing = false }
        }
    }

    private suspend fun loadNow(force: Boolean) {
        if (categories.isEmpty() && !force) {
            ShopCategoryCache.current?.let {
                categories = it
                phase = Phase.Loaded
            }
        }
        if (categories.isEmpty()) phase = Phase.Loading
        try {
            categories = ShopCategoryCache.categories(force, api, baseUrl)
            phase = Phase.Loaded
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (shopIsCancellation(e)) return
            if (categories.isEmpty()) phase = Phase.Failed(e)
        }
    }
}

@Composable
fun CategoriesView() {
    val model: CategoriesModel = viewModel { CategoriesModel() }
    CategoriesScreen(model)
}

@Composable
internal fun CategoriesScreen(model: CategoriesModel) {
    val router = LocalRouter.current
    LaunchedEffect(model) { model.load() }
    val bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding() + Spacing.xxl

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Categories")
        ShopRefreshBox(isRefreshing = model.isPullRefreshing, onRefresh = { model.refresh() }, modifier = Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = bottom),
                verticalArrangement = Arrangement.spacedBy(Spacing.s),
            ) {
                item(key = "header") {
                    CategoriesHeader(model, Modifier.padding(bottom = Spacing.xl - Spacing.s))
                }
                when (val phase = model.phase) {
                    CategoriesModel.Phase.Loading -> item(key = "skeleton") { CategoriesSkeleton() }
                    is CategoriesModel.Phase.Failed -> item(key = "error") {
                        EmptyState.Error(phase.error, Modifier.heightIn(min = 360.dp)) { model.load(force = true) }
                    }
                    CategoriesModel.Phase.Loaded -> if (model.categories.isEmpty()) {
                        item(key = "empty") {
                            EmptyState(
                                title = "No categories yet",
                                modifier = Modifier.heightIn(min = 360.dp),
                                message = "Brands are joining Yard. Browse everything at once in the shop.",
                                icon = Icons.Outlined.GridView,
                                actionTitle = "Shop everything",
                            ) { router.push(Route.Shop) }
                        }
                    } else {
                        val categories = model.categories
                        items(CategoriesLayout.rows(categories.size), key = { "row-${it.id}" }) { row ->
                            CategoriesMosaicRow(row, categories)
                        }
                        item(key = "shop-everything") { ShopEverything(Modifier.padding(top = Spacing.xl - Spacing.s)) }
                    }
                }
            }
        }
    }
}

// MARK: Header

@Composable
private fun CategoriesHeader(model: CategoriesModel, modifier: Modifier = Modifier) {
    val lead = if (model.categories.isEmpty()) "" else "${model.categories.size} ways into the catalogue. "
    Column(
        modifier.fillMaxWidth().padding(horizontal = Spacing.gutter).padding(top = Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        ShopDisplayText("Categories", 52.sp)
        Text(
            lead + "Every category is made up of small, independent studios, never resellers.",
            style = YardFonts.callout,
            color = Color.yard.ink2,
        )
    }
}

// MARK: Mosaic

/** Rows of one wide card then two half cards, repeating (the website's phone mosaic). */
internal object CategoriesLayout {
    sealed interface Kind {
        data class Wide(val index: Int) : Kind
        data class Pair(val left: Int, val right: Int?) : Kind
    }

    data class MosaicRow(val id: Int, val kind: Kind)

    fun rows(count: Int): List<MosaicRow> {
        val rows = mutableListOf<MosaicRow>()
        var i = 0
        var wideNext = true
        while (i < count) {
            if (wideNext) {
                rows.add(MosaicRow(i, Kind.Wide(i)))
                i += 1
            } else {
                val right = if (i + 1 < count) i + 1 else null
                rows.add(MosaicRow(i, Kind.Pair(i, right)))
                i += 2
            }
            wideNext = !wideNext
        }
        return rows
    }
}

@Composable
private fun CategoriesMosaicRow(row: CategoriesLayout.MosaicRow, categories: List<ShopCategory>) {
    Box(Modifier.padding(horizontal = Spacing.gutter)) {
        when (val kind = row.kind) {
            is CategoriesLayout.Kind.Wide -> CategoryCardLink(categories, kind.index, 260.dp, wide = true, Modifier.fillMaxWidth())
            is CategoriesLayout.Kind.Pair -> Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                CategoryCardLink(categories, kind.left, 230.dp, wide = false, Modifier.weight(1f))
                if (kind.right != null) {
                    CategoryCardLink(categories, kind.right, 230.dp, wide = false, Modifier.weight(1f))
                } else {
                    Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun CategoryCardLink(categories: List<ShopCategory>, index: Int, height: Dp, wide: Boolean, modifier: Modifier) {
    val router = LocalRouter.current
    val category = categories[index]
    CategoryCard(
        category,
        index,
        wide,
        modifier.height(height).pressableClick { router.push(Route.Category(category.slug)) },
    )
}

@Composable
private fun ShopEverything(modifier: Modifier = Modifier) {
    val router = LocalRouter.current
    Column(modifier.fillMaxWidth().padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        YardDivider(Modifier.padding(bottom = Spacing.s))
        Text("Not sure where to start?", style = YardFonts.title, color = Color.yard.ink)
        Text(
            "Browse everything at once, then narrow by category, stock or price.",
            style = YardFonts.callout,
            color = Color.yard.ink2,
        )
        YardButton("Shop everything", Modifier.padding(top = Spacing.xs), icon = Icons.AutoMirrored.Filled.ArrowForward) {
            router.push(Route.Shop)
        }
    }
}

// MARK: - Category card

/** A photo card: the category image, a bottom scrim, "01", the name in display type and the live count. */
@Composable
internal fun CategoryCard(category: ShopCategory, index: Int, wide: Boolean, modifier: Modifier = Modifier) {
    val scrim = Color.yard.scrim
    Box(
        modifier
            .fillMaxWidth()
            .clip(YardShapes.card)
            .background(Color.yard.surface2)
            .clearAndSetSemantics {
                contentDescription = "${category.name}, ${category.countText}"
                role = Role.Button
            },
        contentAlignment = Alignment.BottomStart,
    ) {
        RemoteImage(category.imageUrl, Modifier.fillMaxSize(), maxPixelSize = if (wide) 1200 else 700)
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(listOf(scrim.copy(alpha = 0f), scrim.copy(alpha = 0.15f), scrim.copy(alpha = 0.72f))),
            ),
        )
        Column(Modifier.padding(Spacing.l), verticalArrangement = Arrangement.spacedBy(Spacing.xs)) {
            Text(
                "%02d".format(index + 1),
                style = YardFonts.display(15.sp).monospacedDigits(),
                color = Color.yard.onPhoto,
            )
            ShopDisplayText(category.name, if (wide) 44.sp else 32.sp, color = Color.yard.onPhoto, maxLines = 2, minScale = 0.7f)
            if (wide && category.description.isNotEmpty()) {
                Text(category.description, style = YardFonts.caption, color = Color.yard.onPhoto.copy(alpha = 0.85f), maxLines = 2)
            }
            Text(
                category.countText,
                style = YardFonts.captionEmphasis.monospacedDigits(),
                color = Color.yard.onPhoto.copy(alpha = 0.85f),
                maxLines = 1,
            )
        }
        Box(
            Modifier
                .align(Alignment.TopEnd)
                .padding(Spacing.m)
                .size(36.dp)
                .background(Color.yard.surface.copy(alpha = 0.72f), CircleShape)
                .border(BorderStroke(1.dp, Color.yard.line), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.ArrowOutward, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(16.dp))
        }
    }
}

// MARK: - Skeleton

@Composable
private fun CategoriesSkeleton() {
    Column(Modifier.padding(horizontal = Spacing.gutter), verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
        Skeleton(Modifier.fillMaxWidth().height(260.dp), cornerRadius = Radius.card)
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
            Skeleton(Modifier.weight(1f).height(230.dp), cornerRadius = Radius.card)
            Skeleton(Modifier.weight(1f).height(230.dp), cornerRadius = Radius.card)
        }
        Skeleton(Modifier.fillMaxWidth().height(260.dp), cornerRadius = Radius.card)
    }
}

// MARK: - Previews

private val categoriesPreviewFixtures = listOf(
    ShopCategory(slug = "fashion", name = "Fashion", description = "Tailoring, dresses and knitwear from independent designers.", subcategories = listOf("Outerwear", "Shirts"), productCount = 42, brandCount = 9),
    ShopCategory(slug = "streetwear", name = "Streetwear", description = "Heavyweight basics, graphics and outerwear.", subcategories = listOf("Hoodies"), productCount = 18, brandCount = 4),
    ShopCategory(slug = "sneakers", name = "Sneakers", productCount = 0, brandCount = 0),
    ShopCategory(slug = "accessories", name = "Accessories", description = "Bags, headwear, eyewear.", productCount = 1, brandCount = 1),
    ShopCategory(slug = "jewelry", name = "Jewelry", productCount = 7, brandCount = 2),
)

@Composable
private fun CategoriesPreviewScreen() {
    val model = remember { CategoriesModel.preview(categoriesPreviewFixtures) }
    CategoriesScreen(model)
}

@Preview(name = "CategoriesView — dark", heightDp = 1100)
@Composable
private fun CategoriesViewDarkPreview() = YardPreview(darkTheme = true) { CategoriesPreviewScreen() }

@Preview(name = "CategoriesView — light", heightDp = 1100)
@Composable
private fun CategoriesViewLightPreview() = YardPreview(darkTheme = false) { CategoriesPreviewScreen() }
