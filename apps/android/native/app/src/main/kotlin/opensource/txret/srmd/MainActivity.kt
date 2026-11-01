package opensource.txret.srmd

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.view.inputmethod.InputMethodManager
import android.webkit.WebView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import kotlin.math.max

/**
 * The app's one window: a WebView showing the web app edge to edge (ARCHITECTURE.md, "Native shell"). The page does
 * everything it can; this activity adds the notes folder and its picker, Back, insets, lifecycle events and intents.
 */
class MainActivity : ComponentActivity(), Host {
    private lateinit var webView: WebView
    private lateinit var store: SettingsStore
    private lateinit var storage: NoteStorage
    private lateinit var bridge: Bridge

    /** The latest insets in CSS pixels, read by the bridge's threads for app.start. */
    @Volatile
    override var insets: JSONObject = JSONObject().put("top", 0).put("bottom", 0).put("left", 0).put("right", 0).put("keyboard", false)
        private set

    override val language: String
        get() = resources.configuration.locales[0].toLanguageTag()

    /** Back for the page, enabled while it reports something open; otherwise Android handles Back, leaving the app. */
    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = bridge.send("back")
    }

    /** Receives the folder of the pending pick, or null when none is pending. */
    private var picked: ((Uri?) -> Unit)? = null
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri -> rootPicked(uri) }

    /** When the app last went to the background, for the away time the page hears on return; 0 before. */
    private var pausedAt = 0L

    /** Create the WebView, connect the bridge, Back and insets, and load the web app. */
    override fun onCreate(savedInstanceState: Bundle?) {
        /*
         * 1. Draw edge to edge: the page pads by the insets it is sent.
         * 2. Without web message listeners, which only an outdated WebView lacks, say so and stop.
         * 3. Restore the notes folder while its access is still granted, then set up the WebView and its handlers.
         */
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            setContentView(TextView(this).apply {
                setText(R.string.webview_outdated)
                setPadding(48, 160, 48, 48)
            })
            return
        }
        store = SettingsStore(this)
        storage = NoteStorage(contentResolver)
        storage.root = store.root?.takeIf { root ->
            contentResolver.persistedUriPermissions.any { it.uri == root && it.isReadPermission && it.isWritePermission }
        }
        bridge = Bridge(this, storage, store)
        webView = createWebView()
        setContentView(webView)
        onBackPressedDispatcher.addCallback(this, back)
        ViewCompat.setOnApplyWindowInsetsListener(webView) { _, windowInsets ->
            updateInsets(windowInsets)
            windowInsets
        }
        webView.loadUrl(APP_PAGE)
    }

    /**
     * A WebView for the web app: scripts and storage on, file and content access off, the app's origin served by the
     * asset loader, and the bridge listening for that origin only.
     */
    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(): WebView {
        /* Match the page's background, so no white flashes in dark mode while it loads. */
        WebView.setWebContentsDebuggingEnabled(applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0)
        val view = WebView(this)
        val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        view.setBackgroundColor(if (night) Color.rgb(0x1f, 0x1f, 0x1f) else Color.WHITE)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            builtInZoomControls = true
            displayZoomControls = false
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/app/", AppHandler(assets))
            .addPathHandler("/notes/", ResourceHandler(storage, contentResolver))
            .build()
        view.webViewClient = object : WebViewClientCompat() {
            /**
             * The origin's files, but as the page only the web app's (isAppPage()): a page load the WebView does not
             * offer shouldOverrideUrlLoading(), such as a form's POST, gets an empty page instead of a note's file.
             */
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                if (request.isForMainFrame && !isAppPage(request.url.toString())) emptyResponse(403, "Forbidden")
                else loader.shouldInterceptRequest(request.url)

            /**
             * The page loads only itself again, as when it reloads; the web app opens links itself. Any other address
             * of the app's origin is refused (see isAppPage()), and other URLs open outside the app.
             */
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url.toString()
                if (isAppPage(url)) return false
                if (request.url.host != WebViewAssetLoader.DEFAULT_DOMAIN) openUrl(url)
                return true
            }
        }
        WebViewCompat.addWebMessageListener(view, "srmd", setOf("https://${WebViewAssetLoader.DEFAULT_DOMAIN}"), bridge)
        return view
    }

    /** Send the page the system bars' insets, or the keyboard's while it shows and is taller, in CSS pixels. */
    private fun updateInsets(windowInsets: WindowInsetsCompat) {
        val bars = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val keyboard = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
        val density = resources.displayMetrics.density
        insets = JSONObject()
            .put("top", bars.top / density)
            .put("bottom", max(bars.bottom, keyboard.bottom) / density)
            .put("left", bars.left / density)
            .put("right", bars.right / density)
            .put("keyboard", windowInsets.isVisible(WindowInsetsCompat.Type.ime()))
        bridge.send("insets", insets)
    }

    override fun pickRoot(done: (Uri?) -> Unit) {
        picked = done
        picker.launch(store.root)
    }

    /**
     * Keep access to a picked folder across restarts and make it the notes folder, giving up the previous one's access.
     * A cancelled pick changes nothing.
     */
    private fun rootPicked(uri: Uri?) {
        val done = picked
        picked = null
        if (uri != null) {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            contentResolver.takePersistableUriPermission(uri, flags)
            val previous = store.root
            if (previous != null && previous != uri) runCatching { contentResolver.releasePersistableUriPermission(previous, flags) }
            store.root = uri
        }
        done?.invoke(uri)
    }

    override fun openFile(uri: Uri, type: String?): Boolean = start(
        Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    )

    override fun openUrl(url: String): Boolean = start(Intent(Intent.ACTION_VIEW, Uri.parse(url)))

    /** Start another app's activity; false when none handles the intent. */
    private fun start(intent: Intent): Boolean = try {
        startActivity(intent)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }

    override fun setBackHandled(handled: Boolean) {
        back.isEnabled = handled
    }

    /**
     * Show the keyboard once the WebView serves input for the field the page just focused. That follows the page's
     * focus() a moment later, and a request before it is ignored, so this tries again every 50 ms for half a second.
     */
    override fun showKeyboard() {
        val manager = getSystemService(InputMethodManager::class.java)
        var attempts = 0
        val attempt = object : Runnable {
            override fun run() {
                if (manager.isActive(webView) && manager.showSoftInput(webView, 0)) return
                if (++attempts < 10) webView.postDelayed(this, 50)
            }
        }
        attempt.run()
    }

    /** Tell the page it goes to the background, where Android may end the app: it keeps an unsaved edit. */
    override fun onPause() {
        super.onPause()
        if (!::bridge.isInitialized) return
        pausedAt = SystemClock.elapsedRealtime()
        bridge.send("pause")
    }

    /** Tell the page how long it was away: after a long time it scans the notes folder again. */
    override fun onResume() {
        super.onResume()
        if (!::bridge.isInitialized || pausedAt == 0L) return
        bridge.send("resume", JSONObject().put("away", SystemClock.elapsedRealtime() - pausedAt))
    }

    /** Release the WebView and the bridge's threads; a recreated activity, as after a theme change, makes new ones. */
    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        if (::bridge.isInitialized) bridge.close()
        super.onDestroy()
    }
}
