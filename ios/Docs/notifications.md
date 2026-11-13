# Notifications (owner: notifications)

Folder: `ios/Yard/Features/Notifications/`

| File | What |
|---|---|
| `NotificationsView.swift` | `NotificationsView()` (route `.notifications`): the in-app list. Title + subtitle, All / Unread pill, groups **Today / Earlier**, icon tile per kind, unread dot (violet), relative time, tap → route + mark read, long-press → mark read/unread, toolbar **Mark all read**, pull to refresh. Skeleton, empty, unread-empty, error and signed-out states. `NotificationsListRow` is the row. |
| `NotificationsViewModel.swift` | `@Observable @MainActor` loader/marker, optimistic with rollback. |
| `NotificationsModels.swift` | `ShopperNotification` (the `notificationDto`), `ShopperNotificationKind` (category → icon/label), `NotificationsRouting.route(for: href)`. |
| `NotificationsPush.swift` | `NotificationsPermission`, `YardPushCenter`, `YardPushAppDelegate`, `.yardPushNotifications()`, the soft "Never miss a drop" sheet. |

## Endpoints

- `GET /api/notifications?as=shopper` → `{ items: [{ id, key, recipient, category, title, body, href|null, at, read }] }` (newest first, max 100).
- `POST /api/notifications/read?as=shopper` with `{ keys: [key], read?: false }` or `{ all: true }` → `{ updated, keys, read }`. Keys are the server **event keys** (`key`), not ids.

Routing of `href` (always a same-origin path): `/inbox?thread=cv_…` → `.conversation(id:)` (handled here because `Route(url:)` doesn't read `thread`), everything else through `Route(url:)` (`/you/orders/{id}`, `/drops/{slug}`, `/products/{slug}`, `/brands/{handle}`, `/wishlist`, `/charts`). Unknown Yard paths open on the website.

Kinds: drop (`drop_update`), order (`delivery_update`, …), message (`new_message`), follow (`followed_activity`, `chart_movement`, …), wishlist (`price_drop`, `back_in_stock`), account, other.

## Foundation: lines to add to `App/YardApp.swift`

```swift
@UIApplicationDelegateAdaptor(YardPushAppDelegate.self) private var pushDelegate   // property in YardApp
...
RootView()
    .environment(...)            // all the existing .environment calls first
    .yardPushNotifications()     // needs Router, FollowStore, SessionStore
```

Also needed in `project.yml` for real pushes: the Push Notifications capability (`aps-environment` entitlement, `development`/`production`). Without it registration fails quietly (`YardPushCenter.registrationError`).

## Permission timing

Never on launch. `.yardPushNotifications()` watches `FollowStore.followedIds`: the first time the shopper taps Follow (one id added after the list has loaded) and the system has never asked, a soft sheet offers notifications; "Turn on" shows the system prompt and registers for remote notifications; "Not now" waits 7 days. Drops agent: after a drop reminder is set, call `NotificationsPermission.didSetDropReminder(dropName:)` (or `didSetDropReminder()`). You agent: `NotificationsPermission.status()` / `request()` / `openSystemSettings()` are available for the notification-settings screen.

## Device token — server gap

The website has **no device-token endpoint** and sends no APNs pushes yet. The token is stored as hex in `UserDefaults` (`yard.push.apnsToken`) and `YardPushCenter.shared.deviceToken`. `YardPushCenter.uploadTokenIfPossible()` is the single place to POST it once the server adds one (suggested `POST /api/notifications/devices { token, platform: "ios", environment }`, shopper auth); it is already called on registration and on every sign-in.

Expected push payload (for the server later): `{ "aps": { "alert": { "title", "body" } }, "href": "/you/orders/ord_1", "key": "<event key>" }`. A tap routes `href` (orders/inbox in the You tab, the rest in Home); no `href` → the notifications list.

## Unfinished

- No realtime (`notification.created` over the web's realtime bus); the list refreshes on open and pull-to-refresh.
- No unread badge elsewhere in the app (no shared bell); `NotificationsViewModel.unreadCount` exists if one is wanted.
- Mark-read on a push tap is not sent (needs the `key` in the payload; the list marks it read when opened from there).
