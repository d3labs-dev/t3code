import { EnvironmentId, ProviderInstanceId, USAGE_CONTRACT_VERSION } from "@t3tools/contracts";
import { mergeUsage } from "@t3tools/shared/usageMerge";
import { StrictMode, act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  presentations: new Map(),
  refreshProviders: vi.fn(async () => undefined),
  refreshUsage: vi.fn(async () => undefined),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.presentations }));
vi.mock("../../state/presentation", () => ({
  environmentPresentations: { presentationsAtom: null },
}));
vi.mock("../../state/server", () => ({ serverEnvironment: { refreshProviders: null } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.refreshProviders }));
vi.mock("../../state/usage", () => ({
  useUsage: () => ({
    merged: mergeUsage([], USAGE_CONTRACT_VERSION),
    refresh: state.refreshUsage,
  }),
}));
vi.mock("../ui/sidebar", () => ({ SidebarContent: "div", SidebarGroup: "div" }));
vi.mock("../chat/ProviderInstanceIcon", () => ({ ProviderInstanceIcon: () => null }));
vi.mock("../settings/RedactedSensitiveText", () => ({ RedactedSensitiveText: "span" }));
vi.mock("../settings/providerDriverMeta", () => ({ getDriverOption: () => ({ label: "Codex" }) }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../sidebar/SidebarChrome", () => ({ SidebarChromeFooter: () => null }));
vi.mock("../sidebar/SidebarThreadHeader", () => ({ SidebarHeaderIconButton: "button" }));

import { UsageSidebarPanel } from "./UsageSidebarPanel";
let renderer: ReactTestRenderer;
let environmentNumber = 0;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-11T12:00:00Z"));
  environmentNumber += 1;
  state.refreshProviders.mockClear();
  state.refreshUsage.mockClear();
  state.presentations = new Map([
    [
      EnvironmentId.make(`test-${environmentNumber}`),
      {
        entry: { target: { label: "Test" } },
        connection: { phase: "connected" },
        serverConfig: {
          providers: [
            {
              instanceId: ProviderInstanceId.make("codex"),
              driver: "codex",
              enabled: true,
              installed: true,
              version: null,
              status: "ready",
              auth: { status: "authenticated" },
              checkedAt: "2026-09-11T12:00:00Z",
              models: [],
              slashCommands: [],
              skills: [],
              usageLimits: {
                checkedAt: "2026-09-11T12:00:00Z",
                windows: [
                  {
                    id: "five_hour",
                    kind: "session",
                    label: "Session",
                    usedPercent: 40,
                    windowDurationMins: 300,
                    resetsAt: "2026-09-11T14:00:00Z",
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  ]);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reopening within the two minute cooldown does not refresh", async () => {
  for (let opening = 1; opening <= 3; opening += 1) {
    vi.mocked(Date.now).mockReturnValue(
      Date.parse("2026-09-11T12:00:00Z") + (opening - 1) * 60_000,
    );
    await act(() => {
      renderer = create(
        <StrictMode>
          <UsageSidebarPanel />
        </StrictMode>,
      );
    });
    expect(state.refreshProviders).toHaveBeenCalledTimes(opening === 3 ? 2 : 1);
    expect(state.refreshUsage).toHaveBeenCalledTimes(opening === 3 ? 2 : 1);
    await act(() => renderer.unmount());
  }
});

it("waits for connection and does not refresh on ordinary renders", async () => {
  const [id, presentation] = [...state.presentations][0]!;
  state.presentations = new Map([[id, { ...presentation, connection: { phase: "disconnected" } }]]);
  await act(() => {
    renderer = create(<UsageSidebarPanel />);
  });
  expect(state.refreshProviders).not.toHaveBeenCalled();
  expect(state.refreshUsage).not.toHaveBeenCalled();
  state.presentations = new Map([[id, presentation]]);
  await act(() => renderer.update(<UsageSidebarPanel />));
  expect(state.refreshProviders).toHaveBeenCalledTimes(1);
  expect(state.refreshUsage).toHaveBeenCalledTimes(1);
  await act(() => renderer.update(<UsageSidebarPanel />));
  expect(state.refreshProviders).toHaveBeenCalledTimes(1);
  expect(state.refreshUsage).toHaveBeenCalledTimes(1);
});
