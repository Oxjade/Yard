package space.yardstore.app.designsystem

import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.pow

/** White micro text on the smoked-glass photo capsule must hold 4.5:1 even over a pure white photo. */
class OnPhotoGlassContrastTest {
    private fun linear(c: Double) = if (c <= 0.03928) c / 12.92 else ((c + 0.055) / 1.055).pow(2.4)

    @Test fun whiteTextOnCapsuleOverWhitePhoto() {
        // Black at OnPhotoGlassAlpha composited over white (no blur behind these capsules).
        val channel = 1.0 - OnPhotoGlassAlpha
        val bg = linear(channel)
        val ratio = (1.0 + 0.05) / (bg + 0.05)
        assertTrue("contrast $ratio < 4.5", ratio >= 4.5)
    }
}
