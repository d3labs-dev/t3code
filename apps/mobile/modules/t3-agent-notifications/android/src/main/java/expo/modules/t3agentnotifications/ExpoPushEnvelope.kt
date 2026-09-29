package expo.modules.t3agentnotifications

import org.json.JSONException
import org.json.JSONObject

/**
 * D3 Code fork: servers push agent activity through Expo, which wraps the
 * message's data as a JSON string in the FCM data key `body`. Returns the
 * flattened relay-shaped data, or null for any other message.
 */
internal fun expoPushAgentActivity(data: Map<String, String>): Map<String, String>? {
  val json = try {
    JSONObject(data["body"] ?: return null)
  } catch (_: JSONException) {
    return null
  }
  if (json.optString("t3_kind") != "agent_activity") return null
  return json.keys().asSequence()
    .filterNot { json.isNull(it) }
    .associateWith { json.get(it).toString() }
}
