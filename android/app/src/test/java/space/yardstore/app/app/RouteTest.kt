package space.yardstore.app.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RouteTest {
    private fun r(url: String) = Route.fromUrl(url)

    @Test fun brands() {
        assertEquals(Route.BrandsDirectory, r("https://yardstore.space/brands"))
        assertEquals(Route.Brand("acme"), r("https://yardstore.space/brands/acme"))
        assertEquals(Route.Collection("acme", "summer"), r("https://yardstore.space/brands/acme/collections/summer"))
        assertEquals(Route.Brand("acme"), r("yard://brands/acme"))
        assertEquals(Route.BrandsDirectory, r("yard://brands"))
    }

    @Test fun productAndShop() {
        assertEquals(Route.Product("boxy-tee"), r("https://yardstore.space/products/boxy-tee"))
        assertNull(r("https://yardstore.space/products"))
        assertEquals(Route.Categories, r("https://yardstore.space/categories"))
        assertEquals(Route.Category("tops"), r("https://yardstore.space/categories/tops"))
        assertEquals(Route.Category("bags"), r("https://yardstore.space/shop?category=bags"))
        assertEquals(Route.Shop, r("https://yardstore.space/shop"))
        assertEquals(Route.Search("cargo pant"), r("https://yardstore.space/search?q=cargo%20pant"))
        assertEquals(Route.Search("a+b"), r("https://yardstore.space/search?q=a+b"))
        assertEquals(Route.Search(""), r("https://yardstore.space/search"))
    }

    @Test fun bagCheckoutOrders() {
        assertEquals(Route.Bag, r("https://yardstore.space/bag"))
        assertEquals(Route.Checkout, r("https://yardstore.space/checkout"))
        assertEquals(Route.OrderConfirmation("chk_1"), r("https://yardstore.space/checkout/confirmation?checkout=chk_1"))
        assertEquals(Route.OrderConfirmation("chk_2"), r("https://yardstore.space/checkout/confirmation?id=chk_2"))
        assertEquals(Route.Checkout, r("https://yardstore.space/checkout/confirmation"))
        assertEquals(Route.Orders, r("https://yardstore.space/you/orders"))
        assertEquals(Route.Order("ord_9"), r("https://yardstore.space/you/orders/ord_9"))
        assertEquals(Route.MyDrops, r("https://yardstore.space/you/drops"))
        assertEquals(Route.Settings, r("https://yardstore.space/you/settings"))
        assertEquals(Route.You, r("https://yardstore.space/you"))
        assertEquals(Route.Order("ord_1"), r("yard://you/orders/ord_1"))
    }

    @Test fun dropsInboxAndMore() {
        assertEquals(Route.Drops, r("https://yardstore.space/drops"))
        assertEquals(Route.Drop("spring-drop"), r("yard://drops/spring-drop"))
        assertEquals(Route.Inbox, r("https://yardstore.space/inbox"))
        assertEquals(Route.Conversation("c1"), r("https://yardstore.space/inbox?c=c1"))
        assertEquals(Route.Conversation("c2"), r("https://yardstore.space/inbox?conversation=c2"))
        assertEquals(Route.Conversation("c3"), r("https://yardstore.space/inbox/c3"))
        assertEquals(Route.Saved, r("https://yardstore.space/wishlist"))
        assertEquals(Route.Following, r("https://yardstore.space/following"))
        assertEquals(Route.Charts, r("https://yardstore.space/charts"))
        assertEquals(Route.Around, r("https://yardstore.space/around"))
        assertEquals(Route.Notifications, r("https://yardstore.space/notifications"))
        assertEquals(Route.SignIn, r("https://yardstore.space/sign-in"))
        assertEquals(Route.Welcome, r("https://yardstore.space/welcome"))
        assertEquals(Route.Legal(LegalPage.Terms), r("https://yardstore.space/legal/terms"))
        assertEquals(Route.Legal(LegalPage.DataDeletion), r("https://yardstore.space/legal/data-deletion"))
        assertNull(r("https://yardstore.space/legal/cookies"))
        assertNull(r("https://yardstore.space/studio"))
        assertNull(r("https://yardstore.space/"))
    }

    @Test fun sitePaths() {
        assertEquals(Route.Drop("abc"), Route.fromPath("/drops/abc"))
        assertEquals(Route.Brand("acme"), Route.fromPath("brands/acme"))
    }

    @Test fun routerQueuesPushesBeforeTabsExist() {
        val router = Router()
        assertTrue(router.isTabPillVisible)
        assertTrue(router.open("https://yardstore.space/products/x"))
        assertEquals(1, router.depth)
        assertFalse(router.isTabPillVisible)
        router.pop()
        assertEquals(0, router.depth)
        assertTrue(router.open("yard://bag"))
        assertEquals(AppTab.Bag, router.selectedTab)
        assertTrue(router.open("https://yardstore.space/sign-in"))
        assertEquals(Route.SignIn, router.sheet)
        router.dismissSheet()
        assertFalse(router.open("https://example.com/nope"))
        router.show(Route.Order("o1"), AppTab.You)
        assertEquals(AppTab.You, router.selectedTab)
        assertEquals(1, router.depth)
        router.select(AppTab.You) // re-select pops to root
        assertEquals(0, router.depth)
    }
}
