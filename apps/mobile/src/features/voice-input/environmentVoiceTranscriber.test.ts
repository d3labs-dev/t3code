import { EnvironmentId, VoiceTranscriptionNotConfiguredError } from "@t3tools/contracts";
import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  createTranscriptionUrl: Symbol("create-transcription-url"),
  preparedConnection: Symbol("prepared-connection"),
  readAtom: vi.fn(),
  runAtomCommand: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@t3tools/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: mocks.runAtomCommand,
}));

vi.mock("../../state/atom-registry", () => ({
  appAtomRegistry: { get: mocks.readAtom },
}));

vi.mock("../../state/session", () => ({
  environmentSession: {
    preparedConnectionValueAtom: () => mocks.preparedConnection,
  },
}));

vi.mock("../../state/voice", () => ({
  voiceEnvironment: { createTranscriptionUrl: mocks.createTranscriptionUrl },
}));

vi.mock("expo-file-system", () => ({
  File: class {
    readonly uri: string;
    readonly size = 2048;
    constructor(uri: string) {
      this.uri = uri;
    }
    upload(url: string, options: unknown) {
      return mocks.upload(this.uri, url, options);
    }
  },
  UploadType: { BINARY_CONTENT: 0 },
}));

import { createMobileEnvironmentVoiceTranscriber } from "./environmentVoiceTranscriber";

const environmentId = EnvironmentId.make("environment-1");
const recordingUri = "file:///cache/Audio/recording.m4a";

async function transcribe(): Promise<string> {
  const { signal } = new AbortController();
  const prepared = await createMobileEnvironmentVoiceTranscriber({
    environmentId,
    threadId: null,
  }).prepare({
    signal,
  });
  return prepared.transcribe(recordingUri, { signal });
}

describe("createMobileEnvironmentVoiceTranscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAtom.mockReturnValue(Option.some({ httpBaseUrl: "http://100.64.0.2:3773/" }));
  });

  it("posts the recording to the environment's origin and returns its transcript", async () => {
    mocks.runAtomCommand.mockResolvedValue(
      AsyncResult.success({ relativeUrl: "/api/voice/transcriptions/token", expiresAt: 0 }),
    );
    mocks.upload.mockResolvedValue({ status: 200, body: '{"text":"Ship it."}', headers: {} });

    await expect(transcribe()).resolves.toBe("Ship it.");
    expect(mocks.runAtomCommand.mock.calls[0]?.[2]).toEqual({
      environmentId,
      input: { mimeType: "audio/mp4", sizeBytes: 2048 },
    });
    expect(mocks.upload).toHaveBeenCalledWith(
      recordingUri,
      "http://100.64.0.2:3773/api/voice/transcriptions/token",
      expect.objectContaining({ headers: { "Content-Type": "audio/mp4" } }),
    );
  });

  it("asks for a dictation key when the environment has none", async () => {
    mocks.runAtomCommand.mockResolvedValue(
      AsyncResult.failure(Cause.fail(new VoiceTranscriptionNotConfiguredError())),
    );

    const error = await transcribe().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VoiceTranscriptionError);
    expect(error).toMatchObject({ code: "rejected", message: expect.stringContaining("API key") });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
