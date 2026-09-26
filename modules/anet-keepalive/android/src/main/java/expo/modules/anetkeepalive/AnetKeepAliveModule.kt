package expo.modules.anetkeepalive

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
  }
}
