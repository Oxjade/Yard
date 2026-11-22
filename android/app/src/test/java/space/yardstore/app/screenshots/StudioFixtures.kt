package space.yardstore.app.screenshots

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import space.yardstore.app.core.models.BrandMember
import space.yardstore.app.core.models.ShopperBrand
import space.yardstore.app.core.networking.APIClient
import space.yardstore.app.core.stores.LocalSessionStore
import space.yardstore.app.core.stores.SessionStore
import space.yardstore.app.features.inbox.InboxLastMessage
import space.yardstore.app.features.inbox.InboxMessage
import space.yardstore.app.features.orders.OrderPreviewItem
import space.yardstore.app.features.orders.OrderShipToPreview
import space.yardstore.app.features.orders.OrderStates
import space.yardstore.app.features.studio.LocalStudioStore
import space.yardstore.app.features.studio.StudioBalance
import space.yardstore.app.features.studio.StudioCategory
import space.yardstore.app.features.studio.StudioConversation
import space.yardstore.app.features.studio.StudioConversationsPage
import space.yardstore.app.features.studio.StudioCustomer
import space.yardstore.app.features.studio.StudioDashboard
import space.yardstore.app.features.studio.StudioDashboardBrand
import space.yardstore.app.features.studio.StudioImageRef
import space.yardstore.app.features.studio.StudioLowStock
import space.yardstore.app.features.studio.StudioNotificationSettings
import space.yardstore.app.features.studio.StudioOrderActions
import space.yardstore.app.features.studio.StudioOrderDetail
import space.yardstore.app.features.studio.StudioOrderEvent
import space.yardstore.app.features.studio.StudioOrderLine
import space.yardstore.app.features.studio.StudioOrderLineImage
import space.yardstore.app.features.studio.StudioOrderSummary
import space.yardstore.app.features.studio.StudioPayout
import space.yardstore.app.features.studio.StudioPayoutAccount
import space.yardstore.app.features.studio.StudioPayouts
import space.yardstore.app.features.studio.StudioProduct
import space.yardstore.app.features.studio.StudioProductImage
import space.yardstore.app.features.studio.StudioSales
import space.yardstore.app.features.studio.StudioSalesWindow
import space.yardstore.app.features.studio.StudioSeries
import space.yardstore.app.features.studio.StudioSeriesPoint
import space.yardstore.app.features.studio.StudioSitePieces
import space.yardstore.app.features.studio.StudioSitePiece
import space.yardstore.app.features.studio.StudioProposal
import space.yardstore.app.features.studio.StudioStore
import space.yardstore.app.features.studio.StudioStoreViews
import space.yardstore.app.features.studio.StudioThread
import space.yardstore.app.features.studio.StudioToShip
import space.yardstore.app.features.studio.StudioTopProduct
import space.yardstore.app.features.studio.StudioVariant
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import java.time.LocalDate

/** Studio data for the fake backend and the screenshots (test-only; category-neutral on purpose). */
object StudioFixtures {
    val categories = listOf(
        StudioCategory("home", "Home & living"),
        StudioCategory("beauty", "Beauty"),
        StudioCategory("clothing", "Clothing"),
        StudioCategory("art", "Art & prints"),
        StudioCategory("accessories", "Accessories"),
        StudioCategory("stationery", "Stationery"),
    )

    val liveBrand = ShopperBrand(id = "b_kachi", handle = "kachi-studio", name = "Kachi Studio", initials = "KS", role = "owner", status = "approved", canOpenStudio = true)
    val pendingBrand = ShopperBrand(id = "b_new", handle = "ember-goods", name = "Ember Goods", initials = "EG", role = "owner", status = "pending_review", canOpenStudio = true)

    val profile = BrandMember(
        userId = "usr_preview", name = "Ada Obi",
        brand = BrandMember.Brand(id = "b_kachi", handle = "kachi-studio", name = "Kachi Studio"),
        role = "owner",
        permissions = listOf("orders.fulfil", "content.publish", "inbox.read", "inbox.reply", "inbox.manage"),
    )

