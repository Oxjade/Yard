package space.yardstore.app.core

import android.content.Context
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Contrast
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * The user's appearance choice (You › Settings › Appearance), stored in DataStore under
 * [STORAGE_KEY] as its [rawValue]. Mirrors `AppearancePreference` in `Theme.swift`.
 * `MainActivity` observes [AppearanceStore.preference] and applies it at the root.
 */
enum class AppearancePreference(val rawValue: String) {
    SYSTEM("system"),
    LIGHT("light"),
    DARK("dark");

    val title: String
        get() = when (this) {
            SYSTEM -> "System"
            LIGHT -> "Light"
            DARK -> "Dark"
        }

    /** The icon for pickers (iOS: circle.lefthalf.filled / sun.max / moon). */
    val icon: ImageVector
        get() = when (this) {
            SYSTEM -> Icons.Outlined.Contrast
            LIGHT -> Icons.Outlined.LightMode
            DARK -> Icons.Outlined.DarkMode
        }

    /** Resolves to dark or light given the system setting. */
    fun isDark(systemIsDark: Boolean): Boolean = when (this) {
        SYSTEM -> systemIsDark
        LIGHT -> false
        DARK -> true
    }

    companion object {
        /** The DataStore key. */
        const val STORAGE_KEY: String = "appearance"

        fun fromRaw(raw: String?): AppearancePreference = entries.firstOrNull { it.rawValue == raw } ?: SYSTEM
    }
}

private val Context.yardSettings: DataStore<Preferences> by preferencesDataStore(name = "yard_settings")

/**
 * Reads and writes the appearance choice (DataStore preferences, file "yard_settings").
 *
 *   val appearance = LocalAppearanceStore.current
 *   val pref by appearance.preference.collectAsState(AppearancePreference.SYSTEM)
 *   scope.launch { appearance.set(AppearancePreference.DARK) }
 */
class AppearanceStore(context: Context) {
    private val dataStore = context.applicationContext.yardSettings
    private val key = stringPreferencesKey(AppearancePreference.STORAGE_KEY)

    val preference: Flow<AppearancePreference> = dataStore.data.map { AppearancePreference.fromRaw(it[key]) }

    suspend fun set(preference: AppearancePreference) {
        dataStore.edit { it[key] = preference.rawValue }
    }
}
