package space.yardstore.app.features.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import space.yardstore.app.core.models.YardJson
import space.yardstore.app.core.networking.APIClient

class AuthModelsTest {
    private val providersJson = """
        {"password":true,"magicLink":true,"google":false,"apple":false,"auth0":true,
         "auth0Connections":[{"name":"google-oauth2","label":"Google"},{"name":"facebook","label":"Facebook"}],
         "demo":{"shopper":true,"brand":false,"admin":false}}
    """.trimIndent()

    @Test fun decodesProviders() {
        val p = YardJson.decodeFromString(AuthProviders.serializer(), providersJson)
        assertTrue(p.auth0)
        assertFalse(p.google)
        assertTrue(p.magicLink)
        assertTrue(p.demoShopper)
        assertEquals(listOf("google-oauth2", "facebook"), p.auth0Connections.map { it.name })
    }

    @Test fun providersDefaultsWhenFieldsMissing() {
        val p = YardJson.decodeFromString(AuthProviders.serializer(), """{"password":true}""")
        assertFalse(p.auth0)
        assertTrue(p.magicLink)
        assertFalse(p.demoShopper)
        assertTrue(AuthSocialButton.buttons(p).isEmpty())
    }

    @Test fun buttonsFromAuth0Connections() {
        val p = YardJson.decodeFromString(AuthProviders.serializer(), providersJson)
        val buttons = AuthSocialButton.buttons(p)
        assertEquals(listOf("auth0:google-oauth2", "auth0:facebook"), buttons.map { it.key })
        assertEquals(AuthSocialButton.Mark.Google, buttons[0].mark)
        assertEquals(AuthSocialButton.Mark.Generic, buttons[1].mark)
        assertEquals("auth0", buttons[0].provider)
        assertEquals("google-oauth2", buttons[0].connection)
    }

    @Test fun directProvidersComeFirstWithoutDuplicates() {
        val p = AuthProviders(
            google = true, apple = true, auth0 = true,
            auth0Connections = listOf(AuthProviders.Connection("google-oauth2", "Google"), AuthProviders.Connection("apple", "Apple"), AuthProviders.Connection("github", "GitHub")),
        )
        val buttons = AuthSocialButton.buttons(p)
        assertEquals(listOf("google", "apple", "auth0:github"), buttons.map { it.key })
        assertNull(buttons[0].connection)
        assertTrue(AuthSocialButton.buttons(null).isEmpty())
    }

    @Test fun decodesStatusAndStartResponses() {
        val s = YardJson.decodeFromString(AuthStatusResponse.serializer(), """{"status":"verified","signedIn":true}""")
        assertEquals("verified", s.status)
        assertEquals(true, s.signedIn)
        val s2 = YardJson.decodeFromString(AuthStatusResponse.serializer(), """{"status":"signed_in"}""")
        assertNull(s2.signedIn)
        val exchange = YardJson.decodeFromString(AuthAppExchangeResponse.serializer(), """{"result":"signed_in","isNew":true,"shopper":{"id":"u_1"}}""")
        assertEquals("signed_in", exchange.result)
        assertTrue(exchange.isNew)
        assertFalse(exchange.isMfaRequired)
        val mfa = YardJson.decodeFromString(AuthAppExchangeResponse.serializer(), """{"status":"mfa_required","challenge":"c","expiresAt":"x"}""")
        assertTrue(mfa.isMfaRequired)
        assertFalse(mfa.isNew)
    }

    @Test fun bodiesMatchStrictServerSchemas() {
        val api = APIClient.shared
        assertEquals("""{"code":"c1","verifier":"v1"}""", api.encodeBody(AuthAppExchangeBody("c1", "v1")))
        assertEquals("""{"email":"a@b.co","password":"pw","actor":"shopper"}""", api.encodeBody(AuthSignInBody("a@b.co", "pw", "shopper")))
        assertEquals("""{"actor":"shopper","account":"u_ada"}""", api.encodeBody(AuthDemoBody("shopper", "u_ada")))
    }

