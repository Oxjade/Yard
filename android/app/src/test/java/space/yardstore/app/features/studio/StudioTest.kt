package space.yardstore.app.features.studio

import kotlinx.coroutines.runBlocking
import okhttp3.CookieJar
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import space.yardstore.app.core.models.Session
import space.yardstore.app.core.models.Shopper
import space.yardstore.app.core.models.ShopperBrand
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.networking.APIError
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.designsystem.components.SlideToCompleteMath
import space.yardstore.app.features.sell.SellRules
import space.yardstore.app.features.sell.SellStep
import space.yardstore.app.features.sell.YouSellerState
import java.util.Locale

private const val SESSION_JSON = """
{ "shopper": { "id": "u_1", "name": "Ada Nwosu", "email": "ada@example.com", "status": "active", "demo": false, "photoSrc": null,
    "brands": [
      { "id": "b_1", "handle": "kachi-studio", "name": "Kachi Studio", "logoSrc": "/api/media/med_1?as=brand", "initials": "KS",
        "role": "owner", "status": "approved", "canOpenStudio": true },
      { "id": "b_2", "handle": "night", "name": "Night Shift", "logoSrc": null, "initials": "NS",
        "role": "fulfilment", "status": "suspended", "canOpenStudio": false },
      { "id": "b_3", "handle": "new", "name": "New Shop", "logoSrc": null, "initials": "",
        "role": "owner", "status": "pending_review", "canOpenStudio": true }
    ] },
  "brand": { "userId": "u_1", "name": "Ada", "brand": { "id": "b_1", "handle": "kachi-studio", "name": "Kachi Studio", "reviewStatus": "verified", "logoSrc": null },
    "role": "owner", "permissions": ["orders.fulfil", "content.publish", "inbox.read"], "demo": false, "photoSrc": null },
  "admin": null, "demoAuth": {}, "sampleData": false }
"""

class StudioSessionParsingTest {
    @Test fun decodesShopperBrands() {
        val s = YardJson.decodeFromString(Session.serializer(), SESSION_JSON)
        val brands = s.shopper!!.brands
        assertEquals(3, brands.size)
        assertEquals("kachi-studio", brands[0].handle)
        assertEquals("/api/media/med_1?as=brand", brands[0].logoSrc)
        assertTrue(brands[0].isLive)
        assertTrue(brands[1].isSuspended)
        assertTrue(brands[2].isPendingReview)
        assertEquals("KS", brands[0].mark)
        // Missing initials fall back to the name.
        assertEquals("NS", brands[2].mark)
        assertEquals(listOf("b_1", "b_3"), s.shopper!!.studioBrands.map { it.id })
        val profile = s.brand!!
        assertTrue(profile.can("orders.fulfil"))
        assertFalse(profile.can("inbox.reply"))
        assertTrue(profile.seesPayouts)
        assertTrue(profile.canRefund)
    }

    @Test fun missingBrandsIsEmpty() {
        val s = YardJson.decodeFromString(Session.serializer(), """{ "shopper": { "id": "u_2", "name": "Bo" } }""")
        assertEquals(emptyList<ShopperBrand>(), s.shopper!!.brands)
    }
}

class StudioModeRulesTest {
    private val live = ShopperBrand(id = "b_1", name = "One", status = "approved", canOpenStudio = true)
    private val suspended = ShopperBrand(id = "b_2", name = "Two", status = "suspended", canOpenStudio = false)
    private val pending = ShopperBrand(id = "b_3", name = "Three", status = "pending_review", canOpenStudio = true)

    @Test fun opensStudioByDefaultForMembers() {
        assertEquals(AppMode.Studio, StudioModeRules.initialMode(listOf(live), lastMode = null))
        assertEquals(AppMode.Shopping, StudioModeRules.initialMode(listOf(live), lastMode = AppMode.Shopping))
        assertEquals(AppMode.Studio, StudioModeRules.initialMode(listOf(live), lastMode = AppMode.Studio))
    }

