package expo.modules.t3agentnotifications

import org.json.JSONException
import org.json.JSONObject

/**
 * D3 Code fork: servers push agent activity through Expo, which wraps the
 * message's data as a JSON string in the FCM data key `body`. Returns the
 * flattened relay-shaped data, or null for any other message.
 */
internal fun expoPushAgentActivity(data: Map<String, String>): Map<String, String>? {
  val body = data["body"] ?: return null
  return try {
    val json = JSONObject(body)
    if (json.optString("t3_kind") == "agent_activity") {
      json.keys().asSequence()
        .filterNot { json.isNull(it) }
        .associateWith { json.get(it).toString() }
    } else {
      null
    }
  } catch (_: JSONException) {
    null
  }
}
