package space.yardstore.app.features.around

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AroundModelsTest {
    @Test fun placesDecodeAndDropMalformedRows() {
        val res = AroundPlacesResponse.decode(AroundJson.places)
        assertEquals(listOf("loc_lagos_thread_ikoyi", "loc_acme_shoreditch"), res.places.map { it.id })
        val store = res.places[0]
        assertEquals("Lagos Thread", store.brand.name)
        assertTrue(store.brand.verified)
        assertEquals(AroundPlaceKind.Store, store.kind)
        assertEquals("street", store.pinPrecision)
        assertEquals("Africa/Lagos", store.timeZone)
        assertEquals(6.4541, store.lat, 1e-9)
        assertEquals("/api/media/med_1", store.image?.src)
        assertEquals("Drop 07: Third Mainland", store.nextEvent?.title)
        assertTrue(store.offer)
        assertEquals("Ikoyi, Lagos", store.whereText)
        assertEquals("Streetwear · Store", store.categoryKindText)
    }

    @Test fun hoursDecodeWithNullDaysAsClosed() {
        val store = AroundPlacesResponse.decode(AroundJson.places).places[0]
        val hours = assertNotNullAnd(store.hours)
        assertEquals("10:00–21:00", hours.label("fri"))
        assertEquals("Closed", hours.label("sun"))
        assertTrue(hours.hasAny)
        assertEquals(emptyList<List<String>>(), hours.ranges("sun"))
    }

    @Test fun popupDecodesDatesAndNullables() {
        val popup = AroundPlacesResponse.decode(AroundJson.places).places[1]
        assertEquals(AroundPlaceKind.Popup, popup.kind)
        assertTrue(popup.kind.isDated)
        assertNull(popup.hours)
        assertNull(popup.image)
        assertNull(popup.neighbourhood)
        assertEquals("London", popup.whereText)
        assertEquals("2026-11-20T18:00:00.000Z", popup.endsAt)
    }

    @Test fun unknownKindFallsBackToStore() {
        val json = """{"places":[{"id":"loc_1","brand":{"id":"b"},"kind":"warehouse","lat":1,"lng":2}]}"""
        val p = AroundPlacesResponse.decode(json).places.single()
        assertEquals(AroundPlaceKind.Store, p.kind)
        assertEquals("b", p.brand.handle)
        assertEquals("A Yard brand", p.brand.name)
        assertEquals("Independent brand", p.brandCategory)
        assertEquals("area", p.pinPrecision)
        assertEquals("UTC", p.timeZone)
    }

    @Test fun emptyOrMissingPlacesIsEmpty() {
        assertTrue(AroundPlacesResponse.decode("{}").places.isEmpty())
        assertTrue(AroundPlacesResponse.decode("""{"places":[],"scope":"world"}""").places.isEmpty())
    }

    @Test fun detailDecodesFlatDto() {
        val d = AroundPlaceDetailResponse.decode(AroundJson.detail).place
        assertEquals("loc_lagos_thread_ikoyi", d.summary.id)
        assertEquals("12 Bourdillon Road", d.addressLine)
        assertEquals("Late opening on Fridays.", d.hoursNote)
        assertTrue(d.description!!.startsWith("Our flagship"))
        assertEquals(1, d.images.size) // the empty src is dropped
        assertEquals(2, d.events.size)
        val drop = d.events[0]
        assertEquals(AroundEventKind.DropLaunch, drop.kind)
        assertEquals("drop-07", drop.drop?.slug)
        assertEquals("10% off in store on launch day", drop.promoText)
        assertEquals(AroundEventKind.Other, d.events[1].kind)
        assertEquals("Event", d.events[1].kind.label)
        assertNull(d.events[1].drop)
        val piece = d.featured.single()
        assertEquals("third-mainland-tee", piece.slug)
        assertEquals(4500, piece.price?.amount)
        assertEquals("USD", piece.price?.currency)
        assertTrue(piece.imageUrl!!.endsWith("/api/media/med_9"))
    }

    @Test fun kindAndEventLabels() {
        assertEquals("Pop-up", AroundPlaceKind.Popup.label)
        assertEquals("Exhibitions", AroundPlaceKind.Exhibition.plural)
        assertFalse(AroundPlaceKind.Showroom.isDated)
        assertEquals("Drop launch", AroundEventKind.DropLaunch.label)
        assertEquals("Pop-up day", AroundEventKind.PopupDay.label)
    }

    @Test fun countryNames() {
        assertEquals("Nigeria", AroundCountry.name("NG"))
        assertEquals("ZZ", AroundCountry.name("ZZ"))
    }

    @Test fun coordinateDistanceAndRegions() {
        val lagos = AroundCoordinate(6.4541, 3.4339)
        val london = AroundCoordinate(51.5074, -0.1278)
        assertEquals(5_000_000.0, lagos.distanceTo(london), 100_000.0)
        assertEquals(0.0, lagos.distanceTo(lagos), 1e-6)
        val r = AroundRegion.around(lagos, 20_000.0)
        assertEquals(0.18, r.latitudeDelta, 0.01)
        assertTrue(r.longitudeDelta >= r.latitudeDelta)
    }

    private fun <T> assertNotNullAnd(value: T?): T {
        assertNotNull(value)
        return value!!
    }
}