    @Test fun shoppersAndSuspendedBrandsStayShopping() {
        assertEquals(AppMode.Shopping, StudioModeRules.initialMode(emptyList(), lastMode = AppMode.Studio))
        assertEquals(AppMode.Shopping, StudioModeRules.initialMode(listOf(suspended), lastMode = null))
    }

    @Test fun picksRememberedBrandThenFirstOpenable() {
        assertEquals("b_3", StudioModeRules.pickBrand(listOf(suspended, live, pending), "b_3")?.id)
        assertEquals("b_1", StudioModeRules.pickBrand(listOf(suspended, live, pending), "b_2")?.id)
        assertEquals("b_1", StudioModeRules.pickBrand(listOf(suspended, live, pending), null)?.id)
        assertNull(StudioModeRules.pickBrand(listOf(suspended), null))
    }

    @Test fun roleChoiceOnlyForNewShoppers() {
        val shopper = Shopper(id = "u_1", name = "Ada")
        assertTrue(StudioModeRules.needsRoleChoice(shopper, answered = false))
        assertFalse(StudioModeRules.needsRoleChoice(shopper, answered = true))
        assertFalse(StudioModeRules.needsRoleChoice(shopper.copy(demo = true), answered = false))
        assertFalse(StudioModeRules.needsRoleChoice(shopper.copy(brands = listOf(pending)), answered = false))
        assertFalse(StudioModeRules.needsRoleChoice(null, answered = false))
    }

    @Test fun prefsRememberPerAccount() {
        val prefs = StudioPrefs { null }
        assertNull(prefs.roleChoice("u_1"))
        prefs.setRoleChoice("u_1", "sell")
        assertEquals("sell", prefs.roleChoice("u_1"))
        assertNull(prefs.roleChoice("u_2"))
        prefs.lastMode = AppMode.Shopping
        assertEquals(AppMode.Shopping, prefs.lastMode)
    }
}

