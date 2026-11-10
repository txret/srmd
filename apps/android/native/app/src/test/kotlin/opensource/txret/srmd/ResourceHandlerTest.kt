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

    /** Web, mail, phone, map and message links open outside the app, whatever their case; nothing else does. */
    @Test
    fun onlyLinksOfKnownSchemesOpenOutside() {
        assertTrue(opensOutside("https://example.com/a"))
        assertTrue(opensOutside("HTTP://example.com"))
        assertTrue(opensOutside("mailto:a@example.com"))
        assertTrue(opensOutside("tel:+46123"))
        assertTrue(opensOutside("geo:59.3,18.1"))
        assertTrue(opensOutside("sms:+46123"))
        assertFalse(opensOutside("file:///sdcard/a.html"))
        assertFalse(opensOutside("content://media/1"))
        assertFalse(opensOutside("intent://scan/#Intent;end"))
        assertFalse(opensOutside("javascript:alert(1)"))
        assertFalse(opensOutside("no-scheme"))
    }
}
