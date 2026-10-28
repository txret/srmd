package opensource.txret.srmd

import org.json.JSONException
import org.json.JSONObject

/**
 * The bridge's message format (ARCHITECTURE.md, "Bridge messages"): JSON text, requests from the page with an id,
 * replies with the same id, and events from the shell.
 */

/** A request from the page: [id] identifies its reply, [method] what to do, [params] its arguments. */
data class Request(val id: Long, val method: String, val params: JSONObject)

/** A refusal the page receives as an error reply, with one of the bridge's error codes, such as `not_found`. */
class BridgeException(val code: String, message: String) : Exception(message)

/** The request in [text], or null when it is not one: the page only sends requests, so anything else is dropped. */
fun parseRequest(text: String): Request? = try {
    val json = JSONObject(text)
    Request(json.getLong("id"), json.getString("method"), json.optJSONObject("params") ?: JSONObject())
} catch (_: JSONException) {
    null
}

/** The reply to request [id] with its [result]. */
fun replyMessage(id: Long, result: JSONObject): String =
    JSONObject().put("id", id).put("result", result).toString()

/** The reply refusing request [id], with an error [code] and a [message] for the log. */
fun errorMessage(id: Long, code: String, message: String): String =
    JSONObject().put("id", id).put("error", JSONObject().put("code", code).put("message", message)).toString()

/** An event, such as `back`, with its [params]. */
fun eventMessage(event: String, params: JSONObject = JSONObject()): String =
    JSONObject().put("event", event).put("params", params).toString()
