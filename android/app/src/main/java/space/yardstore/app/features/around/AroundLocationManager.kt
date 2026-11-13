package space.yardstore.app.features.around

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * When-in-use location for Around (iOS `AroundLocationManager`, CLLocationManager → the framework
 * [LocationManager]; no Play services). The fix stays on the device: the server only ever gets the
 * whole-world list (`scope=world`), and distances are computed here.
 *
 * The permission prompt itself needs an Activity result launcher, so the screen owns it:
 * [requestLocation] returns true when the screen must launch the prompt, and the screen reports
 * the answer with [onPermissionResult].
 */
class AroundLocationManager(context: Context) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
    private val prefs = appContext.getSharedPreferences("yard.around", Context.MODE_PRIVATE)

    var isAuthorized by mutableStateOf(hasPermission()); private set
    var location by mutableStateOf<AroundCoordinate?>(null); private set
    /** Changes with every new fix (iOS observes `location?.timestamp`). */
    var fixCount by mutableIntStateOf(0); private set
    /** Bumped on each new fix after the shopper asked to locate them, so the map can fly there once. */
    var requestedFixCount by mutableIntStateOf(0); private set

    private var wantsFix = false
    private var updating = false

    private val listener = LocationListener { fix -> onFix(fix) }

    private fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /**
     * Denied for good: we asked before, it isn't granted and Android won't show the prompt again
     * (iOS `.denied` / `.restricted`).
     */
    fun isDenied(activity: Activity?): Boolean {
        if (isAuthorized || !prefs.getBoolean(ASKED_KEY, false)) return false
        if (activity == null) return true
        return !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.ACCESS_FINE_LOCATION) &&
            !ActivityCompat.shouldShowRequestPermissionRationale(activity, Manifest.permission.ACCESS_COARSE_LOCATION)
    }

    /** Re-reads the permission (the shopper may have changed it in Settings) and starts quietly if granted. */
    fun startIfAuthorized() {
        isAuthorized = hasPermission()
        if (isAuthorized) start()
    }

    @SuppressLint("MissingPermission")
    private fun start() {
        val m = manager ?: return
        if (!hasPermission()) return
        if (location == null) bestLastKnown()?.let { onFix(it) }
        if (updating) return
        val providers = runCatching { m.getProviders(true) }.getOrDefault(emptyList())
            .filter { it == LocationManager.NETWORK_PROVIDER || it == LocationManager.GPS_PROVIDER || it == FUSED_PROVIDER }
        for (p in providers) {
            runCatching { m.requestLocationUpdates(p, 10_000L, 100f, listener, Looper.getMainLooper()) }
                .onSuccess { updating = true }
        }
    }

    fun stop() {
        runCatching { manager?.removeUpdates(listener) }
        updating = false
    }

    /** The locate button: true = launch the permission prompt; otherwise a fresh fix is on its way. */
    fun requestLocation(): Boolean {
        wantsFix = true
        if (!hasPermission()) {
            prefs.edit().putBoolean(ASKED_KEY, true).apply()
            return true
        }
        isAuthorized = true
        start()
        if (location != null) {
            wantsFix = false
            requestedFixCount += 1
        }
        return false
    }

    fun onPermissionResult(granted: Boolean) {
        isAuthorized = granted && hasPermission()
        if (isAuthorized) {
            start()
            if (wantsFix && location != null) {
                wantsFix = false
                requestedFixCount += 1
            }
        } else {
            wantsFix = false
        }
    }

    @SuppressLint("MissingPermission")
    private fun bestLastKnown(): Location? {
        val m = manager ?: return null
        return runCatching {
            m.getProviders(true).mapNotNull { m.getLastKnownLocation(it) }.maxByOrNull { it.time }
        }.getOrNull()
    }

    private fun onFix(fix: Location) {
        location = AroundCoordinate(fix.latitude, fix.longitude)
        fixCount += 1
        if (wantsFix) {
            wantsFix = false
            requestedFixCount += 1
        }
    }

    private companion object {
        const val ASKED_KEY = "locationAsked"
        const val FUSED_PROVIDER = "fused"
    }
}