/** The brand session: switch before Studio calls, re-switch and retry once on 401. */
class StudioStoreTest {
    private lateinit var server: MockWebServer
    private lateinit var api: APIClient
    private val switches = mutableListOf<String>()
    private var dashboardFailuresLeft = 0
    private var switchStatus = 200

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.requestUrl!!.encodedPath
                return when (path) {
                    "/api/session" -> json(SESSION_JSON)
                    "/api/studio/session/switch" -> {
                        val body = request.body.readUtf8()
                        switches += body
                        if (switchStatus != 200) {
                            json("""{"error":{"code":"unauthorized","message":"Sign in."}}""", switchStatus)
                        } else {
                            json("""{"actor":"brand","profile":{"userId":"u_1","name":"Ada","brand":{"id":"b_1","handle":"kachi-studio","name":"Kachi Studio"},"role":"owner","permissions":["orders.fulfil"]}}""")
                        }
                    }
                    "/api/studio/dashboard" -> if (dashboardFailuresLeft > 0) {
                        dashboardFailuresLeft -= 1
                        json("""{"error":{"code":"unauthorized","message":"Sign in."}}""", 401)
                    } else {
                        json(DASHBOARD_JSON)
                    }
                    else -> json("""{"error":{"code":"not_found","message":"Not found."}}""", 404)
                }
            }
        }
        server.start()
        val base = server.url("/")
        val http = APIClient.buildHttpClient(CookieJar.NO_COOKIES).newBuilder()
            .addInterceptor { chain ->
                val original = chain.request()
                val rewritten = original.url.newBuilder().scheme(base.scheme).host(base.host).port(base.port).build()
                chain.proceed(original.newBuilder().url(rewritten).build())
            }
            .build()
        api = APIClient(http)
    }

    @After fun tearDown() = server.shutdown()

    private fun json(body: String, code: Int = 200) =
        MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private fun store(): StudioStore = runBlocking {
        val session = SessionStore(api)
        session.refresh()
        StudioStore(api, session, StudioPrefs { null }).also { it.sessionChanged() }
    }

    @Test fun switchesBeforeTheFirstStudioCallOnly() = runBlocking {
        val s = store()
        assertEquals(AppMode.Studio, s.mode)
        assertEquals("b_1", s.activeBrandId)
        s.dashboard(7)
        s.dashboard(7)
        assertEquals(1, switches.size)
        assertTrue(switches[0].contains("\"brandId\":\"b_1\""))
        assertEquals("owner", s.profile?.role)
    }

    @Test fun reswitchesAndRetriesOnceOn401() = runBlocking {
        val s = store()
        dashboardFailuresLeft = 1
        val d = s.dashboard(7)
        assertEquals("Kachi Studio", d.brand.name)
        assertEquals(2, switches.size)
    }

    @Test fun givesUpAfterTheRetry() = runBlocking {
        val s = store()
        dashboardFailuresLeft = 2
        try {
            s.dashboard(7)
            fail("expected 401")
        } catch (e: APIError) {
            assertEquals(401, e.status)
        }
        assertEquals(2, switches.size)
    }

    @Test fun brandChangeReswitches() = runBlocking {
        val s = store()
        s.dashboard(7)
        s.selectBrand("b_3")
        s.dashboard(7)
        assertEquals(2, switches.size)
        assertTrue(switches[1].contains("b_3"))
    }

    @Test fun switch401MeansSignedOut() = runBlocking {
        val s = store()
        switchStatus = 401
        try {
            s.dashboard(7)
            fail("expected StudioSignedOut")
        } catch (_: StudioSignedOut) {
        }
    }

    @Test fun leaveRemembersShopping() = runBlocking {
        val s = store()
        s.leave()
        assertEquals(AppMode.Shopping, s.mode)
        assertEquals(AppMode.Shopping, s.prefs.lastMode)
        s.enter("b_3")
        assertEquals(AppMode.Studio, s.mode)
        assertEquals("b_3", s.activeBrandId)
    }

    @Test fun linksWaitForTheSessionThenOpen() = runBlocking {
        val session = SessionStore(api)
        val s = StudioStore(api, session, StudioPrefs { null })
        s.openLink(StudioLink.Order("mo_1"), brandId = "b_3")
        assertEquals(AppMode.Shopping, s.mode)
        session.refresh()
        s.sessionChanged()
        s.resolvePendingLink()
        assertEquals(AppMode.Studio, s.mode)
        assertEquals("b_3", s.activeBrandId)
        assertEquals(StudioLink.Order("mo_1"), s.pendingLink)
    }
}

private const val DASHBOARD_JSON = """
{ "brand": { "id": "b_1", "handle": "kachi-studio", "name": "Kachi Studio", "currency": "NGN", "timeZone": "Africa/Lagos" },
  "sales": { "today": { "orders": 1, "grossMinor": 300000, "refundedMinor": 0, "netMinor": 300000 },
             "week": { "orders": 4, "grossMinor": 1200000, "refundedMinor": 100000, "netMinor": 1100000 },
             "month": { "orders": 9, "grossMinor": 2700000, "refundedMinor": 100000, "netMinor": 2600000 } },
  "series": { "days": 7, "points": [
    { "date": "2026-11-15", "orders": 0, "grossMinor": 0, "netMinor": 0 },
    { "date": "2026-11-16", "orders": 1, "grossMinor": 300000, "netMinor": 300000 },
    { "date": "2026-11-17", "orders": 0, "grossMinor": 0, "netMinor": 0 },
    { "date": "2026-11-18", "orders": 1, "grossMinor": 200000, "netMinor": 100000 },
    { "date": "2026-11-19", "orders": 0, "grossMinor": 0, "netMinor": 0 },
    { "date": "2026-11-20", "orders": 1, "grossMinor": 400000, "netMinor": 400000 },
    { "date": "2026-11-21", "orders": 1, "grossMinor": 300000, "netMinor": 300000 } ] },
  "toShip": { "total": 3, "paid": 2, "processing": 1 },
  "lowStock": { "variants": 2, "products": 1, "threshold": 3 },
  "unreadMessages": null,
  "websitePieces": 5,
  "topProducts": [ { "productId": "p_1", "title": "Candle", "currency": "NGN", "units": 3, "revenueMinor": 900000, "image": { "src": "/api/media/med_2?as=brand", "alt": "" } },
                   { "productId": "p_2", "title": "Tray", "currency": "NGN", "units": 1, "revenueMinor": 200000, "image": null } ],
  "storeViews": { "today": 12, "week": 80, "month": 310 } }
"""

