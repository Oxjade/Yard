package space.yardstore.app.features.you

import space.yardstore.app.designsystem.YardTabletPreviews
import space.yardstore.app.designsystem.components.adaptiveContentWidth
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import space.yardstore.app.core.AppearancePreference
import space.yardstore.app.core.stores.LocalAppearanceStore
import space.yardstore.app.designsystem.LocalYardColors
import space.yardstore.app.designsystem.Radius
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardColors
import space.yardstore.app.designsystem.YardFonts
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.pressableClick
import space.yardstore.app.designsystem.components.yardScreenBackground
import space.yardstore.app.designsystem.yard

/**
 * You › Settings › Appearance: System / Light / Dark. Mirrors AppearanceView.swift. Writes
 * `AppearanceStore` (DataStore key `appearance`); MainActivity applies it at the root.
 */
@Composable
fun AppearanceView() {
    val store = LocalAppearanceStore.current
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    // Previews have no store: keep the choice locally there.
    var local by remember { mutableStateOf(AppearancePreference.SYSTEM) }
    val stored = store?.preference?.collectAsState(AppearancePreference.SYSTEM)
    val selection = stored?.value ?: local

    fun choose(option: AppearancePreference) {
        if (option == selection) return
        haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
        if (store == null) local = option else scope.launch { store.set(option) }
    }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Appearance")
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .adaptiveContentWidth()
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.m, bottom = Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                AppearancePreference.entries.forEach { option ->
                    AppearanceSwatch(option, option == selection, Modifier.weight(1f)) { choose(option) }
                }
            }

            YouSettingsGroup("Theme", footer = "System follows your phone's Light and Dark setting.") {
                AppearancePreference.entries.forEach { option ->
                    val isSelected = option == selection
                    SettingsRow(
                        option.title,
                        option.icon,
                        Modifier
                            .youRowClick { choose(option) }
                            .semantics { selected = isSelected },
                    ) {
                        if (isSelected) {
                            Icon(Icons.Filled.Check, contentDescription = null, tint = Color.yard.ink, modifier = Modifier.size(18.dp))
                        }
                    }
                }
            }
        }
    }
}

/** A small phone-shaped preview of each appearance, drawn with fixed colour sets. */
@Composable
private fun AppearanceSwatch(option: AppearancePreference, isSelected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val shape = RoundedCornerShape(Radius.small)
    Column(
        modifier
            .pressableClick(onClick = onClick)
            .clearAndSetSemantics {
                contentDescription = option.title
                selected = isSelected
                role = Role.RadioButton
            },
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
        horizontalAlignment = androidx.compose.ui.Alignment.CenterHorizontally,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(120.dp)
                .clip(shape)
                .border(if (isSelected) 3.dp else 1.dp, if (isSelected) Color.yard.acid else Color.yard.line, shape),
        ) {
            when (option) {
                AppearancePreference.LIGHT -> AppearanceMiniScreen(YardColors.Light, Modifier.fillMaxSize())
                AppearancePreference.DARK -> AppearanceMiniScreen(YardColors.Dark, Modifier.fillMaxSize())
                AppearancePreference.SYSTEM -> Row(Modifier.fillMaxSize()) {
                    AppearanceMiniScreen(YardColors.Light, Modifier.weight(1f).fillMaxHeight())
                    AppearanceMiniScreen(YardColors.Dark, Modifier.weight(1f).fillMaxHeight())
                }
            }
        }
        Text(
            option.title,
            style = YardFonts.captionEmphasis,
            color = if (isSelected) Color.yard.ink else Color.yard.ink2,
        )
    }
}

/** The mini screen inside a swatch; its tokens resolve against the given colour set. */
@Composable
private fun AppearanceMiniScreen(colors: YardColors, modifier: Modifier = Modifier) {
    CompositionLocalProvider(LocalYardColors provides colors) {
        Column(
            modifier.background(Color.yard.bg).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(Modifier.size(width = 34.dp, height = 6.dp).background(Color.yard.ink, RoundedCornerShape(3.dp)))
            Box(Modifier.fillMaxWidth().height(30.dp).background(Color.yard.surface, RoundedCornerShape(6.dp)))
            Box(Modifier.fillMaxWidth().height(30.dp).background(Color.yard.surface, RoundedCornerShape(6.dp)))
            Box(Modifier.width(30.dp).height(8.dp).background(Color.yard.acid, YardShapes.pill))
        }
    }
}

@Preview(name = "AppearanceView — dark")
@Composable
private fun AppearanceDark() = YardPreview(darkTheme = true) { AppearanceView() }

@Preview(name = "AppearanceView — light")
@Composable
private fun AppearanceLight() = YardPreview(darkTheme = false) { AppearanceView() }

@YardTabletPreviews
@Composable
private fun AppearanceTablet() = YardPreview(darkTheme = true) { AppearanceView() }
