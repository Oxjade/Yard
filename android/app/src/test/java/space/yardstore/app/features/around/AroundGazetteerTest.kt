package space.yardstore.app.features.around

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The bundled gazetteer (assets/around/data/gazetteer.json, from the website's gazetteer.ts) and
 * the website's area cameras (geo.ts areaCamera / cameraForFix / searchAreas).
 */
class AroundGazetteerTest {
    private val gaz = AroundGazetteer.parse(File("src/main/assets/around/data/gazetteer.json").readText())
    /** The website's phone frame on a 390 × 844 screen (PAD_PHONE: 32 + 72 wide, 140 + 260 tall). */
    private val webPhone = AroundFrame(390.0 - 32 - 72, 844.0 - 140 - 260)

    @Test fun loadsEveryCityAndNeighbourhood() {
        val lagos = gaz.cities.first { it.slug == "lagos" }
        assertEquals(6, lagos.neighbourhoods.size)
        assertTrue(gaz.cities.size >= 100)
        assertTrue(AroundGazetteer.parse("not json").cities.isEmpty())
    }

    @Test fun searchFindsCitiesNeighbourhoodsAndAliases() {
        assertEquals("lagos", gaz.search("Lagos").first().slug)
        assertEquals("lagos", gaz.search("eko").first().slug)
        val vi = gaz.search("VI").first()
        assertEquals("lagos/victoria-island", vi.slug)
        assertEquals("Victoria Island, Lagos", vi.label)
        assertEquals("berlin/neukolln", gaz.search("neukolln").first().slug)
        assertEquals("Neukölln", gaz.search("Neukölln").first().name)
        assertTrue(gaz.search("   ").isEmpty())
        assertTrue(gaz.search("zzzz").isEmpty())
    }

    @Test fun areaCameraMatchesTheWebsite() {
        // geo.ts: a neighbourhood is its centroid at 13.5.
        val ikoyi = gaz.search("Ikoyi").first()
        assertEquals(AroundGlobeCamera(ikoyi.lat, ikoyi.lng, 13.5), gaz.areaCamera(ikoyi, webPhone))
        // A city frames its neighbourhoods; on the website's 390 × 844 phone Lagos lands on
        // { lat: 6.51496, lng: 3.4119, zoom: 10.4 } (checked against the web build).
        val lagos = gaz.city("lagos")!!
        val cam = gaz.areaCamera(lagos, webPhone)
        assertEquals(6.51496, cam.latitude, 1e-5)
        assertEquals(3.4119, cam.longitude, 1e-5)
        assertEquals(10.4, cam.zoom, 1e-9)
        // A big frame comes closer, never past 11.5.
        assertEquals(11.5, gaz.areaCamera(lagos, AroundFrame(4000.0, 4000.0)).zoom, 1e-9)
    }

    @Test fun smallFrameFramesTheCitysPlaces() {
        val lagos = gaz.city("lagos")!!
        val tiny = AroundFrame(200.0, 150.0)
        val places = listOf(AroundCoordinate(6.45, 3.47), AroundCoordinate(6.43, 3.42))
        val cam = gaz.areaCamera(lagos, tiny, places)
        assertTrue(cam.zoom >= AroundGazetteer.HOOD_ZOOM)
        assertEquals(6.44, cam.latitude, 0.01)
    }

    @Test fun locateUsesTheAreaNeverTheFix() {
        // A fix in Ikoyi: Ikoyi's camera, not the fix.
        val (cam, area) = gaz.cameraForFix(6.452, 3.436, webPhone)
        assertEquals("lagos/ikoyi", area!!.slug)
        assertEquals(13.5, cam.zoom, 1e-9)
        assertEquals(6.4474, cam.latitude, 1e-9)
        // 30 km out of Lagos: the city's camera.
        val (cityCam, city) = gaz.cameraForFix(6.70, 3.20, webPhone)
        assertEquals("lagos", city!!.slug)
        assertEquals(gaz.areaCamera(city, webPhone), cityCam)
        // Nowhere near a gazetteer area: the fix at zoom 10.
        val (sea, none) = gaz.cameraForFix(-40.0, -30.0, webPhone)
        assertNull(none)
        assertEquals(AroundGlobeCamera(-40.0, -30.0, 10.0), sea)
    }

    @Test fun kindChipsFilterLikeTheWebsite() {
        val places = AroundPlacesResponse.decode(AroundJson.places).places
        assertEquals(places, AroundKindFilter.apply(places, emptySet()))
        val stores = AroundKindFilter.apply(places, setOf(AroundKindFilter.Store))
        assertTrue(stores.isNotEmpty() && stores.all { it.kind == AroundPlaceKind.Store })
        val popups = AroundKindFilter.apply(places, setOf(AroundKindFilter.Popup, AroundKindFilter.Showroom))
        assertTrue(popups.all { it.kind == AroundPlaceKind.Popup || it.kind == AroundPlaceKind.Showroom })
        assertFalse(AroundKindFilter.Offers.matches(places.first().copy(offer = false)))
        assertTrue(AroundKindFilter.Events.matches(places.first().copy(nextEvent = AroundNextEvent(id = "e1"))))
    }
}
