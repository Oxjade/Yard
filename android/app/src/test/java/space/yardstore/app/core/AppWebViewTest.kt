package space.yardstore.app.core

import okhttp3.HttpUrl.Companion.toHttpUrl
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppWebViewTest {
    private val base = "https://yardstore.space".toHttpUrl()

    @Test fun addsViewAppToLegalPages() {
        for (page in listOf("terms", "privacy", "refunds", "data-deletion")) {
            assertEquals("https://yardstore.space/legal/$page?view=app", AppWebView.appViewUrl(Config.webUrl("/legal/$page")))
        }
    }

    @Test fun keepsExistingQueryAndFragment() {
        assertEquals(
            "https://yardstore.space/legal/terms?lang=en&view=app#returns",
            AppWebView.appViewUrl("https://yardstore.space/legal/terms?lang=en#returns"),
        )
    }

    @Test fun isIdempotentAndReplacesOtherViewValues() {
        val once = AppWebView.appViewUrl("https://yardstore.space/legal/terms")
        assertEquals(once, AppWebView.appViewUrl(once))
        assertEquals("https://yardstore.space/legal/terms?view=app", AppWebView.appViewUrl("https://yardstore.space/legal/terms?view=web"))
    }

    @Test fun leavesNonHttpUrlsAlone() {
        assertEquals("mailto:help@yardstore.space", AppWebView.appViewUrl("mailto:help@yardstore.space"))
    }

    @Test fun pathOverload() {
        assertEquals("https://yardstore.space/legal/privacy?view=app", AppWebView.appViewUrl(base, "/legal/privacy"))
    }

    @Test fun recognisesLegalPagesOnTheSiteOnly() {
        assertTrue(AppWebView.isLegalPage("https://yardstore.space/legal/privacy", base))
        assertTrue(AppWebView.isLegalPage("https://www.yardstore.space/legal/refunds?view=app", base))
        assertTrue(AppWebView.isLegalPage("https://yardstore.space/legal", base))
        assertFalse(AppWebView.isLegalPage("https://yardstore.space/legalese", base))
        assertFalse(AppWebView.isLegalPage("https://yardstore.space/support", base))
        assertFalse(AppWebView.isLegalPage("https://evil.example/legal/terms", base))
        assertFalse(AppWebView.isLegalPage("mailto:legal@yardstore.space", base))
    }

    @Test fun routesNavigations() {
        assertEquals(AppWebView.Navigation.Allow, AppWebView.route("https://yardstore.space/legal/terms?view=app", base))
        assertEquals(
            AppWebView.Navigation.Rewrite("https://yardstore.space/legal/privacy?view=app"),
            AppWebView.route("https://yardstore.space/legal/privacy", base),
        )
        assertEquals(
            AppWebView.Navigation.External("https://yardstore.space/brands/acme"),
            AppWebView.route("https://yardstore.space/brands/acme", base),
        )
        assertEquals(
            AppWebView.Navigation.External("mailto:privacy@yardstore.space"),
            AppWebView.route("mailto:privacy@yardstore.space", base),
        )
    }
}
