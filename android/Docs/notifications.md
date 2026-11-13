# Notifications (Android, owner: notifications)

Package: `app/src/main/java/space/yardstore/app/features/notifications/`. Mirrors `ios/Yard/Features/Notifications/`.

| File | What |
|---|---|
| `NotificationsView.kt` | `NotificationsView()` (`Route.Notifications`): top bar with **Mark all as read** (glass ✓, dimmed when nothing is unread), display header + subtitle, All / Unread `SegmentedPill`, **Today / Earlier** cards, `NotificationsListRow` (kind icon tile, title, body, "Kind · 3h ago", violet unread dot). Tap opens the route and marks it read; long-press opens a small menu with Mark as read / unread (the iOS context menu). Pull to refresh (`PullToRefreshBox`). Skeleton, empty, unread-empty, error and signed-out states. Light/dark previews. |
| `NotificationsViewModel.kt` | Loader/marker, optimistic with rollback (`setRead`, `markAllRead` run in `viewModelScope`, report errors via callback → toast). |
| `NotificationsModels.kt` | `ShopperNotification`, lossy `NotificationsListResponse`, `NotificationsReadBody/Result`, `ShopperNotificationKind` (category → icon/label), `NotificationsRouting.route(href)`. |
| `NotificationsPush.kt` | `NotificationsPermission`, `rememberNotificationsPermissionRequest`, `YardNotificationChannels`, `YardPushCenter`, `YardPushNotifications()` root host, the soft "Never miss a drop" sheet. |

Tests: `app/src/test/java/space/yardstore/app/features/notifications/NotificationsTest.kt` (MockWebServer).

## Endpoints

- `GET /api/notifications?as=shopper` → `{ items: [notificationDto] }`.
- `POST /api/notifications/read?as=shopper` `{ keys: [key], read }` or `{ all: true }` (nulls are never sent; the route is `.strict()`).

## Permission (Android 13+ `POST_NOTIFICATIONS`, declared in the manifest)

- `NotificationsPermission.status(context)` → `NotDetermined` / `Denied` / `Authorized`. Android can't tell "never asked" from "denied", so Yard stores `yard.push.permissionRequested` (SharedPreferences `yard.push`) when it shows the system prompt. Android ≤ 12: no runtime prompt, never `NotDetermined`.
- Soft prompt timing as iOS: after the first Follow (watched by `YardPushNotifications()`), or `NotificationsPermission.didSetDropReminder(context, dropName)` from Drops. "Not now" waits 7 days (`yard.push.softPromptDeclinedAt`).
- You › Notification settings: `val request = rememberNotificationsPermissionRequest { allowed -> }`, `NotificationsPermission.status(context)`, `NotificationsPermission.openSystemSettings(context)`.

## Channels

`YardNotificationChannels.create(context)` (idempotent) creates `drops`, `orders`, `messages`, `following`, `wishlist`, `account`, `general`. `YardNotificationChannels.idFor(category)` / `idFor(kind)` picks one. The live-activity agent's ongoing order notification should use `ORDERS`.

## Foundation wiring needed (orchestrator — foundation files are read-only here)

1. `RootView`: compose `YardPushNotifications()` once, inside the store/router providers (hosts the soft prompt, creates channels, routes taps).
2. `YardApp.onCreate`: `YardNotificationChannels.create(this)` (optional; the host also does it).
3. `MainActivity` (onCreate/onNewIntent): `intent.getStringExtra(YardPushCenter.EXTRA_HREF)?.let { YardPushCenter.handleTap(it) }` for notification taps.
Until 1 is done, no soft prompt appears (the in-app list works regardless).

## Not mirrored

- **Remote push**: no Firebase/FCM (new dependency + `google-services.json`) and no server device-token endpoint. `YardPushCenter.didRegister(context, token)` / `uploadTokenIfPossible()` are the hook points (suggested `POST /api/notifications/devices { token, platform: "android" }`).
- iOS `registerForRemoteNotifications` on launch/grant: nothing to register on Android without FCM.
- Context menu → `DropdownMenu` on long-press.
- No realtime refresh and no unread badge elsewhere (same as iOS).