    fun dashboard(days: Int): StudioDashboard {
        val today = LocalDate.of(2026, 11, 21)
        val shape = listOf(0, 3, 1, 4, 2, 6, 5, 3, 7, 4, 8, 6, 9, 5, 7, 10, 6, 8, 11, 7, 9, 12, 8, 10, 13, 9, 11, 14, 12, 15)
        val points = (0 until days).map { i ->
            val net = shape[(30 - days + i) % shape.size] * 1_500_000L
            StudioSeriesPoint(date = today.minusDays((days - 1 - i).toLong()).toString(), orders = (net / 3_000_000L).toInt(), grossMinor = net, netMinor = net)
        }
        return StudioDashboard(
            brand = StudioDashboardBrand("b_kachi", "kachi-studio", "Kachi Studio", "NGN", "Africa/Lagos"),
            sales = StudioSales(
                today = StudioSalesWindow(orders = 3, grossMinor = 4_500_000, netMinor = 4_500_000),
                week = StudioSalesWindow(orders = 14, grossMinor = 31_500_000, refundedMinor = 1_500_000, netMinor = 30_000_000),
                month = StudioSalesWindow(orders = 52, grossMinor = 118_000_000, refundedMinor = 3_000_000, netMinor = 115_000_000),
            ),
            series = StudioSeries(days = days, points = points),
            toShip = StudioToShip(total = 3, paid = 2, processing = 1),
            lowStock = StudioLowStock(variants = 2, products = 1, threshold = 3),
            unreadMessages = 2,
            websitePieces = 3,
            topProducts = listOf(
                StudioTopProduct("p_1", "Cedar candle", "NGN", 9, 13_500_000, StudioImageRef("/api/media/fake-candle?as=brand")),
                StudioTopProduct("p_2", "Stoneware mug", "NGN", 6, 7_200_000, StudioImageRef("/api/media/fake-mug?as=brand")),
                StudioTopProduct("p_3", "Linen tote", "NGN", 4, 4_800_000, null),
            ),
            storeViews = StudioStoreViews(today = 48, week = 412, month = 1_630),
        )
    }

    private fun summary(id: String, ref: String, name: String, merchant: String, fulfilment: String, item: String, qty: Int, total: Long, at: String, city: String) =
        StudioOrderSummary(
            id = id, reference = ref, customerName = name,
            shipToPreview = OrderShipToPreview(city = city, country = "NG"),
            placedAt = at, currency = "NGN", totalMinor = total, itemCount = qty + 1,
            previewItems = listOf(OrderPreviewItem(name = item, qty = qty)),
            states = OrderStates(merchant = merchant, payment = "paid", fulfilment = fulfilment),
        )

    val orders = listOf(
        summary("mo_1", "YD-4821", "Ada Nwosu", "paid", "unfulfilled", "Cedar candle (Large)", 1, 4_500_000, "2026-11-21T09:12:00Z", "Lagos"),
        summary("mo_2", "YD-4819", "Kwame Mensah", "paid", "unfulfilled", "Stoneware mug", 2, 2_400_000, "2026-11-21T07:40:00Z", "Accra"),
        summary("mo_3", "YD-4802", "Zainab Bello", "processing", "processing", "Linen tote", 1, 1_200_000, "2026-11-20T16:05:00Z", "Abuja"),
        summary("mo_4", "YD-4777", "Tunde Ade", "shipped", "shipped", "Cedar candle (Small)", 1, 3_000_000, "2026-11-18T12:00:00Z", "Ibadan"),
        summary("mo_5", "YD-4701", "Mary Okafor", "delivered", "delivered", "Stoneware mug", 1, 1_200_000, "2026-11-12T12:00:00Z", "Lagos"),
    )

    val orderDetail = StudioOrderDetail(
        id = "mo_3", reference = "YD-4802", customerName = "Zainab Bello",
        shipToPreview = OrderShipToPreview("Abuja", "NG"),
        placedAt = "2026-11-20T16:05:00Z", paidAt = "2026-11-20T16:05:00Z", currency = "NGN",
        subtotalMinor = 1_000_000, shippingMinor = 200_000, totalMinor = 1_200_000, itemCount = 1,
        states = OrderStates(merchant = "processing", payment = "paid", fulfilment = "processing"),
        lines = listOf(
            StudioOrderLine(id = "l1", title = "Linen tote", qty = 1, unitMinor = 1_000_000, variantLabel = "Natural", image = StudioOrderLineImage("/api/media/fake-tote?as=brand")),
        ),
        shipTo = JsonObject(mapOf("name" to JsonPrimitive("Zainab Bello"), "line1" to JsonPrimitive("14 Aminu Kano Crescent"), "city" to JsonPrimitive("Abuja"), "country" to JsonPrimitive("NG"))),
        refundableMinor = 1_200_000,
        timeline = listOf(StudioOrderEvent(id = "e1", kind = "order.processing", at = "2026-11-21T08:30:00Z")),
        actions = StudioOrderActions(canCancel = true),
    )

    val products = listOf(
        StudioProduct(
            id = "p_1", slug = "cedar-candle", title = "Cedar candle", priceMinor = 1_500_000, currency = "NGN", status = "published", version = 3,
            images = listOf(StudioProductImage(src = "/api/media/fake-candle?as=brand")),
            variants = listOf(StudioVariant("v1", label = "Small", available = 6, onHand = 6), StudioVariant("v2", label = "Large", available = 2, onHand = 3, held = 1)),
        ),
        StudioProduct(
            id = "p_2", slug = "stoneware-mug", title = "Stoneware mug", priceMinor = 1_200_000, currency = "NGN", status = "published", version = 1,
            images = listOf(StudioProductImage(src = "/api/media/fake-mug?as=brand")),
            variants = listOf(StudioVariant("v3", available = 14, onHand = 14)),
        ),
        StudioProduct(
            id = "p_3", slug = "linen-tote", title = "Linen tote", priceMinor = 1_000_000, currency = "NGN", status = "draft", version = 2,
            images = listOf(StudioProductImage(src = "/api/media/fake-tote?as=brand")),
            variants = listOf(StudioVariant("v4", label = "Natural", available = 0), StudioVariant("v5", label = "Black", available = 0)),
        ),
    )

