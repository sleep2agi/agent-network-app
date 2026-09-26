# Android message notifications (phase 1, no vendor push)

Owner device: Xiaomi foldable, HyperOS, mainland China, no Google Play services. FCM is therefore
unavailable, and phase 1 does not use any push service. Notifications are local
(`expo-notifications`) and fed by the app's own connection to the hub.

## What decides "notify or not"

It is the same function as desktop: `notify-policy.ts` → `decide(agent, presence, settings, minutes)`.

| Situation | Notify? |
|---|---|
| App in foreground, **viewing that agent's chat** | no (this is the only presence-based suppression) |
| App in foreground, viewing another chat, the list, or settings | **yes** (this is the most common case, see below) |
| App in background (JS alive) | yes |
| Master switch off, agent muted for this account, quiet hours | no |

Do not add a precondition like "app must be in the background". Desktop 0.2.81 did exactly that
for click-to-open ("window must be unfocused") and it excluded the main case: the user is in the app
reading A when B writes. See `notify-target.ts`.

## Pipeline

```
hub ──poll (10 s fg / 20 s bg with keep-alive)──► unread-store snapshot ──► notifier-runtime.ts
hub /events/users/me SSE (desktop_message) ──► DesktopMessageListener ──► notifier-bus ──► poll now
notifier-runtime: incomingFromSnapshot → pickNew (first snapshot only seeds) → groupByAgent
                  → decide → plainTextForNotification → accumulate (one notification per agent)
                  → expo-notifications scheduleNotificationAsync(identifier = anet-msg:<profile>:<alias>)
```

* **One notification per agent.** Re-posting the same identifier replaces the notification in place.
  The body becomes `［N 条新消息］<latest preview>`.
* **Channels:** `agent-messages` (HIGH, sound, heads-up) and `agent-messages-quiet` (LOW, silent).
  「仅新消息」 mode sends only the first unseen message on the loud channel and updates the rest
  quietly. With sound off, all messages use the quiet channel, because on Android 8+ the channel,
  not the notification, decides the sound.
* **Cleared** when that chat is open with the app in the foreground (ledger `open`, `AppState`).
* **Tap** routes through the `setScreen({ name: 'chat', alias })` call that phone and two-pane
  layouts already share. On a cold start the tap arrives before the session is restored, so it is
  queued (`takeRoute`) until the account and UI are ready. Taps for another account are ignored.
* **Permission** (`POST_NOTIFICATIONS`, Android 13+) is requested once, after login. It is never
  requested on the login screen. After that, the app asks again only from Settings → 通知. If the
  system refuses to ask again, the app opens the app's notification settings instead.

The runtime is a module-level singleton, not a component. With keep-alive on, the activity can be
destroyed while the process lives on, and polling must continue.

## 后台保持连接 (keep-alive, opt-in, default off)

This is implemented as a local Expo module, `modules/anet-keepalive` (Kotlin, about 150 lines),
autolinked from `./modules`.

* `AnetKeepAliveService extends HeadlessJsTaskService`: `startForeground` with
  `FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING` on API 34+, and a low-importance ongoing notification
  「Agent Network 正在保持连接」.
* The manifest ships inside the module: the `<service android:foregroundServiceType="remoteMessaging"
  android:exported="false">` element, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_REMOTE_MESSAGING` and
  `WAKE_LOCK`. `app.json` lists the same permissions. The `android-build` workflow checks them all on
  the built APK.

**Why a headless JS task and not just a foreground service.** React Native pauses JS timers while the
activity is paused (`JavaTimerManager.onHostPause`). It resumes them only while a headless JS task
is active. A bare foreground service keeps the process alive, but `setTimeout`-driven polling
still stops. The service therefore starts one never-ending headless task (`AnetKeepAlive`,
registered in `index.ts`). Stopping releases the JS promise first and then stops the service.
Stopping only the service would leave RN believing a task is running, and background timers would
keep burning battery.

**Why `remoteMessaging` and not `dataSync`.** On Android 15, `dataSync` is capped at 6 h per 24 h
(`onTimeout`). `remoteMessaging` ("continue transferring text messages from one device to another")
has no cap and describes what the service does. We are not distributed through Play, so the
Play-policy declaration is not a concern.

**Options considered:**

| Option | Verdict |
|---|---|
| `expo-task-manager` + `expo-background-fetch` | WorkManager, minimum 15 min, OS-scheduled. Not realtime. Rejected. |
| `react-native-background-actions` 4.1.0 | Same design (HeadlessJsTaskService + foreground service) and maintained (2026-04). It is still a legacy bridge module, its manifest does not declare `foregroundServiceType` (it would need an extra config plugin), and it has no `remoteMessaging` mapping. We borrowed its structure (ServiceCompat, `ForegroundServiceStartNotAllowedException` handling, `onTimeout`) instead of the dependency. |
| `@supersami/rn-foreground-service` | Older, and also needs manifest edits. Rejected. |
| Local Expo module (chosen) | Expo Modules API (new-architecture native), manifest ships with the code, and no third-party native code. |

**If startForeground is refused** (Android 12+, when started from the background, e.g. a system
restart of a killed process), the service stops itself quietly. The settings row shows the real
state from `isRunning()`, not the toggle value.

## What phase 1 cannot do

* The app gets no notification once its process is dead: swiped away and killed by HyperOS, or
  force-stopped. That needs vendor push (Xiaomi Mi Push) or a persistent socket owned by native
  code. The 「小米/HyperOS 后台设置指引」 entry tells the user how to set 自启动, 省电策略 → 无限制
  and lock the app in recents to make that rarer.
* The hub pushes agent replies to the user (`inbox` rows) over no user-level SSE, only
  `desktop_message` (`user_inbox`) is pushed. Replies arrive through polling: 10 s in the
  foreground, 20 s in the background with keep-alive.
* iOS gets the same local notifications while the app is running. There is no background mode.
