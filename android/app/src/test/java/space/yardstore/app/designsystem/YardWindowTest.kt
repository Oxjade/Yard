package space.yardstore.app.designsystem

import android.content.pm.ActivityInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.app.MainActivity
import space.yardstore.app.app.Router
import space.yardstore.app.designsystem.components.ListDetailDefaults
import space.yardstore.app.designsystem.components.distributeMasonry
import space.yardstore.app.designsystem.components.distributeMasonryColumns

class YardWindowTest {
    @Test fun widthClassThresholds() {
        assertEquals(YardWidthClass.Compact, YardWidthClass.of(0.dp))
        assertEquals(YardWidthClass.Compact, YardWidthClass.of(411.dp))
        assertEquals(YardWidthClass.Compact, YardWidthClass.of(599.9.dp))
        assertEquals(YardWidthClass.Medium, YardWidthClass.of(600.dp))
        assertEquals(YardWidthClass.Medium, YardWidthClass.of(839.dp))
        assertEquals(YardWidthClass.Expanded, YardWidthClass.of(840.dp))
        assertEquals(YardWidthClass.Expanded, YardWidthClass.of(1280.dp))
    }

    @Test fun heightClassThresholds() {
        assertEquals(YardHeightClass.Compact, YardHeightClass.of(479.dp))
        assertEquals(YardHeightClass.Medium, YardHeightClass.of(480.dp))
        assertEquals(YardHeightClass.Medium, YardHeightClass.of(899.dp))
        assertEquals(YardHeightClass.Expanded, YardHeightClass.of(900.dp))
    }

    @Test fun gridColumns() {
        assertEquals(2, YardWindow(411.dp, 891.dp).gridColumns)
        assertEquals(2, YardWindow(599.dp, 891.dp).gridColumns)
        assertEquals(3, YardWindow(600.dp, 960.dp).gridColumns)
        assertEquals(3, YardWindow(673.dp, 841.dp).gridColumns) // unfolded foldable
        assertEquals(4, YardWindow(840.dp, 1200.dp).gridColumns)
        assertEquals(4, YardWindow(1280.dp, 800.dp).gridColumns)
        assertEquals(2, YardWindow.Phone.gridColumns)
    }

    @Test fun helpers() {
        val phone = YardWindow(411.dp, 891.dp)
        assertFalse(phone.isWide)
        assertTrue(phone.isCompact)
        assertFalse(phone.sheetIsDialog)
        assertEquals(Dp.Unspecified, phone.contentMaxWidth)

        val medium = YardWindow(700.dp, 1000.dp)
        assertTrue(medium.isWide)
        assertFalse(medium.isExpanded)
        assertTrue(medium.sheetIsDialog)
        assertEquals(720.dp, medium.contentMaxWidth)

        val expanded = YardWindow(1280.dp, 800.dp)
        assertTrue(expanded.isExpanded)
        assertTrue(expanded.isLandscape)
        assertEquals(YardHeightClass.Medium, expanded.heightClass)
        assertEquals(960.dp, expanded.contentMaxWidth)
    }

    @Test fun paneKeepsWindowDecisionForSheets() {
        val pane = YardWindow(1280.dp, 800.dp).copy(width = 380.dp)
        assertEquals(YardWidthClass.Compact, pane.widthClass)
        assertEquals(2, pane.gridColumns)
        assertTrue(pane.sheetIsDialog)
    }

    @Test fun listPaneWidth() {
        assertEquals(320.dp, ListDetailDefaults.listWidth(840.dp))
        assertEquals(420.dp, ListDetailDefaults.listWidth(1280.dp))
        assertEquals(380.dp, ListDetailDefaults.listWidth(1000.dp))
    }

    @Test fun masonryDistribution() {
        val items = (0 until 9).toList()
        val four = distributeMasonryColumns(items, 4, 0f, 0f) { 1f }
        assertEquals(listOf(listOf(0, 4, 8), listOf(1, 5), listOf(2, 6), listOf(3, 7)), four)
        // Tall first item: the next ones fill the other columns first.
        val three = distributeMasonryColumns(listOf(0, 1, 2, 3), 3, 0f, 0f) { if (it == 0) 3f else 1f }
        assertEquals(listOf(listOf(0), listOf(1, 3), listOf(2)), three)
        assertEquals(1, distributeMasonryColumns(items, 0, 0f, 0f) { 1f }.size)
        // Two-column API unchanged.
        val (left, right) = distributeMasonry(listOf(0, 1, 2, 3), 0f, 0f) { 1f }
        assertEquals(listOf(0, 2), left)
        assertEquals(listOf(1, 3), right)
    }

    @Test fun orientationPolicy() {
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, MainActivity.orientationFor(411))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, MainActivity.orientationFor(599))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, MainActivity.orientationFor(600))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, MainActivity.orientationFor(800))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED, MainActivity.orientationFor(0))
    }

    @Test fun railVisibility() {
        val router = Router()
        assertTrue(router.isTabRailVisible)
        router.isTabPillSuppressed = true
        assertFalse(router.isTabRailVisible)
    }
}
