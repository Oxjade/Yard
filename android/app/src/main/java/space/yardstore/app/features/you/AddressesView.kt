package space.yardstore.app.features.you

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Paid
import androidx.compose.material.icons.outlined.Place
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import space.yardstore.app.app.AppTab
import space.yardstore.app.app.LocalRouter
import space.yardstore.app.core.stores.LocalCartStore
import space.yardstore.app.designsystem.Spacing
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.components.EmptyState
import space.yardstore.app.designsystem.components.SettingsRow
import space.yardstore.app.designsystem.components.YardTopBar
import space.yardstore.app.designsystem.components.yardScreenBackground

/**
 * You › Addresses. Mirrors AddressesView.swift. Yard has no saved-address API yet (the delivery
 * address is entered at checkout, per order), so this screen is honest about it and keeps the one
 * location setting that does exist: the ship-to country (delivery times, shipping costs, currency).
 */
@Composable
fun AddressesView() {
    val cart = LocalCartStore.current
    val router = LocalRouter.current
    var regionSheet by remember { mutableStateOf<YouRegionSheetMode?>(null) }
    var shipTo by remember { mutableStateOf(YouRegion.storedShipTo) }

    LaunchedEffect(Unit) { YouRegion.restore(cart) }

    Column(Modifier.fillMaxSize().yardScreenBackground()) {
        YardTopBar("Addresses")
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .padding(horizontal = Spacing.gutter)
                .padding(top = Spacing.m, bottom = Spacing.xxl),
            verticalArrangement = Arrangement.spacedBy(Spacing.xl),
        ) {
            EmptyState(
                title = "No saved addresses",
                message = "You enter where each order goes at checkout. Yard doesn't keep an address book yet.",
                icon = Icons.Outlined.Place,
                actionTitle = if (cart.isEmpty) null else "Go to your bag",
                action = if (cart.isEmpty) null else ({ router.select(AppTab.Bag) }),
                modifier = Modifier.heightIn(min = 260.dp),
            )

            YouSettingsGroup("Delivery", footer = "Where you ship to sets delivery times and shipping costs. Checkout confirms both.") {
                SettingsRow(
                    "Ship to", Icons.Outlined.Inventory2,
                    Modifier.youRowClick { regionSheet = YouRegionSheetMode.Country },
                    value = YouMarkets.country(shipTo)?.name ?: "Not set",
                )
                SettingsRow(
                    "Currency", Icons.Outlined.Paid,
                    Modifier.youRowClick { regionSheet = YouRegionSheetMode.Currency },
                    value = YouMarkets.currency(cart.currency)?.label ?: cart.currency,
                )
            }
        }
    }

    regionSheet?.let { mode ->
        YouRegionSheet(mode = mode, onChange = { shipTo = YouRegion.storedShipTo }, onDismiss = { regionSheet = null })
    }
}

@Preview(name = "AddressesView — dark")
@Composable
private fun AddressesDark() = YardPreview(darkTheme = true) { AddressesView() }

@Preview(name = "AddressesView — light")
@Composable
private fun AddressesLight() = YardPreview(darkTheme = false) { AddressesView() }
