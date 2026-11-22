package space.yardstore.app.screenshots

import android.app.Application
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import space.yardstore.app.designsystem.YardPreview
import space.yardstore.app.designsystem.YardShapes
import space.yardstore.app.designsystem.yard
import space.yardstore.app.features.sell.RoleSelectionScreen
import space.yardstore.app.features.sell.SellApplicationModel
import space.yardstore.app.features.sell.SellApplicationScreen
import space.yardstore.app.features.sell.SellIllustration
import space.yardstore.app.features.sell.ShopIllustration
import space.yardstore.app.features.sell.StampCelebration

/**
 * Frames of the onboarding animations at fixed times on the test clock (auto-advance off), so the
 * motion can be reviewed as stills: `build/outputs/roborazzi/motion/<scene>-<ms>ms-<dark|light>.png`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], application = Application::class, qualifiers = "w412dp-h915dp-port-xhdpi")
class MotionFramesTest(private val scene: String, private val dark: Boolean) {
    companion object {
        val scenes = listOf("role-selection", "shop-art", "sell-art", "shop-tilt", "sell-success", "add-success")
        val times = listOf(0L, 150L, 350L, 700L, 1500L, 3100L, 4600L)

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun params(): List<Array<Any>> = scenes.flatMap { listOf(arrayOf<Any>(it, true), arrayOf<Any>(it, false)) }
    }

    @get:Rule val compose = createComposeRule()

    @Test fun frames() {
        val context = RuntimeEnvironment.getApplication()
        val server = FakeYardBackend.start(context)
        FakeImages.install(context)
        try {
            compose.mainClock.autoAdvance = false
            compose.setContent { YardPreview(darkTheme = dark) { Scene(scene) } }
            var now = 0L
            for (t in times) {
                compose.mainClock.advanceTimeBy(t - now)
                now = t
                compose.onRoot().captureRoboImage("build/outputs/roborazzi/motion/$scene-${t}ms-${if (dark) "dark" else "light"}.png")
            }
        } finally {
            server.shutdown()
        }
    }

    @Composable
    private fun Scene(name: String) {
        when (name) {
            "role-selection" -> RoleSelectionScreen(firstName = "Ada", onShop = {}, onSell = {})
            "shop-art" -> ArtStage(Color.yard.acid) { ShopIllustration(Modifier.fillMaxSize(), delayMillis = 0) }
            "sell-art" -> ArtStage(Color.yard.onAcid) { SellIllustration(Modifier.fillMaxSize(), delayMillis = 0) }
            // Pressed toward the top right: the layers shift by depth.
            "shop-tilt" -> ArtStage(Color.yard.acid) {
                val tilt = remember { mutableStateOf(Offset(0.9f, -0.8f)) }
                ShopIllustration(Modifier.fillMaxSize(), tilt, delayMillis = 0)
            }
            "sell-success" -> SellApplicationScreen(remember { SellApplicationModel.previewDone(StudioFixtures.categories) }, {}, {})
            "add-success" -> Column(
                Modifier.fillMaxSize().background(Color.yard.acid).padding(16.dp),
                verticalArrangement = Arrangement.Center,
            ) { StampCelebration("LIVE", Modifier.fillMaxWidth().size(220.dp)) }
        }
    }

    @Composable
    private fun ArtStage(bg: Color, content: @Composable () -> Unit) {
        Box(Modifier.fillMaxSize().background(Color.yard.bg), contentAlignment = Alignment.Center) {
            Box(Modifier.size(380.dp).background(bg, YardShapes.card).padding(24.dp)) { content() }
        }
    }
}
