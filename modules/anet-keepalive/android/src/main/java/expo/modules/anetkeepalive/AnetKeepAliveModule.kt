package expo.modules.anetkeepalive

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class AnetKeepAliveModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AnetKeepAlive")

    // Returns null on success, or a short reason. Never throws into JS: keeping the connection
    // in the background is a convenience, a failure must not take the settings screen down.
    Function("start") { title: String, text: String ->
      val context = appContext.reactContext ?: return@Function "no_context"
      try {
        val intent = Intent(context, AnetKeepAliveService::class.java)
          .putExtra(AnetKeepAliveService.EXTRA_TITLE, title)
          .putExtra(AnetKeepAliveService.EXTRA_TEXT, text)
        ContextCompat.startForegroundService(context, intent)
        null
      } catch (e: Exception) {
        // Android 12+ ForegroundServiceStartNotAllowedException when called from the background.
        e.javaClass.simpleName + ": " + (e.message ?: "")
      }
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function Unit
      context.stopService(Intent(context, AnetKeepAliveService::class.java))
      Unit
    }

    Function("isRunning") {
      AnetKeepAliveService.running
    }

    // 0.2.109「免打扰时仍然提醒」: a channel's bypassDnd only sticks once the user has granted this
    // app notification-policy (DND) access. null = unknown (no context).
    Function("isNotificationPolicyAccessGranted") {
      val context = appContext.reactContext ?: return@Function null
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        ?: return@Function null
      manager.isNotificationPolicyAccessGranted
    }

    // NotificationManager.getCurrentInterruptionFilter(): 1 = all (DND off), 2 = priority,
    // 3 = none, 4 = alarms, 0 = unknown. Diagnostics only.
    Function("currentInterruptionFilter") {
      val context = appContext.reactContext ?: return@Function null
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        ?: return@Function null
      manager.currentInterruptionFilter
    }
  }
}