class StudioDashboardParsingTest {
    @Test fun decodesTheDashboard() {
        val d = YardJson.decodeFromString(StudioDashboard.serializer(), DASHBOARD_JSON)
        assertEquals("NGN", d.brand.currency)
        assertEquals(7, d.series.points.size)
        assertEquals("2026-11-21", d.series.points.last().date)
        assertEquals(1_100_000L, d.window(StudioRange.Week).netMinor)
        assertEquals(300_000L, d.window(StudioRange.Today).grossMinor)
        assertEquals(9, d.window(StudioRange.Month).orders)
        assertEquals(3, d.toShip.total)
        assertNull(d.unreadMessages)
        assertEquals(5, d.websitePieces)
        assertNull(d.topProducts[1].image)
        assertEquals(310, d.views(StudioRange.Month))
        assertEquals(30, StudioRange.Month.days)
    }

    @Test fun decodesOrderDetailWithFreeFormAddress() {
        val o = YardJson.decodeFromString(
            StudioOrderDetail.serializer(),
            """{ "id": "mo_1", "reference": "YD-1", "customerName": "Ada", "states": { "merchant": "processing" },
                 "lines": [ { "id": "l1", "title": "Candle", "qty": 2, "unitMinor": 4500, "variantLabel": "Large" } ],
                 "shipTo": { "name": "Ada", "line1": "1 Road", "city": "Lagos", "country": "NG", "extra": 5 },
                 "actions": { "canCancel": true } }""",
        )
        assertEquals("Lagos", o.shipToAddress?.city)
        assertEquals("Large", o.lines[0].variantLabel)
        assertEquals(1, StudioOrderStage.reached(o.merchant))
        assertTrue(o.actions.canCancel)
        assertEquals(-1, StudioOrderStage.reached("cancelled"))
        assertEquals(3, StudioOrderStage.reached("delivered"))
    }

    @Test fun ordersPagesMergeNewestFirst() {
        val a = StudioOrdersPage(listOf(StudioOrderSummary("o1", placedAt = "2026-11-20T10:00:00Z"), StudioOrderSummary("o3", placedAt = "2026-11-18T10:00:00Z")), "c1")
        val b = StudioOrdersPage(listOf(StudioOrderSummary("o2", placedAt = "2026-11-19T10:00:00Z")), null)
        val merged = StudioOrdersPageState.merge(emptyList(), listOf(a, b))
        assertEquals(listOf("o1", "o2", "o3"), merged.items.map { it.id })
        assertEquals(listOf("c1", null), merged.cursors)
        assertTrue(merged.hasMore)
        val again = StudioOrdersPageState.merge(merged.items, listOf(StudioOrdersPage(listOf(StudioOrderSummary("o1", placedAt = "2026-11-20T10:00:00Z")), null), StudioOrdersPage()))
        assertEquals(3, again.items.size)
        assertFalse(again.hasMore)
    }
}

class StudioSellRulesTest {
    @Test fun brandName() {
        assertEquals("Enter your shop's name.", SellRules.brandNameProblem(" a "))
        assertNull(SellRules.brandNameProblem("Kachi"))
        assertEquals("Keep it to 40 characters.", SellRules.brandNameProblem("x".repeat(41)))
    }