    val payouts = StudioPayouts(
        currency = "NGN",
        balances = listOf(StudioBalance(currency = "NGN", availableMinor = 48_500_000, pendingMinor = 12_000_000)),
        account = StudioPayoutAccount(country = "NG", currency = "NGN", bankName = "GTBank", accountName = "Kachi Studio Ltd", accountLast4 = "4821", verified = true),
        payouts = listOf(
            StudioPayout("po_1", "NGN", 32_000_000, "paid", requestedAt = "2026-11-14T10:00:00Z", paidAt = "2026-11-15T10:00:00Z"),
            StudioPayout("po_2", "NGN", 18_500_000, "paid", requestedAt = "2026-11-07T10:00:00Z", paidAt = "2026-11-08T10:00:00Z"),
        ),
    )

    val conversations = StudioConversationsPage(
        items = listOf(
            StudioConversation("cv_1", StudioCustomer("c1", "Ada Nwosu"), lastMessage = InboxLastMessage("Is the large candle back in stock?", "2026-11-21T08:00:00Z", side = "customer"), unread = 1),
            StudioConversation("cv_2", StudioCustomer("c2", "Kwame Mensah"), lastMessage = InboxLastMessage("Thank you! It arrived today.", "2026-11-19T18:00:00Z", side = "customer")),
        ),
    )

    val thread = StudioThread(
        conversation = conversations.items[0],
        messages = listOf(
            InboxMessage("m1", seq = 1, side = "customer", body = "Hi! Is the large candle back in stock?", createdAt = "2026-11-21T08:00:00Z"),
            InboxMessage("m2", seq = 2, side = "brand", body = "Yes, two left. Shall I hold one for you?", createdAt = "2026-11-21T08:05:00Z"),
        ),
    )

    val pieces = StudioSitePieces(
        count = 3, mayAdd = true, site = "kachistudio.com", currency = "NGN",
        items = listOf(
            StudioSitePiece("sp_1", title = "Fig leaf candle", images = listOf("/media/fake-site-1.jpg"), priceMinor = 1_800_000, currency = "NGN", status = "waiting"),
            StudioSitePiece("sp_2", title = "Ceramic incense holder", images = listOf("/media/fake-site-2.jpg"), priceMinor = 900_000, currency = "NGN", status = "waiting"),
            StudioSitePiece("sp_3", title = "Linen napkins, set of 4", images = listOf("/media/fake-site-3.jpg"), priceMinor = 1_400_000, currency = "NGN", status = "waiting", sizes = listOf("Sand", "Clay")),
        ),
    )

    /** Suggestions from Yard: five new products waiting, two answered. */
    val proposals = listOf(
        StudioProposal("pr_1", kind = "new", title = "Amber room spray", cover = "/api/media/fake-pr-1?as=brand", createdAt = "2026-11-21T09:00:00Z"),
        StudioProposal("pr_2", kind = "new", title = "Stoneware bowl", cover = "/api/media/fake-pr-2?as=brand", createdAt = "2026-11-21T09:00:00Z"),
        StudioProposal("pr_3", kind = "new", title = "Beeswax taper pair", cover = "/api/media/fake-pr-3?as=brand", createdAt = "2026-11-21T09:00:00Z"),
        StudioProposal("pr_4", kind = "new", title = "Woven coaster set", cover = "/api/media/fake-pr-4?as=brand", createdAt = "2026-11-21T09:00:00Z"),
        StudioProposal("pr_5", kind = "new", title = "Travel candle tin", cover = "/api/media/fake-pr-5?as=brand", createdAt = "2026-11-21T09:00:00Z"),
        StudioProposal("pr_6", kind = "new", status = "accepted", productId = "p_2", title = "Stoneware mug", cover = "/api/media/fake-mug?as=brand"),
        StudioProposal("pr_7", kind = "edit", status = "declined", productId = "p_3", title = "Linen tote", fields = listOf("price", "images")),
    )
    val notifications = StudioNotificationSettings()
}

/** A signed-in session + Studio store loaded from the fake backend (brands from [FakeYardBackend.sessionBrands]). */
@Composable
fun StudioHarness(enter: Boolean, content: @Composable () -> Unit) {
    val session = remember { SessionStore(APIClient.shared) }
    val studio = remember { StudioStore(APIClient.shared, session) }
    var ready by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        session.refresh()
        studio.sessionChanged()
        if (enter) studio.enter() else studio.leave()
        ready = true
    }
    CompositionLocalProvider(LocalSessionStore provides session, LocalStudioStore provides studio) {
        if (ready) content()
    }
}
