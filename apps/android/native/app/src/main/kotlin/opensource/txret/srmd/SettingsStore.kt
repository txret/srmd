package opensource.txret.srmd

import android.content.Context
import android.net.Uri
import androidx.core.content.edit

/** What the shell keeps between starts in the app's private preferences: the notes folder and the web app's settings. */
class SettingsStore(context: Context) {
    private val preferences = context.getSharedPreferences("srmd", Context.MODE_PRIVATE)

    /** The notes folder's tree URI, whose access the app keeps; null before the user picked one. */
    var root: Uri?
        get() = preferences.getString(ROOT, null)?.let(Uri::parse)
        set(value) = preferences.edit { putString(ROOT, value?.toString()) }

    /** The web app's settings as JSON text, kept without being read here; null before it stored any. */
    var settings: String?
        get() = preferences.getString(SETTINGS, null)
        set(value) = preferences.edit { putString(SETTINGS, value) }

    private companion object {
        const val ROOT = "root"
        const val SETTINGS = "settings"
    }
}