    @Test fun instagramAndWebsite() {
        assertEquals("kachi", SellRules.instagramHandleOf("@kachi"))
        assertEquals("kachi.studio", SellRules.instagramHandleOf("https://www.instagram.com/kachi.studio/"))
        assertNull(SellRules.instagramHandleOf("not a handle"))
        assertEquals("instagram" to "Add your Instagram or your website, so Yard can see what you sell.", SellRules.presenceProblem("", " "))
        assertEquals("instagram", SellRules.presenceProblem("bad handle!", "")?.first)
        assertEquals("website", SellRules.presenceProblem("", "nope")?.first)
        assertNull(SellRules.presenceProblem("", "kachi.com"))
        assertNull(SellRules.presenceProblem("@kachi", "https://kachi.studio"))
    }

    @Test fun categoryCityCountry() {
        assertEquals("Choose what you sell.", SellRules.categoryProblem(emptyList()))
        // The API takes one category: the first tapped.
        assertEquals("home", SellRules.primaryCategory(listOf("home", "beauty")))
        assertEquals("Enter your city.", SellRules.cityProblem("L"))
        assertNull(SellRules.cityProblem("Lagos"))
        assertEquals("Choose a country Yard sells in.", SellRules.countryProblem("BR"))
        assertNull(SellRules.countryProblem("NG"))
        assertEquals("NG", SellRules.defaultCountry(Locale("en", "NG")))
        assertNull(SellRules.defaultCountry(Locale("pt", "BR")))
        assertEquals("🇳🇬", SellRules.flag("NG"))
    }

    @Test fun bodyOmitsBlankOptionals() {
        val body = SellRules.body(" Kachi ", "", "kachi.com", "home", " Lagos ", "NG")
        val json = YardJson.encodeToString(StudioApplyBody.serializer(), body)
        assertEquals("""{"brandName":"Kachi","website":"kachi.com","category":"home","city":"Lagos","country":"NG"}""", json)
    }

    @Test fun serverFieldsMapToSteps() {
        assertEquals(SellStep.Name, SellRules.stepFor("brandName"))
        assertEquals(SellStep.Presence, SellRules.stepFor("website"))
        assertEquals(SellStep.Category, SellRules.stepFor("category"))
        assertEquals(SellStep.Location, SellRules.stepFor("country"))
    }

    @Test fun modelValidatesEachStep() {
        val m = space.yardstore.app.features.sell.SellApplicationModel(store = null, previewCategories = listOf(StudioCategory("home", "Home")), initialCountry = null)
        assertFalse(m.next())
        assertEquals(SellStep.Name, m.step)
        m.brandName = "Kachi"
        assertTrue(m.next())
        assertFalse(m.next())
        m.instagram = "@kachi"
        assertTrue(m.next())
        assertFalse(m.next())
        m.toggle("home")
        assertTrue(m.next())
        m.city = "Lagos"
        assertFalse(m.next()) // no country yet
        m.country = "NG"
        assertTrue(m.next())
        assertEquals(SellStep.Review, m.step)
        assertTrue(m.back())
        assertEquals(SellStep.Location, m.step)
    }

    @Test fun youCardState() {
        val pending = ShopperBrand(id = "b", name = "Kachi", status = "pending_review", canOpenStudio = true)
        val live = ShopperBrand(id = "c", name = "Live", status = "approved", canOpenStudio = true)
        assertEquals(YouSellerState.InReview(pending), YouSellerState.from(listOf(live, pending), null))
        assertEquals(YouSellerState.Member(live, 1), YouSellerState.from(listOf(live), null))
        assertEquals(YouSellerState.None, YouSellerState.from(emptyList(), null))
        val rejected = StudioApplication(id = "onb", status = "rejected", brand = StudioApplicationBrand(name = "Kachi"), reviewNote = "Add photos")
        assertEquals(YouSellerState.Rejected("Kachi", "Add photos"), YouSellerState.from(emptyList(), rejected))
    }
}

