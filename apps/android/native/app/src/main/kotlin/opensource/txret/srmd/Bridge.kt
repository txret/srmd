package opensource.txret.srmd

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.FileNotFoundException
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask

/** What the bridge needs from the activity: actions on the UI thread, and the window's state. */
interface Host {
    /** Show the system folder picker; [done] receives the folder the user picked and the app may now use, or null. */
    fun pickRoot(done: (Uri?) -> Unit)

    /** Open a document in the Android app for its [type]; false when no app opens it. */
    fun openFile(uri: Uri, type: String?): Boolean

    /** Open a URL outside the app, such as a web page in the browser; false when no app opens it. */
    fun openUrl(url: String): Boolean

    /** Whether Back goes to the page, which closes what is open, instead of leaving the app. */
    fun setBackHandled(handled: Boolean)

    /** Show the keyboard for the page's focused field; the WebView shows it by itself only for a field tapped. */
    fun showKeyboard()

    /** The system bars' and keyboard's insets in CSS pixels (see the `insets` event). */
    val insets: JSONObject

    /** The user's language, as a BCP 47 tag such as `sv-SE`. */
    val language: String
}

/**
 * The shell's end of the page's message channel, registered for the app's origin only (ARCHITECTURE.md, "Bridge
 * messages"). Messages arrive on the UI thread. Quick actions whose order matters, such as back.set, run there at once;
 * file access runs on a small thread pool, and replies return through the UI thread, as the channel requires.
 */
class Bridge(private val host: Host, private val storage: NoteStorage, private val settings: SettingsStore) :
    WebViewCompat.WebMessageListener {
    /** Threads for file access, so reads and scans never block the UI; four let a read pass a long scan. */
    private val io = Executors.newFixedThreadPool(4)
    private val main = Handler(Looper.getMainLooper())

    /** The page's end of the channel, from its latest message; events go there. A reloaded page sends anew. */
    private var page: JavaScriptReplyProxy? = null

    /** Answer a request from the page; messages from frames or origins other than the app's never get here. */
    override fun onPostMessage(view: WebView, message: WebMessageCompat, sourceOrigin: Uri, isMainFrame: Boolean, replyProxy: JavaScriptReplyProxy) {
        /* Decode the request, then answer it on the thread its method needs. */
        if (!isMainFrame) return
        val request = message.data?.let(::parseRequest) ?: return
        page = replyProxy
        when (request.method) {
            "back.set", "link.open", "settings.set", "keyboard.show" -> replyProxy.postMessage(respond(request) { onMainThread(request) })
            "root.pick" -> host.pickRoot { uri ->
                io.execute {
                    val text = respond(request) {
                        if (uri != null) storage.root = uri
                        JSONObject().put("root", if (uri == null) JSONObject.NULL else rootJson())
                    }
                    main.post { replyProxy.postMessage(text) }
                }
            }
            else -> io.execute {
                val text = respond(request) { inBackground(request) }
                main.post { replyProxy.postMessage(text) }
            }
        }
    }

    /** Send an event to the page, once it has spoken; call on the UI thread. */
    fun send(event: String, params: JSONObject = JSONObject()) {
        page?.postMessage(eventMessage(event, params))
    }

    /** Stop the file access threads once their requests finished, when the activity ends. */
    fun close() {
        io.shutdown()
    }

    /** The reply to [request]: [handle]'s result, or the error its failure maps to. */
    private fun respond(request: Request, handle: () -> JSONObject): String = try {
        replyMessage(request.id, handle())
    } catch (error: Exception) {
        val code = when (error) {
            is BridgeException -> error.code
            is FileNotFoundException -> "not_found"
            is SecurityException -> "denied"
            else -> "io"
        }
        errorMessage(request.id, code, error.message ?: error.javaClass.simpleName)
    }

    /** The requests answered on the UI thread, in the order they arrive, as Android's views require. */
    private fun onMainThread(request: Request): JSONObject {
        val params = request.params
        when (request.method) {
            "back.set" -> host.setBackHandled(params.getBoolean("handled"))
            "link.open" -> if (!host.openUrl(params.getString("url"))) throw BridgeException("no_app", "No app opens ${params.getString("url")}")
            "settings.set" -> settings.settings = params.getJSONObject("settings").toString()
            "keyboard.show" -> host.showKeyboard()
        }
        return JSONObject()
    }

    /** The requests answered on a background thread: everything that reads or writes files. */
    private fun inBackground(request: Request): JSONObject {
        val params = request.params
        return when (request.method) {
            "app.start" -> JSONObject()
                .put("settings", settings.settings?.let(::JSONObject) ?: JSONObject.NULL)
                .put("root", if (storage.root == null) JSONObject.NULL else rootJson())
                .put("language", host.language)
                .put("insets", host.insets)
            "files.scan" -> {
                val skip = params.getJSONArray("skip").let { list -> List(list.length()) { list.getString(it) } }
                JSONObject().put("entries", JSONArray(storage.scan(skip).map { it.toJson() }))
            }
            "files.read" -> storage.read(params.getString("path")).let {
                JSONObject().put("text", it.text).put("mtime", it.mtime).put("size", it.size)
            }
            "files.load" -> JSONObject().put("text", storage.load(params.getString("path")))
            "files.write" -> {
                val expected = if (params.has("expected_mtime")) params.getLong("expected_mtime") else null
                val stat = storage.write(params.getString("path"), params.getString("text"), expected)
                JSONObject().put("mtime", stat.mtime).put("size", stat.size)
            }
            "files.open" -> {
                val path = params.getString("path")
                val uri = storage.document(path)
                val type = storage.type(uri) ?: mimeType(path)
                if (!onUiThread { host.openFile(uri, type) }) throw BridgeException("no_app", "No app opens $path")
                JSONObject()
            }
            else -> throw BridgeException("io", "Unknown method ${request.method}")
        }
    }

    /**
     * The notes folder as the page knows it, by name; null when it can no longer be read, as after access was revoked
     * or the folder was deleted: the page then asks for a folder again.
     */
    private fun rootJson(): Any = try {
        JSONObject().put("name", storage.name())
    } catch (_: Exception) {
        JSONObject.NULL
    }

    /** Run [action] on the UI thread and wait for its result, from a background thread. */
    private fun <T> onUiThread(action: () -> T): T {
        val task = FutureTask(action)
        main.post(task)
        return task.get()
    }
}

/** A file entry as the page receives it. */
private fun FileEntry.toJson(): JSONObject = JSONObject().put("path", path).put("mtime", mtime).put("size", size)
