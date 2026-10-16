import {
  type EnvironmentId,
  type UsageLimitSourceConfig,
  UsageLimitSourceId,
} from "@t3tools/contracts";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SecretInput } from "./SecretInput";
import { Label } from "../ui/label";

type SourceKind = UsageLimitSourceConfig["kind"];

/** claude-swap manages every Claude account on its machine, so one entry per environment is enough. */
const CSWAP_SOURCE_ID = UsageLimitSourceId.make("cswap");

/**
 * Dots and dashes in the host are kept so `foo-bar.com` and `foo.bar.com` do
 * not collide; anything else (a port's colon, a path) is folded to a dash.
 */
function sourceIdFromUrl(url: string): UsageLimitSourceId {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return UsageLimitSourceId.make(`cliproxy-${slug || "hub"}`);
}

/**
 * Adds a CLIProxyAPI hub or claude-swap from provider settings on one
 * environment. A hub's management key is sent once and kept in that server's
 * secret store; settings only ever carry a redaction marker for it afterwards.
 */
export function AddUsageLimitSourceDialog({
  open,
  onOpenChange,
  environmentId,
  environmentLabel,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const [kind, setKind] = useState<SourceKind>("cliproxy");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [managementKey, setManagementKey] = useState("");
  const [binaryPath, setBinaryPath] = useState("");
  const trimmedUrl = url.trim();
  const trimmedLabel = label.trim();
  const canSave = kind === "cswap" || (trimmedUrl.length > 0 && managementKey.trim().length > 0);

  const reset = () => {
    setKind("cliproxy");
    setLabel("");
    setUrl("");
    setManagementKey("");
    setBinaryPath("");
  };

  const save = () => {
    if (!canSave) return;
    const labelField = trimmedLabel ? { label: trimmedLabel } : {};
    const [id, config]: readonly [UsageLimitSourceId, UsageLimitSourceConfig] =
      kind === "cswap"
        ? [
            CSWAP_SOURCE_ID,
            {
              kind: "cswap",
              ...labelField,
              binaryPath: binaryPath.trim() || "cswap",
              enabled: true,
            },
          ]
        : [
            sourceIdFromUrl(trimmedUrl),
            {
              kind: "cliproxy",
              ...labelField,
              url: trimmedUrl,
              managementKey: managementKey.trim(),
              enabled: true,
            },
          ];
    // The patch names only this entry; the server merges it into its map.
    updateSettings({ usageLimitSources: { [id]: config } });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a usage source</DialogTitle>
          <DialogDescription>
            {kind === "cswap"
              ? `Show the quota of every Claude account claude-swap manages on ${environmentLabel}.`
              : `Show the quota of every account a CLIProxyAPI hub pools, next to the providers on ${environmentLabel}. The key stays on that server.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <ToggleGroup
              aria-label="Source type"
              variant="segmented"
              value={[kind]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "cliproxy" || value === "cswap") setKind(value);
              }}
            >
              <Toggle value="cliproxy">CLIProxyAPI hub</Toggle>
              <Toggle value="cswap">claude-swap</Toggle>
            </ToggleGroup>
            {kind === "cswap" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="usage-source-binary">Binary path (optional)</Label>
                <Input
                  id="usage-source-binary"
                  placeholder="cswap"
                  value={binaryPath}
                  onChange={(event) => setBinaryPath(event.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="usage-source-url">Hub URL</Label>
                  <Input
                    id="usage-source-url"
                    placeholder="https://hub.example.ts.net:8318"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    autoFocus
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="usage-source-key">Management key</Label>
                  <SecretInput
                    id="usage-source-key"
                    value={managementKey}
                    onChange={(event) => setManagementKey(event.target.value)}
                  />
                </div>
              </>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="usage-source-label">Label (optional)</Label>
              <Input
                id="usage-source-label"
                placeholder={
                  kind === "cswap" ? "Defaults to claude-swap" : "Defaults to the hub's host name"
                }
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </div>
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            variant="outline"
            onClick={() => {
              reset();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave}>
            {kind === "cswap" ? "Add claude-swap" : "Add hub"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