class StudioLinksTest {
    @Test fun appLinks() {
        assertEquals(StudioLink.Home, StudioLink.parse("yard://studio"))
        assertEquals(StudioLink.Orders, StudioLink.parse("yard://studio/orders"))
        assertEquals(StudioLink.Order("mo_1"), StudioLink.parse("yard://studio/orders/mo_1"))
        assertEquals(StudioLink.Inbox, StudioLink.parse("yard://studio/inbox"))
        assertEquals(StudioLink.Conversation("cv_9"), StudioLink.parse("yard://studio/inbox/cv_9"))
        assertEquals(StudioLink.Support, StudioLink.parse("yard://studio/support"))
        assertEquals(StudioLink.Products, StudioLink.parse("yard://studio/products"))
        assertEquals(StudioLink.Product("p_2"), StudioLink.parse("yard://studio/products/p_2"))
        assertEquals(StudioLink.Payouts, StudioLink.parse("yard://studio/payouts"))
        assertEquals(StudioLink.Home, StudioLink.parse("yard://studio/something-new"))
    }

    @Test fun webPathsAndOthers() {
        assertEquals(StudioLink.Order("mo_1"), StudioLink.parse("/studio/orders/mo_1"))
        assertEquals(StudioLink.Conversation("cv_1"), StudioLink.parse("/studio/inbox?thread=cv_1"))
        assertEquals(StudioLink.Payouts, StudioLink.parse("https://yardstore.space/studio/payouts"))
        assertNull(StudioLink.parse("yard://brands/acme"))
        assertNull(StudioLink.parse("/products/x"))
        assertNull(StudioLink.parse("mailto:studio"))
        assertNull(StudioLink.parse(null))
    }

    @Test fun pushTaps() {
        val fcm = mapOf("google.message_id" to "m1", "scope" to "studio", "brandId" to "b_2", "link" to "yard://studio/orders/mo_1", "url" to "/studio/orders/mo_1")
        assertEquals(StudioPushTap(StudioLink.Order("mo_1"), "b_2"), StudioPushTap.from { fcm[it] })
        val shopper = mapOf("google.message_id" to "m1", "url" to "/orders/abc")
        assertNull(StudioPushTap.from { shopper[it] })
        val ours = mapOf(StudioPushTap.EXTRA_LINK to "yard://studio/payouts", StudioPushTap.EXTRA_BRAND to "")
        assertEquals(StudioPushTap(StudioLink.Payouts, null), StudioPushTap.from { ours[it] })
        assertNull(StudioPushTap.from { null })
    }

    @Test fun navShowsTheRightScreen() {
        val nav = StudioNav()
        nav.show(StudioLink.Conversation("cv_1"))
        assertEquals(StudioTab.Me, nav.tab)
        assertEquals(listOf(StudioRoute.Inbox, StudioRoute.Thread("cv_1")), nav.stack(StudioTab.Me).toList())
        nav.show(StudioLink.Order("mo_1"))
        assertEquals(StudioTab.Orders, nav.tab)
        assertEquals(StudioRoute.Order("mo_1"), nav.top)
        assertTrue(nav.pop())
        assertFalse(nav.pop())
        nav.select(StudioTab.Add)
        assertTrue(nav.showsAdd)
        assertEquals(StudioTab.Orders, nav.tab)
    }

    @Test fun pushMessageCarriesStudioFields() {
        val m = space.yardstore.app.features.notifications.YardPushMessage.from(
            "New order", "₦45,000, Candle (Large)",
            mapOf("scope" to "studio", "brandId" to "b_1", "link" to "yard://studio/orders/mo_1", "url" to "/studio/orders/mo_1", "kind" to "studio.order", "id" to "studio.order:mo_1"),
        )!!
        assertTrue(m.isStudio)
        assertEquals("yard://studio/orders/mo_1", m.link)
        assertEquals("b_1", m.brandId)
        assertEquals("studio.order:mo_1", m.tag)
        // A link that isn't a Studio app link is never kept.
        val evil = space.yardstore.app.features.notifications.YardPushMessage.from("x", "y", mapOf("scope" to "studio", "link" to "https://evil.example"))!!
        assertNull(evil.link)
    }
}

