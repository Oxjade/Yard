package space.yardstore.app.designsystem

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * The app's haptic vocabulary (owner rule: haptics on every interaction). Every pattern goes
 * through `View.performHapticFeedback`, which honours the system's "Touch feedback" / vibration
 * settings (we never pass `FLAG_IGNORE_GLOBAL_SETTING`), so a person who turned haptics off feels
 * nothing.
 *
 *   val haptics = rememberYardHaptics()
 *   haptics.tick()        // a chip, a tab, a toggle, a stepper step
 *   haptics.click()       // a button
 *   haptics.slideTick()   // rising ticks while a slide-to-complete moves
 *   haptics.confirm()     // a slide reached its end, a step completed
 *   haptics.success()     // a submit worked (two pulses)
 *   haptics.reject()      // an error
 */
enum class YardHaptic { Tick, Click, SlideTick, Threshold, Confirm, Reject }

object YardHapticConstants {
    /** The `HapticFeedbackConstants` value for [kind] on API [sdk] (newer constants fall back gracefully). */
    fun constantFor(kind: YardHaptic, sdk: Int = Build.VERSION.SDK_INT): Int = when (kind) {
        YardHaptic.Tick -> if (sdk >= 34) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
        YardHaptic.Click -> HapticFeedbackConstants.CONTEXT_CLICK
        YardHaptic.SlideTick -> if (sdk >= 34) HapticFeedbackConstants.SEGMENT_FREQUENT_TICK else HapticFeedbackConstants.CLOCK_TICK
        YardHaptic.Threshold -> when {
            sdk >= 34 -> HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE
            sdk >= 30 -> HapticFeedbackConstants.CONFIRM
            else -> HapticFeedbackConstants.LONG_PRESS
        }
        YardHaptic.Confirm -> if (sdk >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.LONG_PRESS
        YardHaptic.Reject -> if (sdk >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
    }
}

/** Haptics bound to a [View] (the composition's view). See the file comment. */
class YardHaptics(private val view: View?) {
    fun perform(kind: YardHaptic) {
        val v = view ?: return
        runCatching { v.performHapticFeedback(YardHapticConstants.constantFor(kind)) }
    }

    fun tick() = perform(YardHaptic.Tick)
    fun click() = perform(YardHaptic.Click)
    fun slideTick() = perform(YardHaptic.SlideTick)
    fun threshold() = perform(YardHaptic.Threshold)
    fun confirm() = perform(YardHaptic.Confirm)
    fun reject() = perform(YardHaptic.Reject)

    /** The success pattern: a confirm, then a lighter second pulse 110 ms later. */
    fun success() {
        perform(YardHaptic.Confirm)
        view?.postDelayed({ perform(YardHaptic.Tick) }, 110)
    }
}

/** [YardHaptics] for the current view. */
@Composable
fun rememberYardHaptics(): YardHaptics {
    val view = LocalView.current
    return remember(view) { YardHaptics(view) }
}
