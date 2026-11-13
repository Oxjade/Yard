package space.yardstore.app.features.you

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test
import space.yardstore.app.app.LegalPage
import space.yardstore.app.app.Route
import space.yardstore.app.designsystem.YardWindow

/** Two-pane Settings pages and the wide-window You layout. */
class YouTabletTest {

    @Test fun everySettingsPageMapsToItsPhoneRoute() {
        assertEquals(Route.Appearance, YouSettingsPage.Appearance.route)
        assertEquals(Route.NotificationSettings, YouSettingsPage.Notifications.route)
        assertEquals(Route.Addresses, YouSettingsPage.Addresses.route)
        assertEquals(Route.Legal(LegalPage.Terms), YouSettingsPage.Terms.route)
        assertEquals(Route.Legal(LegalPage.Privacy), YouSettingsPage.Privacy.route)
        assertEquals(Route.Legal(LegalPage.Refunds), YouSettingsPage.Refunds.route)
        assertEquals(Route.Legal(LegalPage.DataDeletion), YouSettingsPage.DataDeletion.route)
    }

    @Test fun everyLegalPageHasASettingsPage() {
        LegalPage.entries.forEach { page ->
            assertEquals(Route.Legal(page), YouSettingsPage.legal(page).route)
        }
    }

    @Test fun settingsPagesAreDistinctRoutes() {
        val routes = YouSettingsPage.entries.map { it.route }
        assertEquals(routes.size, routes.toSet().size)
    }

    @Test fun tilesFillOneRowOnWideWindows() {
        assertEquals(3, youTileColumns(YardWindow.Phone))
        assertEquals(6, youTileColumns(YardWindow(width = 700.dp, height = 1000.dp)))
        assertEquals(6, youTileColumns(YardWindow(width = 1280.dp, height = 800.dp)))
    }
}
