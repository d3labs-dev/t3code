/**
 * Usage as a sidebar panel: one card per provider with its pooled limit
 * windows and what it has cost lately. It answers "how much have I got left"
 * without giving up the thread the main pane is showing; the full page behind
 * the chart button keeps the breakdowns this has no room for.
 */
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, UsageProviderKind } from "@t3tools/contracts";
import { refreshUsageLimits } from "@t3tools/client-runtime/state/usage";
import {
  collectLimitAccounts,
  collectLimitNotices,
  collectLimitPools,
  formatDuration,
  type LimitPool,
  type LimitPoolWindow,
} from "@t3tools/shared/usageLimits";
import { enumerateDays, formatTokens, formatUsd, makeWindow } from "@t3tools/shared/usageFormat";
import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { ChartNoAxesColumnIcon } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useNavigate } from "@tanstack/react-router";

import { environmentPresentations } from "../../state/presentation";
import { serverEnvironment } from "../../state/server";
import { useUsage } from "../../state/usage";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { providerClients } from "../settings/providerDriverMeta";
import { SidebarChromeFooter } from "../sidebar/SidebarChrome";
import { SidebarHeaderIconButton } from "../sidebar/SidebarThreadHeader";
import { RefreshIcon } from "../ui/refresh-icon";
import { SidebarContent, SidebarGroup } from "../ui/sidebar";
import { barColor } from "./UsageLimits";
import { PROVIDER_ORDER, PROVIDER_PRESENTATION, usageKindForDriver } from "./usageProviders";
import { useSidebarPanelStore } from "../sidebar/sidebarPanelStore";

const COST_WINDOW_DAYS = 30;
const OPEN_REFRESH_COOLDOWN_MS = 3 * 60_000;
const spendingRefreshAfter = new Map<EnvironmentId, number>();

interface Spend {
  readonly costUsd: number;
  readonly totalTokens: number;
}

/** A provider's spend over the three periods the panel reports. */
interface ProviderSpend {
  readonly today: Spend | undefined;
  readonly yesterday: Spend | undefined;
  readonly window: Spend | undefined;
}

interface ProviderCard {
  readonly key: string;
  readonly label: string;
  readonly plan: string | null;
  readonly accountCount: number;
  readonly icon: ReactNode;
  readonly color: string;
  readonly windows: readonly LimitPoolWindow[];
  readonly spend: ProviderSpend;
}

function poolLabel(pool: LimitPool): string {
  return providerClients.get(pool.driver)?.label ?? String(pool.driver);
}

/** The plan every account in the pool is on, or null when they disagree. */
function sharedPlan(pool: LimitPool): string | null {
  const plans = new Set(pool.accounts.flatMap((account) => (account.plan ? [account.plan] : [])));
  return plans.size === 1 ? [...plans][0]! : null;
}

function spendOf(day: DailyTotals | undefined, kind: UsageProviderKind): Spend | undefined {
  const totals = day?.byProvider.get(kind);
  return totals && (totals.costUsd > 0 || totals.totalTokens > 0) ? totals : undefined;
}

function hasSpend(spend: ProviderSpend): boolean {
  return spend.today !== undefined || spend.yesterday !== undefined || spend.window !== undefined;
}

