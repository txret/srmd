package opensource.txret.srmd

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The bridge's message format (Messages.kt): requests decoded, replies, errors and events encoded. */
class MessagesTest {
    /** A request has an id, a method and params, which default to none; anything else is not a request. */
    @Test
    fun requestsDecodeTheirIdMethodAndParams() {
        val request = parseRequest("""{"id": 7, "method": "files.read", "params": {"path": "a.sr.md"}}""")!!
        assertEquals(7L, request.id)
        assertEquals("files.read", request.method)
        assertEquals("a.sr.md", request.params.getString("path"))
        assertEquals(0, parseRequest("""{"id": 8, "method": "app.start"}""")!!.params.length())
        assertNull(parseRequest("""{"method": "app.start"}"""))
        assertNull(parseRequest("not json"))
        assertNull(parseRequest("""{"event": "back"}"""))
    }

    /** Replies carry their request's id with a result or an error; events carry their name and params. */
    @Test
    fun repliesAndEventsEncodeAsThePageReadsThem() {
        val reply = JSONObject(replyMessage(3, JSONObject().put("mtime", 12L)))
        assertEquals(3L, reply.getLong("id"))
        assertEquals(12L, reply.getJSONObject("result").getLong("mtime"))
        val error = JSONObject(errorMessage(4, "conflict", "a.sr.md changed"))
        assertEquals(4L, error.getLong("id"))
        assertEquals("conflict", error.getJSONObject("error").getString("code"))
        assertEquals("a.sr.md changed", error.getJSONObject("error").getString("message"))
        val event = JSONObject(eventMessage("resume", JSONObject().put("away", 1200L)))
        assertEquals("resume", event.getString("event"))
        assertEquals(1200L, event.getJSONObject("params").getLong("away"))
        assertEquals(0, JSONObject(eventMessage("back")).getJSONObject("params").length())
    }
}
