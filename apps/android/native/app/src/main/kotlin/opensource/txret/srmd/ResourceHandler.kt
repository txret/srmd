package opensource.txret.srmd

import android.content.ContentResolver
import android.content.res.AssetManager
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * What the page loads from its origin, `https://appassets.androidplatform.net` (ARCHITECTURE.md, "URLs"): the web
 * app under /app/ and the notes folder's files under /notes/. Both run on the WebView's loading threads.
 */

/** The web app's page, which the WebView loads at start. */
val APP_PAGE = "https://${WebViewAssetLoader.DEFAULT_DOMAIN}/app/index.html"

/**
 * Whether the WebView may load [url] as its page: the web app's page alone. The page renders the HTML notes hold, and
 * its origin also serves the notes folder, so a note could otherwise point the page at an HTML file of the folder, whose
 * scripts would run with the bridge, which listens to the origin.
 */
fun isAppPage(url: String): Boolean = url == APP_PAGE

/** Types of the web app's files and of common note resources that Android's own table may lack. */
private val knownTypes = mapOf(
    "html" to "text/html", "js" to "text/javascript", "css" to "text/css", "map" to "application/json",
    "svg" to "image/svg+xml", "webp" to "image/webp", "md" to "text/markdown"
)

/** An empty response with an HTTP [status] and its [reason], such as for a file that cannot be read. */
fun emptyResponse(status: Int, reason: String): WebResourceResponse =
    WebResourceResponse("text/plain", "utf-8", status, reason, emptyMap(), ByteArrayInputStream(ByteArray(0)))

/** The MIME type for a file name's extension, or a generic binary type. */
fun mimeType(path: String): String {
    val extension = path.substringAfterLast('/').substringAfterLast('.', "").lowercase()
    return knownTypes[extension] ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
}

/** The web app, from the APK's assets/web/, which the web build writes. */
class AppHandler(private val assets: AssetManager) : WebViewAssetLoader.PathHandler {
    /** The asset at [path] below assets/web/, or null, which leaves the request unanswered: a 404 in the page. */
    override fun handle(path: String): WebResourceResponse? = try {
        WebResourceResponse(mimeType(path), "utf-8", assets.open("web/$path"))
    } catch (_: IOException) {
        null
    }
}

/**
 * The notes folder's files, such as a note's images. Paths resolve only below the folder (see NoteStorage.document()),
 * so the page reaches nothing else of the device.
 */
class ResourceHandler(private val storage: NoteStorage, private val resolver: ContentResolver) : WebViewAssetLoader.PathHandler {
    /** The file at [path], or a 404 response when it cannot be read. */
    override fun handle(path: String): WebResourceResponse = try {
        val stream = resolver.openInputStream(storage.document(path)) ?: throw IOException("Cannot open $path")
        WebResourceResponse(mimeType(path), null, stream)
    } catch (_: Exception) {
        emptyResponse(404, "Not Found")
    }
}
