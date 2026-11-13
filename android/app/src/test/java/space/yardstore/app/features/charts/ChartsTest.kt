package space.yardstore.app.features.charts

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.CookieJar
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import space.yardstore.app.app.Route
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import java.time.Instant

// Realistic JSON, shaped like src/lib/api/contracts/charts.ts (chartBoardDto / chartScopesDto).

private fun brandJson(id: String, name: String, handle: String, city: String = "Lagos") = """
  {"id":"$id","handle":"$handle","name":"$name","mark":{"text":"${name.take(2).uppercase()}","style":"condensed"},
   "verified":true,"city":"$city","country":"NG","countryName":"Nigeria","category":"Streetwear",
   "cover":{"src":"/api/media/med_$id","alt":"$name cover"}}
"""

private fun entryJson(rank: Int, prev: Int?, movement: String, delta: Int, id: String, name: String) = """
  {"rank":$rank,"prevRank":${prev ?: "null"},"movement":"$movement","delta":$delta,"peak":$rank,"editionsOnChart":3,
   "subject":{"type":"brand","id":"$id"},"brand":${brandJson(id, name, name.lowercase().replace(" ", "-"))},
   "stat":{"label":"${rank * 10} new followers","figure":"+${rank * 10}","caption":"new followers","value":${rank * 10}},
   "history":[null,5,4,$rank]}
"""

private val BOARD_JSON = """
{"chart":"top","period":"weekly","scope":{"key":"global"},"state":"ok",
 "edition":{"date":"2026-11-13","status":"live","computedAt":"2026-11-13T10:00:00.000Z",
            "window":{"from":"2026-11-07","to":"2026-11-13"},"nextRefreshAt":"2026-11-13T10:05:00.000Z"},
 "cohortSize":12,
 "entries":[
   ${entryJson(1, 3, "up", 2, "brd_1", "Acme Studio")},
   ${entryJson(2, 1, "down", -1, "brd_2", "Lagos Thread")},
   ${entryJson(3, null, "new", 0, "brd_3", "Night Shift")},
   ${entryJson(4, 4, "same", 0, "brd_4", "Ore Works")},
   {"rank":"broken","brand":"not an object"},
   ${entryJson(5, 9, "up", 4, "brd_5", "Kiln")}
 ],
 "sponsored":[{"kind":"drop","brand":${brandJson("brd_9", "Halfmoon", "halfmoon")},
               "drop":{"id":"drp_1","slug":"winter-capsule","name":"Winter Capsule","image":{"src":"/api/media/med_d1","alt":""},"status":"upcoming"}}],
 "callouts":{"biggestClimber":${entryJson(5, 9, "up", 4, "brd_5", "Kiln")}},
 "sample":true}
"""

private val SCOPES_JSON = """
{"cities":[{"slug":"lagos","name":"Lagos","country":"NG","eligible":6,"byCategory":{"streetwear":4}},
           {"slug":"accra","name":"Accra","country":"GH","eligible":2,"byCategory":{"streetwear":1}},
           {"slug":"abuja","name":"Abuja","country":"NG","eligible":9,"byCategory":{}}],
 "countries":[{"code":"GH","name":"Ghana","eligible":2,"byCategory":{"streetwear":1}},
              {"code":"NG","name":"Nigeria","eligible":15,"byCategory":{"streetwear":5}}],
 "categories":[{"slug":"streetwear","label":"Streetwear","eligible":6},{"slug":"bags","label":"Bags","eligible":1}],
 "minCohort":3}
"""

class ChartsDecodingTest {
    @Test fun decodesBoardAndDropsBadEntries() {
        val b = YardJson.decodeFromString<ChartBoard>(BOARD_JSON)
        assertEquals(ChartSlug.Top, b.chart)
        assertEquals(ChartPeriod.Weekly, b.period)
        assertEquals(ChartBoardState.Ok, b.state)
        assertEquals(5, b.entries.size) // the malformed entry is dropped, not the board
        assertEquals(listOf(1, 2, 3, 4, 5), b.entries.map { it.rank })
        val first = b.entries.first()
        assertEquals(ChartMovement.Up, first.movement)
        assertEquals(3, first.prevRank)
        assertEquals("+10", first.stat.figure)
        assertEquals("brand:brd_1", first.id)
        assertEquals("Streetwear, Lagos", first.brand.originText)
        assertTrue(first.brand.cover!!.url!!.endsWith("/api/media/med_brd_1"))
        assertNull(b.entries[2].prevRank)
        assertTrue(b.edition!!.isLive)
        assertEquals("global", b.scope.key)
        assertEquals(1, b.sponsored.size)
        assertEquals("d:drp_1", b.sponsored[0].id)
        assertEquals(Route.Drop(id = "winter-capsule"), b.sponsored[0].route)
        assertEquals("Upcoming", b.sponsored[0].drop!!.statusLabel)
        assertEquals(5, b.callouts.biggestClimber!!.rank)
        assertNull(b.callouts.highestDebut)
        assertNull(b.fallback)
    }

