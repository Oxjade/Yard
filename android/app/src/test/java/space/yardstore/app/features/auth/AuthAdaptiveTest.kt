package space.yardstore.app.features.auth

import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.saveable.SaverScope
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.SavedStateHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import space.yardstore.app.designsystem.YardWindow

/** Tablet layout decisions and state restoration for sign-in / Welcome. */
class AuthAdaptiveTest {
    private fun window(width: Int) = YardWindow(width = width.dp, height = 1000.dp)

    @Test fun signInFillsThePhoneWidth() {
        assertEquals(Dp.Unspecified, signInReadingWidth(YardWindow.Phone))
    }

    @Test fun signInKeepsAReadingWidthOnTablets() {
        assertEquals(SIGN_IN_READING_WIDTH, signInReadingWidth(window(700)))
        assertEquals(SIGN_IN_READING_WIDTH, signInReadingWidth(window(1280)))
        assertEquals(560.dp, SIGN_IN_READING_WIDTH)
    }

    @Test fun welcomeBrandsUseTwoColumnsOnWideWindows() {
        assertEquals(1, welcomeBrandColumns(YardWindow.Phone))
        assertEquals(2, welcomeBrandColumns(window(700)))
        assertEquals(2, welcomeBrandColumns(window(1280)))
    }

    @Test fun welcomePicksRoundTripThroughTheSaver() {
        val scope = SaverScope { true }
        val picks = mutableStateListOf("tops", "outerwear")
        val saved = with(WelcomePicksSaver) { scope.save(picks) }!!
        val restored = WelcomePicksSaver.restore(saved)!!
        assertEquals(listOf("tops", "outerwear"), restored.toList())
    }

    @Test fun signInRestoresTypedInputButNeverThePassword() {
        val handle = SavedStateHandle()
        val first = SignInModel(previewProviders = AuthProviders.preview(), savedState = handle)
        first.toggleMode()
        first.name = "Ada"
        first.email = "ada@example.com"
        first.password = "secret-password"

        val restored = SignInModel(previewProviders = AuthProviders.preview(), savedState = handle)
        assertEquals(SignInModel.Mode.SignUp, restored.mode)
        assertEquals("Ada", restored.name)
        assertEquals("ada@example.com", restored.email)
        assertEquals("", restored.password)
        assertNull(restored.signUpSentTo)
        assertFalse(handle.keys().any { it.contains("password", ignoreCase = true) })
    }

    @Test fun signInWithoutSavedStateStartsEmpty() {
        val model = SignInModel(previewProviders = AuthProviders.preview())
        assertEquals(SignInModel.Mode.SignIn, model.mode)
        assertEquals("", model.name)
        assertEquals("", model.email)
    }
}
