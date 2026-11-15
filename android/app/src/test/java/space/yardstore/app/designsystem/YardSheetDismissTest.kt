package space.yardstore.app.designsystem

import android.app.Application
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SheetValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.test.espresso.Espresso
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import space.yardstore.app.designsystem.components.YardDialogSheet
import space.yardstore.app.designsystem.components.YardDialogSheetTags
import space.yardstore.app.designsystem.components.yardSheetAllowsGestureDismiss

/** Sheets with input never close from a scrim tap or swipe; × and back still close them. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class, qualifiers = "w1280dp-h800dp-land-hdpi")
class YardSheetDismissTest {
    @get:Rule val compose = createComposeRule()

    @OptIn(ExperimentalMaterial3Api::class)
    @Test fun gestureDismissRule() {
        assertTrue(yardSheetAllowsGestureDismiss(SheetValue.Hidden, dismissOnScrimTap = true))
        assertFalse(yardSheetAllowsGestureDismiss(SheetValue.Hidden, dismissOnScrimTap = false))
        assertFalse(yardSheetAllowsGestureDismiss(SheetValue.Hidden, dismissOnScrimTap = true, canDismiss = false))
        // Moving between expanded and partially expanded (keyboard, drags) is always fine.
        assertTrue(yardSheetAllowsGestureDismiss(SheetValue.Expanded, dismissOnScrimTap = false))
        assertTrue(yardSheetAllowsGestureDismiss(SheetValue.PartiallyExpanded, dismissOnScrimTap = false))
    }

    private fun showDialogSheet(dismissOnScrimTap: Boolean): () -> Int {
        var dismissed by mutableIntStateOf(0)
        var shown by mutableStateOf(true)
        compose.setContent {
            YardTheme(darkTheme = false) {
                if (shown) {
                    YardDialogSheet(onDismissRequest = { dismissed += 1; shown = false }, dismissOnScrimTap = dismissOnScrimTap) {
                        var text by remember { mutableStateOf("") }
                        BasicTextField(text, { text = it }, Modifier.fillMaxWidth().testTag("field"))
                    }
                }
            }
        }
        compose.waitForIdle()
        return { dismissed }
    }

    private fun tapScrimCorner() {
        compose.onNodeWithTag(YardDialogSheetTags.SCRIM, useUnmergedTree = true).performTouchInput { click(Offset(8f, 8f)) }
        compose.waitForIdle()
    }

    @Test fun formSheetIgnoresScrimTapAndTyping() {
        val dismissed = showDialogSheet(dismissOnScrimTap = false)
        compose.onNodeWithTag("field").performClick()
        compose.onNodeWithTag("field").performTextInput("ada@example.com")
        compose.onNodeWithTag(YardDialogSheetTags.CARD, useUnmergedTree = true).performTouchInput { click(center) }
        tapScrimCorner()
        assertEquals(0, dismissed())
        compose.onNodeWithTag(YardDialogSheetTags.CARD, useUnmergedTree = true).assertExists()
    }

    @Test fun formSheetStillClosesWithBack() {
        val dismissed = showDialogSheet(dismissOnScrimTap = false)
        Espresso.pressBack()
        compose.waitForIdle()
        assertEquals(1, dismissed())
    }

    @Test fun pickerSheetClosesOnScrimTapButNotOnCardTap() {
        val dismissed = showDialogSheet(dismissOnScrimTap = true)
        compose.onNodeWithTag(YardDialogSheetTags.CARD, useUnmergedTree = true).performTouchInput { click(center) }
        assertEquals(0, dismissed())
        tapScrimCorner()
        assertEquals(1, dismissed())
    }
}
