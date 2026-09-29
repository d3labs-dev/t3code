package expo.modules.t3agentnotifications

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

// Robolectric supplies the real org.json that Android's stub jar lacks.
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], manifest = Config.NONE)
class ExpoPushEnvelopeTest {
  private fun expoMessage(body: String) = mapOf(
    "experienceId" to "@d3labs/d3code",
    "scopeKey" to "@d3labs/d3code",
    "body" to body,
  )

  @Test
  fun unwrapsAgentActivityFromTheExpoBody() {
    val data = mapOf(
      "t3_kind" to "agent_activity",
      "device_id" to "device",
      "user_id" to "server-push",
      "updated_at" to "1790000000000",
      "alert_title" to "Test thread",
    )
    assertEquals(data, expoPushAgentActivity(expoMessage(JSONObject(data).toString())))
  }

  @Test
  fun ignoresOtherExpoMessages() {
    assertNull(expoPushAgentActivity(expoMessage("""{"t3_kind":"other","title":"Hi"}""")))
    assertNull(expoPushAgentActivity(expoMessage("not json")))
    assertNull(expoPushAgentActivity(mapOf("title" to "No body")))
  }
}