class StudioSlideAndQuickAddTest {
    @Test fun slideThreshold() {
        assertEquals(0f, SlideToCompleteMath.progress(-10f, 200f))
        assertEquals(0.5f, SlideToCompleteMath.progress(100f, 200f))
        assertEquals(1f, SlideToCompleteMath.progress(500f, 200f))
        assertEquals(0f, SlideToCompleteMath.progress(50f, 0f))
        assertFalse(SlideToCompleteMath.completes(0.89f))
        assertTrue(SlideToCompleteMath.completes(0.9f))
        assertTrue(SlideToCompleteMath.completes(1f))
    }

    @Test fun slideTicksRiseOnlyForward() {
        assertEquals(0, SlideToCompleteMath.ticksCrossed(0f, 0.1f))
        assertEquals(1, SlideToCompleteMath.ticksCrossed(0.1f, 0.13f))
        assertEquals(8, SlideToCompleteMath.ticksCrossed(0f, 1f))
        assertEquals(0, SlideToCompleteMath.ticksCrossed(0.8f, 0.2f))
    }

    @Test fun variantsAndSkus() {
        val opts = listOf(QuickAddOption("Size", listOf("S", "L")), QuickAddOption("Scent", listOf("Cedar", "Fig")))
        val combos = QuickAddRules.combinations(opts)
        assertEquals(4, combos.size)
        assertEquals(mapOf("Size" to "S", "Scent" to "Cedar"), combos[0])
        assertEquals("S / Cedar", QuickAddRules.label(combos[0]))
        assertEquals(listOf(emptyMap<String, String>()), QuickAddRules.combinations(emptyList()))
        assertEquals("KACHI-STUDIO-CEDAR-CANDLE-L", QuickAddRules.sku("kachi-studio", "Cedar candle", mapOf("Size" to "L")))
        assertTrue(QuickAddRules.sku("h".repeat(50), "t".repeat(50), mapOf("a" to "b")).length <= 64)
    }

    @Test fun createBody() {
        val body = QuickAddRules.body("kachi", "Candle", "home", 4_500_000, emptyList(), { 3 }, listOf("med_1"))
        assertEquals(emptyList<StudioOption>(), body.options)
        assertEquals(1, body.variants.size)
        assertEquals(emptyMap<String, String>(), body.variants[0].options)
        assertEquals(3, body.variants[0].initialStock)
        assertEquals("med_1", body.images[0].mediaId)
        val sized = QuickAddRules.body("kachi", "Candle", "home", 100, listOf(QuickAddOption("Size", listOf("M", "L"))), { if (it["Size"] == "M") 2 else 0 }, emptyList())
        assertEquals(listOf("M", "L"), sized.options[0].values.map { it.value })
        assertEquals(listOf(2, 0), sized.variants.map { it.initialStock })
        assertEquals(2, sized.variants.map { it.sku }.toSet().size)
    }

    @Test fun pricesAndReauth() {
        assertEquals(4500L, QuickAddRules.priceMinor("45", "USD"))
        assertEquals(4550L, QuickAddRules.priceMinor("45.5", "USD"))
        assertEquals(1200L, QuickAddRules.priceMinor("1,200", "JPY"))
        assertNull(QuickAddRules.priceMinor("0", "USD"))
        assertNull(QuickAddRules.priceMinor("abc", "USD"))
        val e = APIError(403, "forbidden", "Confirm it's you.", mapOf("reauth" to "required", "reauthWith" to "apple,google"))
        assertEquals(listOf("apple", "google"), StudioReauth.methods(e))
        assertNull(StudioReauth.methods(APIError(403, "forbidden", "No.")))
        assertEquals(listOf("password"), StudioReauth.methods(APIError(403, "forbidden", "x", mapOf("reauth" to "required"))))
        assertEquals("google-oauth2", StudioReauth.button("auth0:google-oauth2")?.connection)
        assertNull(StudioReauth.button("password"))
    }
}