    @Test fun lenientDefaultsForMissingAndUnknownValues() {
        val b = YardJson.decodeFromString<ChartBoard>(
            """{"chart":"mystery","period":"hourly","state":"???","scope":"oops","edition":null,"callouts":5,
               "entries":[{"rank":7,"movement":"sideways","brand":{"id":"brd_7"}}]}""",
        )
        assertEquals(ChartSlug.Top, b.chart)
        assertEquals(ChartPeriod.Weekly, b.period)
        assertEquals(ChartBoardState.Ok, b.state)
        assertNull(b.scope.key)
        assertNull(b.edition)
        assertNull(b.callouts.biggestClimber)
        val e = b.entries.single()
        assertEquals(ChartMovement.Same, e.movement)
        assertEquals(7, e.peak) // peak falls back to rank
        assertEquals(1, e.editionsOnChart)
        assertEquals(ChartSubject("brand", "brd_7"), e.subject)
        assertEquals("", e.stat.label)
        assertEquals(Route.Brand(handle = ""), e.route)
    }

    @Test fun decodesSmallCohortWithFallback() {
        val b = YardJson.decodeFromString<ChartBoard>(
            """{"chart":"city","period":"daily","scope":{"key":"city:accra","city":{"slug":"accra","name":"Accra","country":"GH"}},
               "state":"small_cohort","edition":null,"cohortSize":2,"entries":[],"sponsored":[],"callouts":{},
               "fallback":{"country":{"code":"GH","name":"Ghana","eligible":2},"nearestCity":{"slug":"lagos","name":"Lagos","eligible":6}},"sample":true}""",
        )
        assertEquals(ChartSlug.City, b.chart)
        assertEquals(ChartBoardState.SmallCohort, b.state)
        assertEquals("Accra", b.scope.city!!.name)
        assertEquals(6, b.fallback!!.nearestCity!!.eligible)
        assertEquals("GH", b.fallback!!.country!!.code)
    }

    @Test fun decodesScopes() {
        val s = YardJson.decodeFromString<ChartScopes>(SCOPES_JSON)
        assertEquals(3, s.cities.size)
        assertEquals(4, s.cities[0].byCategory["streetwear"])
        assertEquals("Nigeria", s.countries[1].name)
        assertEquals("Bags", s.categories[1].label)
        assertEquals(3, s.minCohort)
    }

    @Test fun dropEntryRoutesToDropSlugOrId() {
        val e = ChartsPreviewData.entry(4, "X", ChartMovement.Same, 0, 4)
        assertEquals(Route.Brand(handle = "brand4"), e.route)
        val withDrop = e.copy(drop = ChartDrop(id = "drp_9", slug = "", name = "Capsule", status = "sold_out"))
        assertEquals(Route.Drop(id = "drp_9"), withDrop.route)
        assertEquals("Capsule", withDrop.title)
        assertEquals("Sold out", withDrop.drop!!.statusLabel)
    }
}

class ChartsFormatTest {
    private val edition = ChartEditionInfo("2026-11-06", "live", "2026-11-06T10:00:00.000Z", ChartEditionInfo.Window("2026-10-31", "2026-11-06"))

    @Test fun editionText() {
        assertEquals("Weekly edition, 31 Oct – 6 Nov", ChartsFormat.editionText(edition, ChartPeriod.Weekly))
        assertEquals("Daily edition, 6 Nov", ChartsFormat.editionText(edition, ChartPeriod.Daily))
        assertEquals("Monthly edition, 31 Oct – 6 Nov", ChartsFormat.editionText(edition, ChartPeriod.Monthly))
        val final = edition.copy(status = "final")
        assertEquals("Week of 31 Oct", ChartsFormat.editionText(final, ChartPeriod.Weekly))
        assertEquals("Edition of 6 Nov", ChartsFormat.editionText(final, ChartPeriod.Daily))
        assertEquals("Month to 6 Nov", ChartsFormat.editionText(final, ChartPeriod.Monthly))
    }

