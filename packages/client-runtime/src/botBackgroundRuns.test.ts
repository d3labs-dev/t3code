import { MessageId, RunId } from "@t3tools/contracts";
import { BOT_DREAMING_PROMPT } from "@t3tools/shared/botDreaming";
import { buildBotCheckInHandoffPrompt } from "@t3tools/shared/botProactive";
import { describe, expect, it } from "vite-plus/test";

import { botBackgroundRuns } from "./botBackgroundRuns.ts";

const dreamRun = RunId.make("dream");
const checkInRun = RunId.make("check-in");
const checkInPrompt = buildBotCheckInHandoffPrompt("- PR #286 is green");

const prompt = (id: string, runId: RunId, text: string, sender: "server" | "web" = "server") => ({
  id: MessageId.make(id),
  role: "user",
  runId,
  text,
  streaming: false,
  createdBy: sender === "server" ? "agent" : "user",
  creationSource: sender,
});
const reply = (id: string, runId: RunId, text: string, streaming = false) => ({
  id: MessageId.make(id),
  role: "assistant",
  runId,
  text,
  streaming,
});

describe("botBackgroundRuns", () => {
  it("hides the server's consolidation and check-in runs unless someone wrote into them", () => {
    const dream = [
      prompt("dream", dreamRun, BOT_DREAMING_PROMPT),
      reply("dream-reply", dreamRun, "Updated NOW.md."),
    ];
    const checkIn = prompt("check-in", checkInRun, checkInPrompt);
    const never = (_runId: RunId) => false;

    expect(botBackgroundRuns([...dream, checkIn], never)).toEqual({
      backgroundRunIds: new Set([dreamRun, checkInRun]),
      checkInAnswerIds: new Set(),
    });
    expect(
      botBackgroundRuns([...dream, prompt("steered", dreamRun, "Are you there?", "web")], never)
        .backgroundRunIds,
    ).toEqual(new Set());
    expect(
      botBackgroundRuns(
        [
          prompt("typed-dream", dreamRun, BOT_DREAMING_PROMPT, "web"),
          prompt("typed-check-in", checkInRun, checkInPrompt, "web"),
        ],
        never,
      ).backgroundRunIds,
    ).toEqual(new Set());
  });

  it("keeps a finished check-in's last reply unless it stays quiet", () => {
    const answers = (last: ReturnType<typeof reply>, liveRunId: RunId | null = null) => [
      ...botBackgroundRuns(
        [
          prompt("check-in", checkInRun, checkInPrompt),
          reply("preamble", checkInRun, "Checking PR..."),
          last,
        ],
        (runId) => runId === liveRunId,
      ).checkInAnswerIds,
    ];
    const final = reply("final", checkInRun, "PR #286 is green.");

    expect(answers(final)).toEqual([final.id]);
    expect(answers(reply("final", checkInRun, "NO_REPLY"))).toEqual([]);
    expect(answers(reply("final", checkInRun, "  "))).toEqual([]);
    expect(answers(reply("final", checkInRun, "PR #286", true))).toEqual([]);
    expect(answers(final, checkInRun)).toEqual([]);
  });
});
