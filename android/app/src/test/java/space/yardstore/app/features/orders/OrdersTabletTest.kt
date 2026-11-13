package space.yardstore.app.features.orders

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import space.yardstore.app.designsystem.YardWindow
import space.yardstore.app.designsystem.components.ListDetailDefaults

/** Tablet behaviour: list → detail panes and the readable-width inset. */
class OrdersTabletTest {
    @Test fun opensInThePaneOnlyWhenTwoPane() {
        assertEquals(OrdersPanes.Open.Select("or_1"), OrdersPanes.open("or_1", twoPane = true))
        assertEquals(OrdersPanes.Open.Push("or_1"), OrdersPanes.open("or_1", twoPane = false))
    }

    @Test fun handsTheOpenOrderOverWhenTheWindowShrinks() {
        assertEquals("or_1", OrdersPanes.handOff(twoPane = false, selectedId = "or_1"))
        assertNull(OrdersPanes.handOff(twoPane = true, selectedId = "or_1"))
        assertNull(OrdersPanes.handOff(twoPane = false, selectedId = null))
    }

    @Test fun twoPanesOnlyOnExpanded() {
        assertEquals(false, YardWindow(width = 411.dp, height = 891.dp).isExpanded)
        assertEquals(false, YardWindow(width = 800.dp, height = 1200.dp).isExpanded)
        assertEquals(true, YardWindow(width = 1280.dp, height = 800.dp).isExpanded)
    }

    @Test fun readableInsetCentresCappedContent() {
        assertEquals(0.dp, orderReadableInset(411.dp, Dp.Unspecified))
        assertEquals(0.dp, orderReadableInset(700.dp, 720.dp))
        assertEquals(40.dp, orderReadableInset(800.dp, 720.dp))
        assertEquals(160.dp, orderReadableInset(1280.dp, 960.dp))
    }

    @Test fun listPaneIsCompactSoTheListFillsIt() {
        val total = 1280.dp
        val pane = YardWindow(width = 1280.dp, height = 800.dp).copy(width = ListDetailDefaults.listWidth(total))
        // A compact pane has no content cap: the order cards fill the list pane.
        assertEquals(Dp.Unspecified, pane.contentMaxWidth)
        assertEquals(0.dp, orderReadableInset(pane.width, pane.contentMaxWidth))
        // The detail pane (≈ 860dp) caps the order at 960dp, i.e. it fills too, with gutters.
        val detail = YardWindow(width = 1280.dp, height = 800.dp).copy(width = total - pane.width - 1.dp)
        assertEquals(0.dp, orderReadableInset(detail.width, detail.contentMaxWidth))
    }
}
