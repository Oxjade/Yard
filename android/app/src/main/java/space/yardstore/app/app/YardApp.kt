package space.yardstore.app.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import coil3.memory.MemoryCache
import coil3.network.okhttp.OkHttpNetworkFetcherFactory
import coil3.request.crossfade
import okio.Path.Companion.toOkioPath
import space.yardstore.app.core.Config
import space.yardstore.app.features.liveactivity.LiveTrackingManager
import space.yardstore.app.features.notifications.YardNotificationChannels
import space.yardstore.app.features.notifications.YardPushCenter

/**
 * App entry: creates the shared stores once (iOS `YardApp`'s `@State` stores) and configures the
 * image pipeline (iOS `ImagePipeline`): Coil over the same OkHttp client (cookies +
 * `X-Yard-Client`), 25% memory cache, 300 MB disk cache.
 */
class YardApp : Application(), SingletonImageLoader.Factory {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        Config.init(this)
        container = AppContainer(this)
        // Notification channels (drops, orders, messages…) and the ongoing order-tracking
        // notification (needs `container` for its sign-out listener, so after it).
        YardNotificationChannels.create(this)
        // Push: restores the FCM token and unregisters it before every sign-out.
        YardPushCenter.install(this, container.session)
        LiveTrackingManager.install(this)
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context)
            .components { add(OkHttpNetworkFetcherFactory(callFactory = { container.api.http })) }
            .memoryCache { MemoryCache.Builder().maxSizePercent(context, 0.25).build() }
            .diskCache {
                DiskCache.Builder()
                    .directory(context.cacheDir.resolve("images").toOkioPath())
                    .maxSizeBytes(300L * 1024 * 1024)
                    .build()
            }
            .crossfade(true)
            .build()
}