    @Test fun updatedAgo() {
        val at = Instant.parse("2026-11-06T10:00:00Z")
        assertEquals("just now", ChartsFormat.updatedAgo("2026-11-06T10:00:00.000Z", at.plusSeconds(30)))
        assertEquals("2 min ago", ChartsFormat.updatedAgo("2026-11-06T10:00:00.000Z", at.plusSeconds(120)))
        assertEquals("2 h ago", ChartsFormat.updatedAgo("2026-11-06T10:00:00.000Z", at.plusSeconds(7200)))
        assertNull(ChartsFormat.updatedAgo("nonsense", at))
    }

    @Test fun smallHelpers() {
        assertEquals("04", ChartsFormat.two(4))
        assertEquals("12", ChartsFormat.two(12))
        assertEquals("1 brand", ChartsFormat.brands(1))
        assertEquals("3 brands", ChartsFormat.brands(3))
        assertEquals("1 wk", ChartPeriod.Weekly.unit(1))
        assertEquals("6 mos", ChartPeriod.Monthly.unit(6))
        assertEquals("down 2 places", ChartMovement.Down.words(-2))
        assertEquals("up 1 place", ChartMovement.Up.words(1))
    }

    @Test fun entryTexts() {
        val up = ChartsPreviewData.entry(5, "Kiln", ChartMovement.Up, 4, 9)
        assertEquals("Last week #9", up.previousText(ChartPeriod.Weekly))
        assertEquals(
            "Kiln. Rank 5, up 4 places, last week 9, peak 4, 4 wks on chart. 200 new followers.",
            up.accessibilityText(ChartPeriod.Weekly),
        )
        val new = ChartsPreviewData.entry(3, "Night Shift", ChartMovement.New, 0, null)
        assertEquals("New today", new.previousText(ChartPeriod.Daily))
        assertEquals("Night Shift. Rank 3, new entry. 120 new followers.", new.accessibilityText(ChartPeriod.Daily))
        assertEquals("Back on the chart", ChartsPreviewData.entry(6, "H", ChartMovement.Reentry, 0, null).previousText(ChartPeriod.Weekly))
        assertNull(chartsOffPodium(ChartsPreviewData.entry(3, "P", ChartMovement.Up, 1, 4)))
        assertNotNull(chartsOffPodium(up))
    }
}

class ChartsQueryTest {
    @Test fun queryItemsInWebsiteOrder() {
        assertEquals(listOf("chart" to "top", "period" to "weekly"), ChartsQuery().queryItems)
        assertEquals(
            listOf("chart" to "most-followed", "period" to "daily", "category" to "bags", "city" to "lagos"),
            ChartsQuery(ChartSlug.MostFollowed, ChartPeriod.Daily, category = "bags", country = "NG", city = "lagos").queryItems,
        )
        assertEquals(
            listOf("chart" to "top", "period" to "weekly", "country" to "NG"),
            ChartsQuery(country = "NG").queryItems,
        )
    }

    @Test fun filterCountIgnoresCityChartsCity() {
        assertEquals(0, ChartsQuery().filterCount)
        assertEquals(2, ChartsQuery(category = "bags", country = "NG").filterCount)
        assertEquals(1, ChartsQuery(chart = ChartSlug.City, city = "lagos", category = "bags").filterCount)
    }