export function UsageSidebarPanel() {
  const navigate = useNavigate();
  const closeSidebarPanel = useSidebarPanelStore((store) => store.closeSidebarPanel);
  const presentations = useAtomValue(environmentPresentations.presentationsAtom);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [window, setWindow] = useState(() => makeWindow(COST_WINDOW_DAYS));
  // Advanced on refresh rather than ticking: a live clock would repaint the
  // sidebar every second for countdowns nobody reads that closely.
  const [now, setNow] = useState(() => Date.now());
  const [isRefreshing, startRefresh] = useTransition();
  const refreshingRef = useRef(false);
  const { merged, refresh } = useUsage(window);

  const refreshLimits = async () => {
    await Promise.all(
      Array.from(presentations, ([environmentId, presentation]) =>
        presentation.connection.phase === "connected" && presentation.serverConfig !== null
          ? refreshUsageLimits({
              environmentId,
              refresh: () => refreshProviders({ environmentId, input: {} }),
            })
          : undefined,
      ),
    ).finally(() => {
      setNow(Date.now());
    });
  };

  const connectedEnvironments = [...presentations]
    .filter(
      ([, presentation]) =>
        presentation.connection.phase === "connected" && presentation.serverConfig !== null,
    )
    .map(([environmentId]) => environmentId)
    .sort()
    .join(",");
  const handleRefresh = ({ automatic = false }: { automatic?: boolean } = {}) => {
    if (refreshingRef.current) return;
    const environmentIds = connectedEnvironments.split(",").filter(Boolean) as EnvironmentId[];
    const refreshedAt = Date.now();
    if (
      automatic &&
      environmentIds.every(
        (environmentId) => refreshedAt < (spendingRefreshAfter.get(environmentId) ?? 0),
      )
    ) {
      return;
    }
    for (const environmentId of environmentIds) {
      spendingRefreshAfter.set(environmentId, refreshedAt + OPEN_REFRESH_COOLDOWN_MS);
    }
    refreshingRef.current = true;
    startRefresh(async () => {
      const nextWindow = makeWindow(COST_WINDOW_DAYS);
      if (nextWindow.sinceDay !== window.sinceDay || nextWindow.untilDay !== window.untilDay) {
        setWindow(nextWindow);
      }
      // Limits arrive with the server's own provider probes; opening only rescans spending.
      await Promise.all([automatic ? undefined : refreshLimits(), refresh(nextWindow)]).finally(
        () => {
          refreshingRef.current = false;
        },
      );
    });
  };

  const refreshOnOpen = useEffectEvent(() => handleRefresh({ automatic: true }));
  useEffect(() => {
    if (connectedEnvironments) refreshOnOpen();
  }, [connectedEnvironments]);

  const pools = useMemo(
    () => collectLimitPools(collectLimitAccounts(presentations), now),
    [presentations, now],
  );
  const notices = useMemo(() => collectLimitNotices(presentations), [presentations]);

  const cards = useMemo<readonly ProviderCard[]>(() => {
    const days = enumerateDays(window.sinceDay, window.untilDay);
    const byDay = new Map(merged.daily.map((entry) => [entry.day, entry]));
    const today = byDay.get(days[days.length - 1] ?? "");
    const yesterday = byDay.get(days[days.length - 2] ?? "");
    const spendFor = (kind: UsageProviderKind | undefined): ProviderSpend => {
      if (!kind) return { today: undefined, yesterday: undefined, window: undefined };
      const totals = merged.providers.find((entry) => entry.provider === kind);
      return {
        today: spendOf(today, kind),
        yesterday: spendOf(yesterday, kind),
        window: totals && (totals.costUsd > 0 || totals.totalTokens > 0) ? totals : undefined,
      };
    };

    const pooledKinds = new Set<UsageProviderKind>();
    const pooled = pools.map((pool): ProviderCard => {
      const kind = usageKindForDriver(pool.driver);
      if (kind) pooledKinds.add(kind);
      const label = poolLabel(pool);
      return {
        key: String(pool.driver),
        label,
        plan: sharedPlan(pool),
        accountCount: pool.accounts.length,
        icon: (
          <ProviderInstanceIcon
            driverKind={pool.driver}
            displayName={label}
            className="size-4"
            iconClassName="size-4 text-sidebar-foreground/80"
          />
        ),
        color: barColor(pool.driver),
        windows: pool.windows,
        spend: spendFor(kind),
      };
    });

    // Providers that cost money without reporting a subscription window still
    // belong here; without them the panel would look like they cost nothing.
    const costOnly = PROVIDER_ORDER.filter((kind) => !pooledKinds.has(kind)).flatMap(
      (kind): ProviderCard[] => {
        const spend = spendFor(kind);
        if (!hasSpend(spend)) return [];
        const presentation = PROVIDER_PRESENTATION[kind];
        return [
          {
            key: kind,
            label: presentation.label,
            plan: null,
            accountCount: 0,
            icon: (
              <ProviderInstanceIcon
                driverKind={presentation.driverKind}
                displayName={presentation.label}
                className="size-4"
                iconClassName="size-4 text-sidebar-foreground/80"
              />
            ),
            color: presentation.color,
            windows: [],
            spend,
          },
        ];
      },
    );
    return [...pooled, ...costOnly];
  }, [merged.daily, merged.providers, pools, window.sinceDay, window.untilDay]);

  return (
    <>
      <SidebarContent
        fixedHeader={
          <SidebarGroup className="z-[1]">
            <div className="-mt-1 flex items-center gap-1">
              <span className="flex h-8 min-w-0 flex-1 items-center px-2 text-sm font-medium text-sidebar-foreground">
                Usage
              </span>
              <div className="flex shrink-0 items-center">
                <SidebarHeaderIconButton
                  label="Refresh usage"
                  aria-busy={isRefreshing}
                  disabled={isRefreshing}
                  onClick={() => handleRefresh()}
                >
                  <RefreshIcon className="size-4" refreshing={isRefreshing} />
                </SidebarHeaderIconButton>
                <SidebarHeaderIconButton
                  label="Open full usage page"
                  onClick={() => {
                    closeSidebarPanel();
                    void navigate({ to: "/usage" });
                  }}
                >
                  <ChartNoAxesColumnIcon />
                </SidebarHeaderIconButton>
              </div>
            </div>
          </SidebarGroup>
        }
      >
        <SidebarGroup>
          <div className="flex min-w-0 flex-col gap-4">
            {cards.map((card) => (
              <ProviderUsageCard key={card.key} card={card} now={now} />
            ))}
            {cards.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-sidebar-muted-foreground">
                No provider on the connected environments reports usage yet.
              </p>
            ) : null}
            {notices.map((notice) => (
              <p
                key={notice}
                className="px-1 text-2xs leading-normal text-sidebar-muted-foreground/80"
              >
                {notice}
              </p>
            ))}
          </div>
        </SidebarGroup>
      </SidebarContent>
      <SidebarChromeFooter />
    </>
  );
}

