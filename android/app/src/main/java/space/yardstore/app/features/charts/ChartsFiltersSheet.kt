package space.yardstore.app.features.charts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.tooling.preview.Preview
import kotlinx.coroutines.launch
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.Chip
import space.yardstore.app.designsystem.components.YardButton
import space.yardstore.app.designsystem.components.YardButtonStyle
import space.yardstore.app.designsystem.components.YardSheet
import space.yardstore.app.designsystem.components.YardSheetHeader
import space.yardstore.app.designsystem.yard

/** The city a City chart currently shows (the server's or the shopper's default). */
data class ChartsResolvedCity(val slug: String, val name: String)

/**
 * The website's phone Filters sheet: Category and Location (City on City charts) as chips.
 * It edits a draft; "Show chart" applies it, closing discards it. Options under the minimum
 * cohort are listed but can't be chosen, so two choices never combine into an empty board.
 * Mirrors ChartsFiltersSheet.swift.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChartsFiltersSheet(
    query: ChartsQuery,
    scopes: ChartScopes?,
    resolvedCity: ChartsResolvedCity?,
    onDismiss: () -> Unit,
    onApply: (ChartsQuery) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState()
    val scope = rememberCoroutineScope()
    fun close() {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onDismiss() }
    }
    YardSheet(onDismissRequest = onDismiss, sheetState = sheetState) {
        ChartsFiltersContent(query, scopes, resolvedCity, onClose = ::close, onApply = { onApply(it); close() })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ColumnScope.ChartsFiltersContent(
    query: ChartsQuery,
    scopes: ChartScopes?,
    resolvedCity: ChartsResolvedCity?,
    onClose: () -> Unit,
    onApply: (ChartsQuery) -> Unit,
) {
    // The draft survives rotation / process death while the sheet is open.
    var draft by rememberSaveable(stateSaver = ChartsQuerySaver) { mutableStateOf(query) }
    val options = ChartsFilterOptions(draft, scopes, resolvedCity)

    YardSheetHeader("Filters", subtitle = draft.chart.label, onClose = onClose)
    Column(
        Modifier
            .weight(1f, fill = false)
            .verticalScroll(rememberScrollState())
            .padding(Spacing.gutter),
        verticalArrangement = Arrangement.spacedBy(Spacing.xl),
    ) {
        ChartsFilterSection(if (draft.chart == ChartSlug.City) "City" else "Location") {
            options.location.forEach { option ->
                Chip(option.label, isSelected = options.locationValue == option.value, isEnabled = !option.disabled) {
                    draft = options.applyLocation(option.value)
                }
            }
        }
        ChartsFilterSection("Category") {
            options.category.forEach { option ->
                Chip(option.label, isSelected = (draft.category ?: "all") == option.value, isEnabled = !option.disabled) {
                    draft = draft.copy(category = if (option.value == "all") null else option.value)
                }
            }
        }
        if (scopes == null) {
            Text(
                "Places and categories couldn't load. You can still see every chart everywhere.",
                style = YardFonts.caption,
                color = Color.yard.ink3,
            )
        }
    }
    val canClear = draft.category != null || draft.country != null || (draft.chart != ChartSlug.City && draft.city != null)
    Row(
        Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(horizontal = Spacing.gutter, vertical = Spacing.m),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
    ) {
        YardButton("Clear", style = YardButtonStyle.Secondary, fullWidth = false, enabled = canClear) {
            draft = draft.copy(
                category = null,
                country = null,
                city = if (draft.chart != ChartSlug.City) null else draft.city,
            )
        }
        YardButton("Show chart", modifier = Modifier.weight(1f)) { onApply(draft) }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ChartsFilterSection(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Text(title, style = YardFonts.captionEmphasis, color = Color.yard.ink2)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.s),
            verticalArrangement = Arrangement.spacedBy(Spacing.s),
        ) { content() }
    }
}

/** Options (website board-controls.tsx), computed from the draft. */
internal class ChartsFilterOptions(
    private val draft: ChartsQuery,
    private val scopes: ChartScopes?,
    private val resolvedCity: ChartsResolvedCity?,
) {
    data class Option(val value: String, val label: String, val disabled: Boolean = false)

    private val minCohort: Int get() = scopes?.minCohort ?: 3

    val locationValue: String
        get() = when {
            draft.city != null -> "city:${draft.city}"
            draft.country != null -> "country:${draft.country}"
            draft.chart == ChartSlug.City && resolvedCity != null -> "city:${resolvedCity.slug}"
            else -> "all"
        }

    fun applyLocation(value: String): ChartsQuery {
        val parts = value.split(":", limit = 2)
        val kind = parts.firstOrNull() ?: "all"
        val v = parts.getOrNull(1)
        return draft.copy(city = if (kind == "city") v else null, country = if (kind == "country") v else null)
    }

    private fun count(eligible: Int, byCategory: Map<String, Int>): Int =
        draft.category?.let { byCategory[it] ?: 0 } ?: eligible

    val location: List<Option>
        get() {
            val s = scopes ?: return if (draft.chart == ChartSlug.City) emptyList() else listOf(Option("all", "Everywhere"))
            val currentCity = draft.city ?: (if (draft.chart == ChartSlug.City) resolvedCity?.slug else null)
            val cities = s.cities.filter { it.eligible >= minCohort || it.slug == currentCity }
            val cityOptions = cities.map { c ->
                val n = count(c.eligible, c.byCategory)
                Option("city:${c.slug}", "${c.name} · ${ChartsFormat.brands(n)}", disabled = n < minCohort && c.slug != currentCity)
            }.toMutableList()
            if (resolvedCity != null && cities.none { it.slug == resolvedCity.slug }) {
                cityOptions += Option("city:${resolvedCity.slug}", resolvedCity.name)
            }
            if (draft.chart == ChartSlug.City) return cityOptions
            val countries = s.countries
                .filter { count(it.eligible, it.byCategory) > 0 || it.code == draft.country }
                .map { c ->
                    val n = count(c.eligible, c.byCategory)
                    Option("country:${c.code}", "${c.name} · ${ChartsFormat.brands(n)}", disabled = n < minCohort && c.code != draft.country)
                }
            return listOf(Option("all", "Everywhere")) + countries + cityOptions
        }

    val category: List<Option>
        get() {
            val out = mutableListOf(Option("all", "All categories"))
            val s = scopes ?: return out
            val citySlug = draft.city ?: (if (draft.chart == ChartSlug.City) resolvedCity?.slug else null)
            for (c in s.categories) {
                val n = when {
                    citySlug != null -> s.cities.firstOrNull { it.slug == citySlug }?.byCategory?.get(c.slug) ?: 0
                    draft.country != null -> s.countries.firstOrNull { it.code == draft.country }?.byCategory?.get(c.slug) ?: 0
                    else -> c.eligible
                }
                val current = c.slug == draft.category
                if (n == 0 && !current) continue
                out += Option(c.slug, "${c.label} · ${ChartsFormat.brands(n)}", disabled = n < minCohort && !current)
            }
            return out
        }
}

