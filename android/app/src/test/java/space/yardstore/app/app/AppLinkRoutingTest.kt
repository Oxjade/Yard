package space.yardstore.app.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.app.AppLinkRouting.Incoming

class AppLinkRoutingTest {
    private val view = "android.intent.action.VIEW"
    private fun emailLinks(url: String) = url.contains("/auth/magic") || url.contains("/auth/verify")

    // classify

    @Test fun authHandoffIsNeverARoute() {
        val ok = "yard://auth/complete?code=abc&result=signed_in&provider=google&mode=signin&actor=shopper"
        assertEquals(Incoming.AuthHandoff(ok), AppLinkRouting.classify(view, ok, null, ::emailLinks))
        val failed = "yard://auth/complete?result=cancelled&provider=google"
        assertEquals(Incoming.AuthHandoff(failed), AppLinkRouting.classify(view, failed, null, ::emailLinks))
        // Only ACTION_VIEW links, and the https page is not the hand-off.
        assertEquals(Incoming.Ignore, AppLinkRouting.classify(null, ok, null, ::emailLinks))
        val web = "https://yardstore.space/auth/complete?result=signed_in"
        assertEquals(Incoming.AppLink(web), AppLinkRouting.classify(view, web, null, ::emailLinks))
    }

    @Test fun notificationTapWinsOverData() {
        assertEquals(
            Incoming.NotificationTap("/you/orders/ord_1"),
            AppLinkRouting.classify(view, "yard://drops/abc", "/you/orders/ord_1", ::emailLinks),
        )
        assertEquals(
            Incoming.NotificationTap("/drops/x"),
            AppLinkRouting.classify(null, null, "/drops/x", ::emailLinks),
        )
    }

    @Test fun emptyNotificationHrefStillCountsAsTap() {
        assertEquals(Incoming.NotificationTap(""), AppLinkRouting.classify(null, null, "", ::emailLinks))
    }

    @Test fun emailLinksAreIntercepted() {
        val magic = "https://yardstore.space/auth/magic?token=abc"
        assertEquals(Incoming.EmailLink(magic), AppLinkRouting.classify(view, magic, null, ::emailLinks))
        val verify = "yard://auth/verify?token=abc"
        assertEquals(Incoming.EmailLink(verify), AppLinkRouting.classify(view, verify, null, ::emailLinks))
    }

    @Test fun otherViewLinksGoToTheRouter() {
        // Drop reminders and order-tracking notifications open through plain yard:// links.
        val drop = "yard://drops/summer-drop"
        assertEquals(Incoming.AppLink(drop), AppLinkRouting.classify(view, drop, null, ::emailLinks))
        val order = "yard://you/orders/ord_1?view=track"
        assertEquals(Incoming.AppLink(order), AppLinkRouting.classify(view, order, null, ::emailLinks))
    }

    @Test fun launcherAndEmptyIntentsAreIgnored() {
        assertEquals(Incoming.Ignore, AppLinkRouting.classify("android.intent.action.MAIN", null, null, ::emailLinks))
        assertEquals(Incoming.Ignore, AppLinkRouting.classify(view, null, null, ::emailLinks))
        assertEquals(Incoming.Ignore, AppLinkRouting.classify(view, "", null, ::emailLinks))
        assertEquals(Incoming.Ignore, AppLinkRouting.classify(null, "yard://drops/x", null, ::emailLinks))
    }

    // isDuplicateConfirmation

    private val confirmation = Route.fromUrl("https://yardstore.space/checkout/confirmation?checkout=chk_1")

    @Test fun confirmationLinkParses() {
        assertEquals(Route.OrderConfirmation("chk_1"), confirmation)
    }

    @Test fun sameConfirmationOnTopIsADuplicate() {
        assertTrue(AppLinkRouting.isDuplicateConfirmation(confirmation, listOf(null, Route.OrderConfirmation("chk_1"))))
    }

    @Test fun checkoutInFlightIsADuplicate() {
        assertTrue(AppLinkRouting.isDuplicateConfirmation(confirmation, listOf(null, Route.Checkout)))
    }

    @Test fun otherConfirmationOrNoCheckoutIsNotADuplicate() {
        assertFalse(AppLinkRouting.isDuplicateConfirmation(confirmation, listOf(Route.OrderConfirmation("chk_2"))))
        assertFalse(AppLinkRouting.isDuplicateConfirmation(confirmation, listOf(null, null)))
        assertFalse(AppLinkRouting.isDuplicateConfirmation(confirmation, emptyList()))
    }

    @Test fun nonConfirmationLinksAreNeverDuplicates() {
        val tops = listOf(Route.Checkout, Route.OrderConfirmation("chk_1"))
        assertFalse(AppLinkRouting.isDuplicateConfirmation(Route.fromUrl("https://yardstore.space/checkout"), tops))
        assertFalse(AppLinkRouting.isDuplicateConfirmation(Route.Product("tee"), tops))
        assertFalse(AppLinkRouting.isDuplicateConfirmation(null, tops))
    }

    // TabTopRoutes

    @Test fun tabTopsTrackSetAndRemove() {
        val tops = TabTopRoutes()
        assertNull(tops[AppTab.Bag])
        tops.set(AppTab.Bag, Route.Checkout)
        tops.set(AppTab.Home, null)
        assertEquals(Route.Checkout, tops[AppTab.Bag])
        assertTrue(Route.Checkout in tops.all)
        tops.set(AppTab.Bag, Route.OrderConfirmation("chk_1"))
        assertTrue(AppLinkRouting.isDuplicateConfirmation(confirmation, tops.all))
        tops.remove(AppTab.Bag)
        assertFalse(AppLinkRouting.isDuplicateConfirmation(confirmation, tops.all))
    }
}
