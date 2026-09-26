package expo.modules.anetkeepalive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * 「后台保持连接」: a foreground service that runs one never-ending headless JS task.
 *
 * Why a headless task and not just a foreground service: React Native pauses JS timers when the
 * activity is paused (JavaTimerManager.onHostPause) and only resumes them while a headless JS task
 * is active. A bare foreground service keeps the *process* alive but the hub polling
 * (setTimeout) would still stop. The task itself (registered in index.ts as "AnetKeepAlive")
 * just waits until JS stops it; the polling lives in src/notifier-runtime.ts.
 *
 * Same structure as react-native-background-actions 4.x (the de-facto library for this), minus
 * the parts we do not use; kept local so the manifest entry (foregroundServiceType, Android 14+)
 * ships with the code instead of needing a separate config plugin.
 */
class AnetKeepAliveService : HeadlessJsTaskService() {
  companion object {
    const val TASK_NAME = "AnetKeepAlive"
    const val CHANNEL_ID = "anet-keepalive"
    const val NOTIFICATION_ID = 0x414E6574 // "ANet"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    @Volatile
    var running: Boolean = false
      private set
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Agent Network"
    val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Agent Network 正在保持连接"
    createChannel()
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING
    } else {
      0
    }
    try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(title, text), type)
    } catch (e: Exception) {
      // ForegroundServiceStartNotAllowedException (Android 12+, started from the background, e.g. a
      // system restart after the process was killed) or a type/permission mismatch. Give up quietly
      // instead of crashing the app; JS sees isRunning() == false and the toggle says so.
      running = false
      stopSelf(startId)
      return START_NOT_STICKY
    }
    running = true
    return super.onStartCommand(intent, flags, startId)
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig =
    // timeout 0 = no timeout; allowedInForeground = true, the app is usually in the foreground
    // when the user turns this on.
    HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), 0, true)

  override fun onDestroy() {
    running = false
    super.onDestroy()
  }

  // Android 15 time limits: remoteMessaging has none today, but if the system ever times the
  // service out, stop instead of being killed with an ANR-style crash.
  override fun onTimeout(startId: Int) {
    running = false
    stopSelf()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    running = false
    stopSelf()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, "后台保持连接", NotificationManager.IMPORTANCE_LOW)
    channel.description = "开启「后台保持连接」时显示的常驻通知"
    channel.setShowBadge(false)
    manager.createNotificationChannel(channel)
  }

  private fun buildNotification(title: String, text: String): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
      ?: Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(packageName)
    val content = PendingIntent.getActivity(
      this,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    // expo-notifications' config plugin writes the monochrome status-bar icon as
    // drawable/notification_icon; fall back to the launcher icon if it is missing.
    val iconId = resources.getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(iconId)
      .setContentIntent(content)
      .setOngoing(true)
      .setShowWhen(false)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }
}