// region Previews

internal object ChartsFiltersPreview {
    val scopes = ChartScopes(
        cities = listOf(
            ChartScopes.City("lagos", "Lagos", "NG", 6, mapOf("streetwear" to 4)),
            ChartScopes.City("accra", "Accra", "GH", 2, mapOf("streetwear" to 1)),
        ),
        countries = listOf(
            ChartScopes.Country("GH", "Ghana", 2, mapOf("streetwear" to 1)),
            ChartScopes.Country("NG", "Nigeria", 7, mapOf("streetwear" to 5)),
        ),
        categories = listOf(
            ChartScopes.Category("streetwear", "Streetwear", 6),
            ChartScopes.Category("bags", "Bags", 1),
        ),
        minCohort = 3,
    )
}

@Preview(name = "Charts filters — dark")
@Composable
private fun ChartsFiltersDarkPreview() = YardPreview(darkTheme = true) {
    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        ChartsFiltersContent(ChartsQuery(), ChartsFiltersPreview.scopes, null, onClose = {}, onApply = {})
    }
}

@Preview(name = "Charts filters — light")
@Composable
private fun ChartsFiltersLightPreview() = YardPreview(darkTheme = false) {
    Column(Modifier.fillMaxSize().background(Color.yard.bg)) {
        ChartsFiltersContent(ChartsQuery(chart = ChartSlug.City), ChartsFiltersPreview.scopes, ChartsResolvedCity("lagos", "Lagos"), onClose = {}, onApply = {})
    }
}

// endregion
