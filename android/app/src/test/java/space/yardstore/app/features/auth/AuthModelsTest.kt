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

    @Test fun onboardingSplitAndJoin() {
        assertEquals(listOf("tops", "outerwear"), AuthOnboarding.split("tops,,outerwear,"))
        assertTrue(AuthOnboarding.split("").isEmpty())
        assertEquals("tops,outerwear", AuthOnboarding.join(listOf("tops", "outerwear")))
    }
}
