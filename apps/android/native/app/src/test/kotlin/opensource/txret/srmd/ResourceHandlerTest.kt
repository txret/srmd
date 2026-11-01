package opensource.txret.srmd

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the WebView may load from the app's origin as its page (ResourceHandler.kt). */
class ResourceHandlerTest {
    /**
     * Only the web app's page loads as the page: no file of the notes folder, which a note's HTML could point the page
     * at, no other address of the app's origin, and no other origin's page at the same path.
     */
    @Test
    fun onlyTheWebAppsPageLoadsAsThePage() {
        assertTrue(isAppPage("https://appassets.androidplatform.net/app/index.html"))
        assertFalse(isAppPage("https://appassets.androidplatform.net/notes/evil.html"))
        assertFalse(isAppPage("https://appassets.androidplatform.net/notes/topic/a.sr.md"))
        assertFalse(isAppPage("https://appassets.androidplatform.net/app/other.html"))
        assertFalse(isAppPage("https://appassets.androidplatform.net/app/index.html?page"))
        assertFalse(isAppPage("http://appassets.androidplatform.net/app/index.html"))
        assertFalse(isAppPage("https://example.com/app/index.html"))
    }
}