    @Test fun oauthResultMessagesMatchWebsite() {
        assertEquals("Sign-in was cancelled.", AuthOAuthResult.message("cancelled"))
        assertEquals("This sign-in link expired or could not be verified. Start again.", AuthOAuthResult.message("invalid_state"))
        assertEquals("This account is currently unavailable.", AuthOAuthResult.message("suspended"))
        assertEquals("Sign-in could not be completed.", AuthOAuthResult.message("something_new"))
    }

    @Test fun oauthResultTableMatchesServerCopy() {
        // src/lib/auth/oauth-results.ts OAUTH_RESULT_MESSAGES, verbatim.
        val expected = mapOf(
            "cancelled" to "Sign-in was cancelled.",
            "invalid_state" to "This sign-in link expired or could not be verified. Start again.",
            "error" to "The provider couldn’t complete sign-in. Try again.",
            "not_configured" to "This sign-in provider isn’t configured on Yard yet.",
            "rate_limited" to "Too many sign-in attempts. Wait a few minutes, then try again.",
            "identity_in_use" to "That provider account is connected to another Yard account.",
            "already_linked" to "That provider is already connected to this account.",
            "link_required" to "Sign in with your password before connecting this provider.",
            "email_required" to "The provider didn’t share an email address. Try another sign-in method.",
            "email_unverified" to "That account’s email address isn’t verified with the provider. Verify it there, or sign in another way.",
            "no_brand" to "This account doesn’t have a brand workspace yet. Apply to sell on Yard to open one, or sign in with the account your brand uses.",
            "suspended" to "This account is currently unavailable.",
            "team_account" to "This is a Yard team account, so it can’t shop. Sign in with a different account.",
            "account_unavailable" to "This Yard account is being deleted or is no longer available. Sign in with a different account.",
            "reauth_mismatch" to "The provider account didn’t match the account being confirmed.",
        )
        assertEquals(expected, AuthOAuthResult.MESSAGES)
        for ((result, words) in expected) {
            // Known results always use the app's own words, whatever the server sent.
            assertEquals(words, AuthOAuthResult.message(result, "Server words"))
        }
    }

    @Test fun unknownResultShowsServerMessageOrFallback() {
        assertEquals("Brand new refusal.", AuthOAuthResult.message("brand_new", "Brand new refusal."))
        assertEquals("Brand new refusal.", AuthOAuthResult.message("brand_new", "  Brand new\n\trefusal.  "))
        assertEquals("Sign-in could not be completed.", AuthOAuthResult.message("brand_new", null))
        assertEquals("Sign-in could not be completed.", AuthOAuthResult.message("brand_new", "   "))
        assertEquals("Sign-in could not be completed.", AuthOAuthResult.message("brand_new"))
    }

    @Test fun successResultNeverShowsServerMessage() {
        for (result in listOf("signed_in", "linked", "reauthed")) {
            assertEquals("Sign-in could not be completed.", AuthOAuthResult.message(result, "Injected words"))
        }
    }

    @Test fun serverMessageIsPlainTrimmedAndCapped() {
        assertNull(AuthOAuthResult.serverMessage(null))
        assertNull(AuthOAuthResult.serverMessage(" \u0000\n "))
        assertEquals("a b c", AuthOAuthResult.serverMessage("a\u0007b\r\n  c"))
        val exact = "x".repeat(AuthOAuthResult.MESSAGE_LIMIT)
        assertEquals(exact, AuthOAuthResult.serverMessage(exact))
        val long = AuthOAuthResult.serverMessage("y".repeat(1000))!!
        assertEquals(AuthOAuthResult.MESSAGE_LIMIT, long.length)
        assertTrue(long.endsWith("…"))
        // A cut never splits a surrogate pair.
        val emoji = AuthOAuthResult.serverMessage("z".repeat(AuthOAuthResult.MESSAGE_LIMIT - 2) + "\uD83D\uDE00".repeat(5))!!
        assertFalse(Character.isHighSurrogate(emoji[emoji.length - 2]))
        assertTrue(emoji.length <= AuthOAuthResult.MESSAGE_LIMIT)
    }

    @Test fun onboardingSplitAndJoin() {
        assertEquals(listOf("tops", "outerwear"), AuthOnboarding.split("tops,,outerwear,"))
        assertTrue(AuthOnboarding.split("").isEmpty())
        assertEquals("tops,outerwear", AuthOnboarding.join(listOf("tops", "outerwear")))
    }
}