function ProviderUsageCard({ card, now }: { readonly card: ProviderCard; readonly now: number }) {
  const rows: ReadonlyArray<{ label: string; spend: Spend | undefined }> = [
    { label: "Today", spend: card.spend.today },
    { label: "Yesterday", spend: card.spend.yesterday },
    { label: `Last ${COST_WINDOW_DAYS} days`, spend: card.spend.window },
  ];
  const showSpend = hasSpend(card.spend);
  return (
    <section className="flex min-w-0 flex-col gap-1.5">
      <header className="flex min-w-0 items-center gap-2 px-1">
        {card.icon}
        <span className="truncate text-sm font-medium text-sidebar-foreground">{card.label}</span>
        {card.plan ? (
          <span className="truncate text-xs text-sidebar-muted-foreground">{card.plan}</span>
        ) : card.accountCount > 1 ? (
          <span className="shrink-0 text-xs text-sidebar-muted-foreground tabular-nums">
            {card.accountCount} accounts
          </span>
        ) : null}
      </header>
      <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-sidebar-control-surface p-3">
        {card.windows.map((window) => (
          <WindowMeter
            key={`${window.kind}:${window.id}`}
            window={window}
            color={card.color}
            now={now}
          />
        ))}
        {showSpend ? (
          <div
            className={
              card.windows.length > 0
                ? "flex flex-col gap-1 border-t border-sidebar-border/60 pt-3"
                : "flex flex-col gap-1"
            }
          >
            {rows.map((row) => (
              <div key={row.label} className="flex min-w-0 items-baseline gap-2 text-xs">
                <span className="shrink-0 text-sidebar-muted-foreground">{row.label}</span>
                <span className="ms-auto truncate text-sidebar-foreground tabular-nums">
                  {row.spend
                    ? `${formatUsd(row.spend.costUsd)} · ${formatTokens(row.spend.totalTokens)}`
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/**
 * One pooled window: quota left as a bar, and when the soonest account resets.
 * The percentage is the pool's, so two accounts on one plan read as one tank.
 */
function WindowMeter({
  window,
  color,
  now,
}: {
  readonly window: LimitPoolWindow;
  readonly color: string;
  readonly now: number;
}) {
  const nextReset = window.resets[0];
  const resetsIn =
    nextReset === undefined
      ? null
      : nextReset.at <= now
        ? "Resets now"
        : `Resets in ${formatDuration(nextReset.at - now)}`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-xs font-medium text-sidebar-foreground">{window.label}</span>
      <div
        role="img"
        aria-label={`${window.label}: ${window.remainingPercent}% left${resetsIn ? `, ${resetsIn.toLowerCase()}` : ""}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-sidebar-border/70"
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${window.remainingPercent}%`, backgroundColor: color }}
        />
      </div>
      <div className="flex min-w-0 items-baseline gap-2 text-2xs leading-normal tabular-nums">
        <span className="shrink-0 font-medium text-sidebar-foreground">
          {window.remainingPercent}% left
        </span>
        <span className="ms-auto truncate text-sidebar-muted-foreground">{resetsIn ?? ""}</span>
      </div>
    </div>
  );
}
