package opensource.txret.srmd

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Paths from the page, skip patterns and decoded texts (Paths.kt). */
class PathsTest {
    /** A path names files below the notes folder only: no empty names, `.` or `..`, so nothing above it is reachable. */
    @Test
    fun pathsStayBelowTheNotesFolder() {
        assertEquals(listOf("topic", "a.sr.md"), pathNames("topic/a.sr.md"))
        assertEquals(listOf("a b.md"), pathNames("a b.md"))
        assertNull(pathNames(""))
        assertNull(pathNames("../secret"))
        assertNull(pathNames("topic/../../secret"))
        assertNull(pathNames("topic//a.md"))
        assertNull(pathNames("/a.md"))
        assertNull(pathNames("./a.md"))
        assertEquals("a.md", childPath("", "a.md"))
        assertEquals("topic/a.md", childPath("topic", "a.md"))
    }

    /** Skip patterns match whole names, `*` any characters, ignoring case; other characters, even `.`, stand for themselves. */
    @Test
    fun skipPatternsMatchWholeNames() {
        assertTrue(skipPattern(".*").matches(".git"))
        assertTrue(skipPattern(".*").matches(".obsidian"))
        assertFalse(skipPattern(".*").matches("a.md"))
        assertTrue(skipPattern("node_modules").matches("node_modules"))
        assertTrue(skipPattern("node_modules").matches("Node_Modules"))
        assertFalse(skipPattern("node_modules").matches("node_modules2"))
        assertTrue(skipPattern("draft-*").matches("draft-1.md"))
        assertFalse(skipPattern("draft.1").matches("draftx1"))
        assertTrue(skipPattern("a(b)+c").matches("a(b)+c"))
    }

    /** Texts decode as UTF-8 without a byte order mark, as VS Code reads them. */
    @Test
    fun textsDecodeWithoutAByteOrderMark() {
        assertEquals("Q:: svar å", decodeText("Q:: svar å".toByteArray()))
        assertEquals("Q:: a", decodeText(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "Q:: a".toByteArray()))
        assertEquals("", decodeText(ByteArray(0)))
    }
}