    @Test fun filterOptions() {
        val scopes = ChartsFiltersPreview.scopes
        val all = ChartsFilterOptions(ChartsQuery(), scopes, null)
        assertEquals("all", all.locationValue)
        // Accra (2 < minCohort) isn't listed; Ghana is listed but disabled.
        assertEquals(
            listOf("all", "country:GH", "country:NG", "city:lagos"),
            all.location.map { it.value },
        )
        assertTrue(all.location.first { it.value == "country:GH" }.disabled)
        assertEquals("Nigeria · 7 brands", all.location.first { it.value == "country:NG" }.label)
        assertEquals(listOf("all", "streetwear", "bags"), all.category.map { it.value })
        assertTrue(all.category.first { it.value == "bags" }.disabled)

        val city = ChartsFilterOptions(ChartsQuery(chart = ChartSlug.City), scopes, ChartsResolvedCity("lagos", "Lagos"))
        assertEquals("city:lagos", city.locationValue)
        assertEquals(listOf("city:lagos"), city.location.map { it.value })
        val applied = city.applyLocation("country:NG")
        assertEquals("NG", applied.country)
        assertNull(applied.city)
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class ChartsViewModelTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient

    @Before fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server = MockWebServer()
        server.start()
        // Relative API paths resolve against Config.baseUrl; send them to the mock server instead.
        val http = APIClient.buildHttpClient(CookieJar.NO_COOKIES).newBuilder()
            .addInterceptor { chain ->
                val r = chain.request()
                val target = r.url.newBuilder().scheme("http").host(server.hostName).port(server.port).build()
                chain.proceed(r.newBuilder().url(target).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    @Test fun loadsBoardThenCountsAndWords() = runTest {
        server.enqueue(MockResponse().setBody(BOARD_JSON))
        val vm = ChartsViewModel(api = api)
        assertNull(vm.currentBoard)
        vm.load()
        val req = server.takeRequest()
        assertEquals("/api/charts?chart=top&period=weekly", req.path)
        assertFalse(vm.isLoading)
        assertNull(vm.error)
        assertEquals(5, vm.currentBoard!!.entries.size)
        assertEquals("Everywhere", vm.whereWords())
        assertEquals("Everywhere", vm.locationTitle)
    }

    @Test fun errorWhenNoBoardYet_rateLimit() = runTest {
        server.enqueue(MockResponse().setResponseCode(429).setBody("""{"error":{"code":"rate_limited","message":"Too many requests."}}"""))
        val vm = ChartsViewModel(api = api)
        vm.load()
        val e = vm.error as APIError
        assertTrue(e.isRateLimited)
        assertNull(vm.currentBoard)
        assertFalse(vm.isLoading)
    }

    @Test fun failedRefreshKeepsBoard() = runTest {
        server.enqueue(MockResponse().setBody(BOARD_JSON))
        server.enqueue(MockResponse().setResponseCode(500).setBody("""{"error":{"code":"internal","message":"Something went wrong."}}"""))
        val vm = ChartsViewModel(api = api)
        vm.load()
        vm.load()
        assertNotNull(vm.currentBoard)
        assertTrue(vm.refreshFailed)
        assertNull(vm.error)
        server.enqueue(MockResponse().setBody(BOARD_JSON))
        vm.load()
        assertFalse(vm.refreshFailed)
    }

    @Test fun applyingNewQueryHidesOldBoardAndCityDropsCountry() = runTest {
        server.enqueue(MockResponse().setBody(BOARD_JSON))
        val vm = ChartsViewModel(api = api)
        vm.load()
        server.takeRequest()
        vm.apply(vm.query.copy(chart = ChartSlug.City, country = "NG"))
        assertNull(vm.query.country)
        assertNull(vm.currentBoard) // never the previous board under the new name
        assertEquals("Choose a city", vm.locationTitle)
        assertNull(vm.whereWords())
    }

    @Test fun scopesAndDefaultCity() = runTest {
        server.enqueue(MockResponse().setBody(SCOPES_JSON))
        val vm = ChartsViewModel(ChartsQuery(chart = ChartSlug.City), api = api)
        vm.loadScopes()
        assertEquals("/api/charts/scopes", server.takeRequest().path)
        assertEquals(3, vm.scopes!!.cities.size)

        vm.resolveDefaultCity(shipToCity = " lágos ", shipToCountry = null)
        assertEquals("lagos", vm.defaultCity)
        assertEquals("lagos", vm.effectiveQuery.city)

        vm.resolveDefaultCity(shipToCity = "Kano", shipToCountry = "ng")
        assertEquals("abuja", vm.defaultCity) // largest charted city in the ship-to country

        vm.resolveDefaultCity(shipToCity = null, shipToCountry = "GH")
        assertNull(vm.defaultCity) // Accra is under minCohort

        server.enqueue(MockResponse().setBody(BOARD_JSON.replace("\"chart\":\"top\"", "\"chart\":\"city\"")))
        vm.resolveDefaultCity("Lagos", null)
        vm.load()
        assertEquals("/api/charts?chart=city&period=weekly&city=lagos", server.takeRequest().path)
        assertEquals("Lagos", vm.locationTitle)
    }

    @Test fun scopesFailureIsQuiet() = runTest {
        server.enqueue(MockResponse().setResponseCode(500))
        val vm = ChartsViewModel(api = api)
        vm.loadScopes()
        assertNull(vm.scopes)
        vm.resolveDefaultCity("Lagos", "NG")
        assertNull(vm.defaultCity)
    }
}
