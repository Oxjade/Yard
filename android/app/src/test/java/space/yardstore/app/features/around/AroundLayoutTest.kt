package space.yardstore.app.features.around

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

/** Tablet layout helpers: the Expanded side panel, camera framing for a picked place, photo widths. */
class AroundLayoutTest {
    private val place = AroundPlacesResponse.decode(AroundJson.places).places[0]

    @Test fun selectionPullsPinAboveTheSheet() {
        val r = aroundSelectionRegion(place, AroundRegion(AroundCoordinate(0.0, 0.0), 0.1, 0.2), sheetBelow = true)
        assertEquals(place.lat - 0.1 * 0.22, r.center.latitude, 1e-9)
        assertEquals(place.lng, r.center.longitude, 1e-9)
        assertEquals(0.1, r.latitudeDelta, 1e-9)
        assertEquals(0.2, r.longitudeDelta, 1e-9)
    }

    @Test fun selectionCentresPinBesideTheSidePanel() {
        val r = aroundSelectionRegion(place, AroundRegion(AroundCoordinate(0.0, 0.0), 0.1, 0.2), sheetBelow = false)
        assertEquals(place.lat, r.center.latitude, 1e-9)
        assertEquals(place.lng, r.center.longitude, 1e-9)
    }

    @Test fun selectionZoomsInFromFarAwayAndDefaultsWithoutRegion() {
        val far = aroundSelectionRegion(place, AroundRegion(AroundCoordinate(0.0, 0.0), 40.0, 80.0), sheetBelow = false)
        assertEquals(0.04, far.latitudeDelta, 1e-9)
        assertEquals(0.04, far.longitudeDelta, 1e-9)
        val unknown = aroundSelectionRegion(place, null, sheetBelow = false)
        assertEquals(0.05, unknown.latitudeDelta, 1e-9)
    }

    @Test fun sidePanelWidthFollowsListPane() {
        assertEquals(320.dp, aroundPanelWidth(840.dp))
        assertEquals(380.dp, aroundPanelWidth(1000.dp))
        assertEquals(420.dp, aroundPanelWidth(1280.dp))
    }

    @Test fun photoWidthFitsTheContainer() {
        assertEquals(388.dp, aroundPhotoWidth(420.dp, 1))
        assertEquals(388.dp * 0.88f, aroundPhotoWidth(420.dp, 3))
        assertEquals(0.dp, aroundPhotoWidth(20.dp, 1))
    }
}
