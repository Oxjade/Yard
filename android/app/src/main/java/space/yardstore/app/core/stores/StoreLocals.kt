package space.yardstore.app.core.stores

import androidx.compose.runtime.staticCompositionLocalOf
import space.yardstore.app.core.AppearanceStore

// The app-scoped stores, provided at the root (`RootView`) and by `YardPreview` for previews.
// iOS: `@Environment(SessionStore.self) private var session` → Kotlin: `val session = LocalSessionStore.current`.

val LocalSessionStore = staticCompositionLocalOf<SessionStore> { error("SessionStore not provided (wrap in RootView or YardPreview)") }
val LocalCartStore = staticCompositionLocalOf<CartStore> { error("CartStore not provided (wrap in RootView or YardPreview)") }
val LocalFollowStore = staticCompositionLocalOf<FollowStore> { error("FollowStore not provided (wrap in RootView or YardPreview)") }
val LocalSavedStore = staticCompositionLocalOf<SavedStore> { error("SavedStore not provided (wrap in RootView or YardPreview)") }
/** The appearance setting (null in previews). */
val LocalAppearanceStore = staticCompositionLocalOf<AppearanceStore?> { null }
