package space.yardstore.app.features.around

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import java.time.Instant
import kotlin.math.abs

/** The Kotlin ⇄ globe page messages and the camera maths (AroundGlobeBridge). */
class AroundGlobeBridgeTest {
    private val places = AroundPlacesResponse.decode(AroundJson.places).places
    private val store = places.first { it.kind == AroundPlaceKind.Store }
    private val popup = places.first { it.kind == AroundPlaceKind.Popup }
    private val now: Instant = Instant.parse("2026-11-14T12:00:00Z")

    private fun obj(raw: String): JsonObject = YardJson.parseToJsonElement(raw).jsonObject

    // region Kotlin → JS

    @Test fun placesMessageEncodesEveryPin() {
        val msg = obj(AroundGlobeBridge.placesMessage(places, { if (it.id == store.id) "/api/media/logo_1" else null }, now))
        assertEquals("places", msg["type"]!!.jsonPrimitive.content)
        val pins = msg["places"] as JsonArray
        assertEquals(places.size, pins.size)
        val pin = pins.first { it.jsonObject["id"]!!.jsonPrimitive.content == store.id }.jsonObject
        assertEquals(store.lat, pin["lat"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(store.lng, pin["lng"]!!.jsonPrimitive.double, 1e-9)
        assertEquals("Lagos Thread", pin["brand"]!!.jsonPrimitive.content)
        assertEquals("LA", pin["mark"]!!.jsonPrimitive.content)
        assertEquals("https://yardstore.space/api/media/logo_1", pin["logo"]!!.jsonPrimitive.content)
        assertEquals("Store", pin["kind"]!!.jsonPrimitive.content)
        assertEquals("Ikoyi", pin["area"]!!.jsonPrimitive.content)
        assertEquals("store", pin["status"]!!.jsonPrimitive.content)
        assertFalse(pin["sample"]!!.jsonPrimitive.boolean)
        val other = pins.first { it.jsonObject["id"]!!.jsonPrimitive.content != store.id }.jsonObject
        assertEquals(JsonNull, other["logo"])
    }

    @Test fun placesMessageEscapesNamesSafely() {
        val tricky = store.copy(id = "loc_x", brand = store.brand.copy(name = "Quote \" </script>   Brand"))
        val raw = AroundGlobeBridge.placesMessage(listOf(tricky), { null }, now)
        val pin = obj(raw)["places"]!!.jsonArray[0].jsonObject
        assertEquals("Quote \" </script>   Brand", pin["brand"]!!.jsonPrimitive.content)
        assertTrue(AroundGlobeBridge.script(raw).startsWith("window.yardGlobe&&window.yardGlobe.receive({"))
    }

    @Test fun pinStatusFollowsKindAndDates() {
        assertEquals("store", AroundGlobeBridge.pinStatus(store, now))
        assertEquals("showroom", AroundGlobeBridge.pinStatus(store.copy(kind = AroundPlaceKind.Showroom), now))
        val live = popup.copy(startsAt = "2026-11-01T10:00:00.000Z", endsAt = "2026-12-01T18:00:00.000Z")
        assertEquals("live", AroundGlobeBridge.pinStatus(live, now))
        val upcoming = popup.copy(startsAt = "2027-01-01T10:00:00.000Z", endsAt = "2027-01-05T18:00:00.000Z")
        assertEquals("upcoming", AroundGlobeBridge.pinStatus(upcoming, now))
    }

    @Test fun selectFlyToAndYouMessages() {
        assertEquals("loc_1", obj(AroundGlobeBridge.selectMessage("loc_1"))["id"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, obj(AroundGlobeBridge.selectMessage(null))["id"])

        val fly = obj(AroundGlobeBridge.flyToMessage(AroundGlobeCamera(6.45, 3.43, 12.5), animate = true))
        assertEquals("flyTo", fly["type"]!!.jsonPrimitive.content)
        assertEquals(6.45, fly["lat"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(3.43, fly["lng"]!!.jsonPrimitive.double, 1e-9)
        assertEquals(12.5, fly["zoom"]!!.jsonPrimitive.double, 1e-9)
        assertTrue(fly["animate"]!!.jsonPrimitive.boolean)

        val you = obj(AroundGlobeBridge.youMessage(AroundCoordinate(51.5, -0.1)))
        assertEquals(51.5, you["lat"]!!.jsonPrimitive.double, 1e-9)
        val none = obj(AroundGlobeBridge.youMessage(null))
        assertEquals(setOf("type"), none.keys)
    }

    // endregion

    // region JS → Kotlin

    @Test fun parsesPageMessages() {
        assertEquals(AroundGlobeEvent.Ready, AroundGlobeBridge.parse("""{"type":"ready"}"""))
        assertEquals(AroundGlobeEvent.PlaceTapped("loc_9"), AroundGlobeBridge.parse("""{"type":"placeTapped","id":"loc_9"}"""))
        assertEquals(AroundGlobeEvent.Streets(true), AroundGlobeBridge.parse("""{"type":"streets","state":"ready"}"""))
        assertEquals(AroundGlobeEvent.Streets(false), AroundGlobeBridge.parse("""{"type":"streets","state":"failed"}"""))
        assertEquals(AroundGlobeEvent.Fallback("webgl"), AroundGlobeBridge.parse("""{"type":"fallback","reason":"webgl"}"""))

        val idle = AroundGlobeBridge.parse(
            """{"type":"cameraIdle","lat":6.5,"lng":3.4,"zoom":10.4,"west":3.1,"south":6.3,"east":3.7,"north":6.7,"user":true}""",
        ) as AroundGlobeEvent.CameraIdle
        assertEquals(AroundGlobeCamera(6.5, 3.4, 10.4), idle.camera)
        assertEquals(AroundGlobeBounds(3.1, 6.3, 3.7, 6.7), idle.bounds)
        assertTrue(idle.user)
    }

    @Test fun ignoresMalformedMessages() {
        assertNull(AroundGlobeBridge.parse("not json"))
        assertNull(AroundGlobeBridge.parse("[1,2]"))
        assertNull(AroundGlobeBridge.parse("""{"type":"somethingNew"}"""))
        assertNull(AroundGlobeBridge.parse("""{"type":"placeTapped"}"""))
        assertNull(AroundGlobeBridge.parse("""{"type":"placeTapped","id":""}"""))
        assertNull(AroundGlobeBridge.parse("""{"type":"cameraIdle","lat":6.5,"lng":3.4,"zoom":10}"""))
        assertNull(AroundGlobeBridge.parse("""{"type":"cameraIdle","lat":"x","lng":3.4,"zoom":10,"west":0,"south":0,"east":1,"north":1}"""))
        // A missing "user" means the camera moved on its own.
        val idle = AroundGlobeBridge.parse("""{"type":"cameraIdle","lat":0,"lng":0,"zoom":5,"west":-1,"south":-1,"east":1,"north":1}""") as AroundGlobeEvent.CameraIdle
        assertFalse(idle.user)
    }

    // endregion

    // region Camera mapping

    @Test fun wholeGlobeCountsAsTheWorld() {
        val r = AroundGlobeBridge.regionFor(AroundGlobeCamera(12.0, 15.0, 1.6), AroundGlobeBounds(-60.0, -70.0, 90.0, 85.0))
        assertEquals(180.0, r.latitudeDelta, 1e-9)
        assertEquals(360.0, r.longitudeDelta, 1e-9)
        // Every place, on either side of the globe, is in view for the list.
        assertTrue(places.all { AroundViewModel.contains(r, it.coordinate) })
    }

    @Test fun closeCameraUsesVisibleBounds() {
        val r = AroundGlobeBridge.regionFor(AroundGlobeCamera(6.5, 3.4, 10.0), AroundGlobeBounds(3.1, 6.3, 3.7, 6.7))
        assertEquals(6.5, r.center.latitude, 1e-9)
        assertEquals(0.4, r.latitudeDelta, 1e-9)
        assertEquals(0.6, r.longitudeDelta, 1e-9)
        // Across the antimeridian west > east.
        val fiji = AroundGlobeBridge.regionFor(AroundGlobeCamera(-17.0, 179.5, 6.0), AroundGlobeBounds(178.0, -19.0, -179.0, -15.0))
        assertEquals(3.0, fiji.longitudeDelta, 1e-9)
    }

    @Test fun cameraForRegionMatchesWebsiteFit() {
        // A 0.4° × 0.4° box around Lagos in a 390 × 600 dp map.
        val region = AroundRegion(AroundCoordinate(6.5, 3.4), 0.4, 0.4)
        val cam = AroundGlobeBridge.cameraFor(region, 390.0, 600.0)
        assertEquals(6.5, cam.latitude, 1e-9)
        assertEquals(3.4, cam.longitude, 1e-9)
        // log2(390·360 / (512·0.4)) ≈ 9.41 (the narrower side), floored to 0.05.
        assertEquals(9.4, cam.zoom, 1e-9)
        // Half the span is one zoom level closer.
        val closer = AroundGlobeBridge.cameraFor(region.copy(latitudeDelta = 0.2, longitudeDelta = 0.2), 390.0, 600.0)
        assertTrue(abs(closer.zoom - cam.zoom - 1.0) <= 0.05)
    }

    @Test fun cameraForClampsAndOpensOnTheGlobe() {
        val tiny = AroundGlobeBridge.cameraFor(AroundRegion(AroundCoordinate(0.0, 0.0), 1e-7, 1e-7), 390.0, 600.0)
        assertEquals(AroundGlobeBridge.MAX_ZOOM, tiny.zoom, 1e-9)
        val world = AroundGlobeBridge.cameraFor(AroundRegion(AroundCoordinate(20.0, 0.0), 140.0, 340.0), 390.0, 600.0)
        assertEquals(1.6, world.zoom, 1e-9)
        val wide = AroundGlobeBridge.cameraFor(AroundRegion(AroundCoordinate(20.0, 0.0), 140.0, 340.0), 1000.0, 800.0, wide = true)
        assertEquals(2.1, wide.zoom, 1e-9)
        assertEquals(AroundGlobeCamera(12.0, 15.0, 1.6), AroundGlobeBridge.globeCamera(wide = false))
        // Unknown size: a phone-sized default rather than a division by zero.
        val unsized = AroundGlobeBridge.cameraFor(AroundRegion(AroundCoordinate(6.5, 3.4), 0.4, 0.4), 0.0, 0.0)
        assertTrue(unsized.zoom in AroundGlobeBridge.MIN_ZOOM..AroundGlobeBridge.MAX_ZOOM)
    }

    // endregion
}
