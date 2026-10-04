package expo.modules.t3launchermood

import android.content.ComponentName
import android.content.Context
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Shows the D3 cat's mood as the launcher icon by enabling one of the
 * `<activity-alias>` entries that plugins/withAndroidLauncherMoods.cjs declares.
 * The switch waits until the app leaves the foreground, so the launcher never
 * refreshes the app while it is in use. Builds without the aliases ignore it.
 */
class T3LauncherMoodModule : Module() {
  @Volatile private var pendingMood: String? = null
  private var shownMood: String? = null

  override fun definition() = ModuleDefinition {
    Name("T3LauncherMood")

    Function("setLauncherMood") { mood: String -> pendingMood = mood }

    OnActivityEntersBackground {
      val mood = pendingMood
      val context = appContext.reactContext?.applicationContext
      if (mood != null && mood != shownMood && context != null) {
        LauncherMoodAliases.show(context, mood)
        shownMood = mood
      }
    }
  }
}

internal object LauncherMoodAliases {
  private const val TAG = "T3LauncherMood"

  fun show(context: Context, mood: String) {
    val packageManager = context.packageManager
    val prefix = "${context.packageName}.LauncherMood_"
    val aliases = declaredActivities(context).filter { it.name.startsWith(prefix) }
    val target = aliases.find { it.name == prefix + mood } ?: return
    val targetComponent = ComponentName(context.packageName, target.name)

    // Enable the new icon before disabling the old one so the launcher always has an entry.
    if (!isEnabled(packageManager, target)) {
      packageManager.setComponentEnabledSetting(
        targetComponent,
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
        PackageManager.DONT_KILL_APP,
      )
    }
    moveShortcutsTo(context, targetComponent)
    for (alias in aliases) {
      if (alias !== target && isEnabled(packageManager, alias)) {
        packageManager.setComponentEnabledSetting(
          ComponentName(context.packageName, alias.name),
          PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
          PackageManager.DONT_KILL_APP,
        )
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun declaredActivities(context: Context): List<ActivityInfo> =
    context.packageManager
      .getPackageInfo(
        context.packageName,
        PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS,
      )
      .activities
      .orEmpty()
      .toList()

  private fun isEnabled(packageManager: PackageManager, alias: ActivityInfo): Boolean =
    when (packageManager.getComponentEnabledSetting(ComponentName(alias.packageName, alias.name))) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> alias.enabled
      else -> false
    }

  /**
   * Launcher shortcuts belong to a launcher activity, and Android deletes them
   * once that activity is disabled, so they follow the icon to its new alias.
   */
  private fun moveShortcutsTo(context: Context, target: ComponentName) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return
    val shortcutManager = context.getSystemService(ShortcutManager::class.java) ?: return
    try {
      val moved =
        (shortcutManager.dynamicShortcuts + shortcutManager.pinnedShortcuts)
          .filter { it.activity != target }
          .distinctBy { it.id }
          .map { ShortcutInfo.Builder(context, it.id).setActivity(target).build() }
      if (moved.isNotEmpty()) shortcutManager.updateShortcuts(moved)
    } catch (error: IllegalArgumentException) {
      Log.w(TAG, "Could not move launcher shortcuts to $target", error)
    } catch (error: IllegalStateException) {
      Log.w(TAG, "Could not move launcher shortcuts to $target", error)
    }
  }
}
