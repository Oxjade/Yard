package space.yardstore.app.features.you

import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIError

/** DTO decoding and pure helpers of the You feature. */
class YouModelsTest {

    // Shape of GET /api/auth/security?as=shopper (src/app/api/auth/security/route.ts).
    private val securityJson = """
        {
          "method": "google",
          "demo": false,
          "emailVerified": true,
          "hasPassword": false,
          "identities": [
            {"id": "idn_01HZX", "provider": "google", "email": "ada@example.com", "createdAt": "2026-10-01T09:00:00.000Z"},
            {"id": "idn_02ABC", "provider": "apple", "email": null}
          ],
          "providers": {"google": true, "apple": true},
          "mfa": null,
          "reauthAgeSec": 120,
          "deletion": null
        }
    """.trimIndent()

    @Test fun decodesSecurity() {
        val s = YardJson.decodeFromString<YouSecurity>(securityJson)
        assertEquals("google", s.method)
        assertTrue(s.emailVerified)
        assertFalse(s.hasPassword)
        assertEquals(2, s.identities.size)
        assertEquals("Google", s.identities[0].providerName)
        assertEquals("ada@example.com", s.identities[0].email)
        assertEquals("Apple", s.identities[1].providerName)
        assertNull(s.identities[1].email)
        assertTrue(s.providers.google && s.providers.apple)
        assertEquals(120, s.reauthAgeSec)
        assertNull(s.deletion)
        assertFalse(s.isDeletionPending)
    }

    @Test fun decodesSecurityWithDefaultsAndPendingDeletion() {
        val s = YardJson.decodeFromString<YouSecurity>(
            """{"method":"password","demo":false,"hasPassword":true,"identities":[],"providers":{"google":false,"apple":false},
               "reauthAgeSec":null,"deletion":{"status":"processing","requestedAt":"2026-11-12T10:00:00.000Z"}}""",
        )
        assertTrue(s.hasPassword)
        assertNull(s.reauthAgeSec)
        assertTrue(s.isDeletionPending)
        assertEquals("2026-11-12T10:00:00.000Z", s.deletion?.requestedAt)
        val completed = s.copy(deletion = YouDeletion(status = "completed"))
        assertFalse(completed.isDeletionPending)
    }

    @Test fun providerNames() {
        assertEquals("Social sign-in", YouIdentity("1", "auth0").providerName)
        assertEquals("Github", YouIdentity("2", "github").providerName)
    }

    @Test fun recentReauthWindowKeeps30sMargin() {
        val base = YouSecurity(hasPassword = true)
        assertFalse(base.isRecentlyConfirmed(600))
        assertTrue(base.copy(reauthAgeSec = 569).isRecentlyConfirmed(600))
        assertFalse(base.copy(reauthAgeSec = 570).isRecentlyConfirmed(600))
    }

    @Test fun deleteGate() {
        // Unknown security: ask for the password.
        assertTrue(youDeleteNeedsPassword(null))
        assertFalse(youDeleteCannotConfirm(null))
        val pw = YouSecurity(hasPassword = true)
        assertTrue(youDeleteNeedsPassword(pw))
        assertFalse(youCanSubmitDelete(pw, "DELETE", ""))
        assertTrue(youCanSubmitDelete(pw, " delete ", "hunter2hunter2"))
        assertFalse(youCanSubmitDelete(pw, "DELET", "hunter2hunter2"))
        // Recently re-authed: no password needed.
        assertTrue(youCanSubmitDelete(pw.copy(reauthAgeSec = 10), "DELETE", ""))
        // OAuth-only, no recent re-auth: can't confirm in the app.
        val oauth = YouSecurity(hasPassword = false)
        assertFalse(youDeleteNeedsPassword(oauth))
        assertTrue(youDeleteCannotConfirm(oauth))
    }

    @Test fun passwordRules() {
        assertEquals(
            mapOf("currentPassword" to "Enter your password.", "newPassword" to "Use at least 10 characters."),
            youPasswordErrors(hasPassword = true, current = "", newPassword = "short", confirm = "short"),
        )
        assertEquals(
            mapOf("confirm" to "The passwords don't match."),
            youPasswordErrors(hasPassword = false, current = "", newPassword = "longenough1", confirm = "longenough2"),
        )
        val long = "x".repeat(201)
        assertEquals("Keep it to 200 characters.", youPasswordErrors(false, "", long, long)["newPassword"])
        assertTrue(youPasswordErrors(true, "old-password", "new-password-1", "new-password-1").isEmpty())
    }

    @Test fun reauthRequiredDetection() {
        assertTrue(APIError(403, "forbidden", "Confirm it's you.", mapOf("reauth" to "required")).youNeedsReauth)
        assertFalse(APIError(403, "forbidden", "No.").youNeedsReauth)
        assertFalse(APIError(422, "validation", "Bad.", mapOf("reauth" to "required")).youNeedsReauth)
    }

    @Test fun prefFlagsUseServerCategoryNames() {
        val r = YardJson.decodeFromString<YouPreferencesResponse>(
            """{"preferences":{"email":{"drops":true,"price_drops":false,"back_in_stock":true,"brand_news":false},
               "inApp":{"drops":true,"price_drops":true,"back_in_stock":true,"brand_news":true}}}""",
        )
        assertEquals(true, r.preferences.email.backInStock)
        assertEquals(false, r.preferences.email.priceDrops)
        assertTrue(r.preferences.email.anyOn)
        assertEquals(true, r.preferences.inApp.brandNews)
        // A PATCH only sends what changed (nulls are left out).
        val patch = YouPreferencesPatch(inApp = YouNotifyTopic.PriceDrops.flags(false))
        assertEquals("""{"inApp":{"price_drops":false}}""", YardJson.encodeToString(patch))
    }

    @Test fun prefFlagsMergeAndTopics() {
        val a = YouPrefFlags(drops = true, priceDrops = false)
        val merged = a.merged(YouPrefFlags(priceDrops = true, brandNews = true))
        assertEquals(YouPrefFlags(drops = true, priceDrops = true, backInStock = null, brandNews = true), merged)
        assertFalse(YouPrefFlags().anyOn)
        assertFalse(YouNotifyTopic.BackInStock.value(YouPrefFlags()))
        assertTrue(YouNotifyTopic.Drops.value(merged))
        assertEquals("Promotions", YouNotifyTopic.PriceDrops.title)
    }

    @Test fun inboxSettingsDecode() {
        assertFalse(YardJson.decodeFromString<YouInboxSettings>("""{"readReceipts":false}""").readReceipts)
    }

    @Test fun markets() {
        assertEquals("Nigeria", YouMarkets.country("ng")?.name)
        assertEquals("NGN", YouMarkets.country("NG")?.currency)
        assertNull(YouMarkets.country(null))
        assertNull(YouMarkets.country("ZZ"))
        assertEquals("MXN MX$", YouMarkets.currency("mxn")?.label)
        assertEquals(11, YouMarkets.countries.size)
        assertEquals(10, YouMarkets.currencies.size)
        // Every country's currency is selectable.
        assertTrue(YouMarkets.countries.all { YouMarkets.currency(it.currency) != null })
    }

    @Test fun followingNote() {
        assertEquals("Right now that covers 1 brand.", youFollowingNote(1))
        assertEquals("Right now that covers 4 brands.", youFollowingNote(4))
    }
}
