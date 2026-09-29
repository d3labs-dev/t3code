import {
  CUSTOM_BACKGROUND_FILTERS,
  CUSTOM_BACKGROUND_NAME_MAX_LENGTH,
  CUSTOM_BACKGROUND_ROTATION_MINUTE_OPTIONS,
  CUSTOM_BACKGROUND_ROTATION_ORDERS,
  CUSTOM_BACKGROUND_TRANSITIONS,
  type CustomBackgroundImageSource,
  type CustomBackgroundSource,
  IMAGE_DITHERING_PRESETS,
  type ImageDitheringPreset,
  type CustomBackgroundFilterKind,
  type CustomBackgroundRecord,
  MAX_AGENT_BUBBLE_BLUR,
  MAX_CUSTOM_BACKGROUND_BLUR,
  MAX_CUSTOM_BACKGROUND_FADE,
  MIN_CUSTOM_BACKGROUND_FADE,
  defaultCustomBackgroundFilter,
} from "@t3tools/contracts";
import { adaptToBrightness } from "@t3tools/shared/customBackgroundBrightness";
import {
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderSyncIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useBackgroundStudioStore } from "~/customBackground/backgroundStudioStore";
import {
  type BackgroundFolderSyncResult,
  backgroundFolderName,
  linkBackgroundFolder,
} from "~/customBackground/folderSync";
import { storeBackgroundImages, useBackgroundImageTone } from "~/customBackground/imageStore";
import { stepBackgroundImage, useRotatingBackgroundImage } from "~/customBackground/rotation";
import { isWebGlAvailable } from "~/customBackground/webgl";
import {
  type CustomBackgroundLibrary,
  appendBackgroundImage,
  createEmptyBackground,
  toggleBackgroundImage,
  unlinkBackgroundFolder,
  filtersEqual,
  nextActiveAfterRemove,
  nextNewBackgroundName,
  removeBackground,
  upsertBackground,
  withFilterKind,
} from "~/customBackground/records";
import { getClientSettings, useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { cn, randomUUID } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectButton,
  SelectValue,
} from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BackgroundControls, RangeControl, StudioField } from "./BackgroundControls";
import {
  BackgroundImagePicker,
  BackgroundThumbnail,
  backgroundPickerDeleteRevealClass,
  backgroundPickerMenuGridClass,
  backgroundPickerTileClass,
  backgroundStudioFieldClass,
} from "./BackgroundImagePicker";

const FILTER_LABELS: Readonly<Record<CustomBackgroundFilterKind, string>> = {
  none: "No filter",
  "image-dithering": "Dithering",
};

type UploadState =
  | { status: "busy"; done: number; total: number }
  | { status: "settled"; notice: string | null; error: string | null };

function uploadLabel(upload: UploadState): string | null {
  if (upload.status !== "busy") return null;
  if (upload.total === 0) return "Reading folder…";
  if (upload.total < 2) return "Preparing image…";
  return `Preparing ${Math.min(upload.done + 1, upload.total)} of ${upload.total}…`;
}

function isFilterKind(value: unknown): value is CustomBackgroundFilterKind {
  return typeof value === "string" && Object.hasOwn(FILTER_LABELS, value);
}

const PERSIST_DEBOUNCE_MS = 150;

const FADE_CONTROLS = [
  { key: "fade", label: "Bottom fade" },
  { key: "fadeHeight", label: "Fade height" },
  { key: "fadeSoftness", label: "Fade softness" },
  { key: "opacity", label: "Image opacity" },
] as const satisfies ReadonlyArray<{ key: keyof CustomBackgroundRecord; label: string }>;

function describeUploadFailure(reason: string): string {
  switch (reason) {
    case "too-large":
      return "This image is too large to store. Choose a smaller one.";
    case "quota":
      return "This browser is out of storage for images. Delete unused images and try again.";
    case "unavailable":
      return "Image storage is unavailable in this browser context.";
    default:
      return "Could not read this image.";
  }
}

function describeFolderSync(path: string, result: BackgroundFolderSyncResult): UploadState {
  const name = backgroundFolderName(path);
  if (result.status === "missing") {
    return { status: "settled", notice: null, error: `Could not read the folder ${name}.` };
  }
  return {
    status: "settled",
    notice: `${name}: ${result.pictures} pictures, ${result.imported} new.`,
    error:
      result.failed === 0
        ? null
        : `${result.failed} ${result.failed === 1 ? "picture" : "pictures"} in ${name} could not be imported.`,
  };
}

function NameField({
  name,
  onCommit,
  onDone,
}: {
  name: string;
  onCommit: (name: string) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const commit = () => {
    const trimmed = draft.trim().slice(0, CUSTOM_BACKGROUND_NAME_MAX_LENGTH);
    if (trimmed.length > 0 && trimmed !== name) onCommit(trimmed);
    onDone();
  };
  return (
    <span
      className={backgroundStudioFieldClass(
        "[&_[data-slot=input]]:h-full sm:[&_[data-slot=input]]:h-full",
      )}
    >
      <Input
        aria-label="Playlist name"
        autoFocus
        size="sm"
        unstyled
        className="flex min-w-0 flex-1 self-stretch"
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
    </span>
  );
}

function StudioSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-border/60 pt-4">
      <h3 className="text-studio font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DitheringPresetRow({
  record,
  onPick,
}: {
  record: CustomBackgroundRecord;
  onPick: (preset: ImageDitheringPreset) => void;
}) {
  if (record.filter.kind !== "image-dithering") return null;
  const current = record.filter;
  return (
    <StudioField label="Look" align="start">
      <div
        className="flex min-w-0 flex-1 flex-wrap gap-1.5"
        role="group"
        aria-label="Dithering look"
      >
        {IMAGE_DITHERING_PRESETS.map((preset) => {
          const active =
            filtersEqual(current, preset.filter) &&
            (preset.fade === undefined ||
              (record.fade === preset.fade.fade &&
                record.fadeHeight === preset.fade.fadeHeight &&
                record.fadeSoftness === preset.fade.fadeSoftness));
          return (
            <Button
              key={preset.id}
              size="xs"
              variant={active ? "secondary" : "outline"}
              aria-pressed={active}
              onClick={() => onPick(preset)}
            >
              <span
                aria-hidden
                className="size-2.5 rounded-full border border-border/60"
                style={{
                  background: preset.filter.originalColors
                    ? "conic-gradient(#f87171, #facc15, #4ade80, #60a5fa, #c084fc, #f87171)"
                    : `linear-gradient(135deg, ${preset.filter.colorHighlight}, ${preset.filter.colorFront} 55%, ${preset.filter.colorBack})`,
                }}
              />
              {preset.name}
            </Button>
          );
        })}
      </div>
    </StudioField>
  );
}

/** The adapt slider, plus what it does to the picture showing right now. */
function BrightnessAdaptControl({
  record,
  onChange,
}: {
  record: CustomBackgroundRecord;
  onChange: (brightnessAdapt: number) => void;
}) {
  const { current } = useRotatingBackgroundImage(record.source);
  const tone = useBackgroundImageTone(current);
  const { resolvedTheme } = useTheme();
  const look = tone ? adaptToBrightness({ ...record, tone, appearance: resolvedTheme }) : null;
  return (
    <>
      <RangeControl
        label="Brightness adapt"
        min={MIN_CUSTOM_BACKGROUND_FADE}
        max={MAX_CUSTOM_BACKGROUND_FADE}
        step={1}
        value={record.brightnessAdapt}
        format={(value) => `${Math.round(value)}%`}
        onChange={(value) => onChange(Math.round(value))}
      />
      {tone && look ? (
        <StudioField label="This picture">
          <span className="text-xs text-muted-foreground tabular-nums">
            {Math.round(tone.lightness * 100)}% light, {Math.round(tone.colorfulness * 100)}%
            colorful, shows at {look.opacity}% opacity and {look.fade}% fade
          </span>
        </StudioField>
      ) : null}
    </>
  );
}

const ROTATION_ORDER_LABELS: Readonly<Record<CustomBackgroundImageSource["order"], string>> = {
  sequential: "In order",
  shuffle: "Shuffle",
};

const TRANSITION_LABELS: Readonly<Record<CustomBackgroundImageSource["transition"], string>> = {
  cut: "Cut",
  fade: "Fade",
};

function SourceOptionField<Value extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<Value>;
  labels: Readonly<Record<Value, string>>;
  onChange: (value: Value) => void;
}) {
  return (
    <StudioField label={label}>
      <Select
        value={value}
        onValueChange={(next) => {
          const match = options.find((option) => option === next);
          if (match !== undefined) onChange(match);
        }}
      >
        <SelectTrigger
          size="sm"
          className="min-h-0 h-7.5 min-w-0 flex-1 sm:h-6.5 sm:min-h-0"
          aria-label={label}
        >
          <SelectValue>{labels[value]}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {options.map((option) => (
            <SelectItem key={option} hideIndicator value={option}>
              {labels[option]}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </StudioField>
  );
}

function RotationFields({
  source,
  onChange,
}: {
  source: CustomBackgroundImageSource;
  onChange: (source: CustomBackgroundImageSource) => void;
}) {
  const rotating = source.imageIds.length > 1;
  return (
    <>
      {rotating ? null : (
        <p className="text-xs text-muted-foreground">
          Pick two or more images to rotate through them. These settings apply once you do.
        </p>
      )}
      <RotationIntervalField source={source} onChange={onChange} />
      <SourceOptionField
        label="Order"
        value={source.order}
        options={CUSTOM_BACKGROUND_ROTATION_ORDERS}
        labels={ROTATION_ORDER_LABELS}
        onChange={(order) => onChange({ ...source, order })}
      />
      <SourceOptionField
        label="Transition"
        value={source.transition}
        options={CUSTOM_BACKGROUND_TRANSITIONS}
        labels={TRANSITION_LABELS}
        onChange={(transition) => onChange({ ...source, transition })}
      />
      {rotating ? <RotationStepRow /> : null}
    </>
  );
}

function RotationStepRow() {
  return (
    <StudioField label="Preview">
      <div className="flex gap-1.5">
        <Button size="xs" variant="outline" onClick={() => stepBackgroundImage(-1)}>
          <ChevronLeftIcon /> Previous
        </Button>
        <Button size="xs" variant="outline" onClick={() => stepBackgroundImage(1)}>
          Next <ChevronRightIcon />
        </Button>
      </div>
    </StudioField>
  );
}

function formatRotationMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} h`;
  return "1 day";
}

function RotationIntervalField({
  source,
  onChange,
}: {
  source: CustomBackgroundImageSource;
  onChange: (source: CustomBackgroundImageSource) => void;
}) {
  return (
    <StudioField label="Change every">
      <Select
        value={String(source.rotationMinutes)}
        onValueChange={(value) => {
          const minutes = Number(value);
          if (Number.isInteger(minutes)) onChange({ ...source, rotationMinutes: minutes });
        }}
      >
        <SelectTrigger
          size="sm"
          className="min-h-0 h-7.5 min-w-0 flex-1 sm:h-6.5 sm:min-h-0"
          aria-label="Rotation interval"
        >
          <SelectValue>{formatRotationMinutes(source.rotationMinutes)}</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {CUSTOM_BACKGROUND_ROTATION_MINUTE_OPTIONS.map((minutes) => (
            <SelectItem key={minutes} hideIndicator value={String(minutes)}>
              {formatRotationMinutes(minutes)}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </StudioField>
  );
}

function libraryPreview(record: CustomBackgroundRecord | null): {
  name: string;
  filter: string;
} {
  if (record === null) return { name: "None", filter: "Plain theme" };
  return { name: record.name, filter: FILTER_LABELS[record.filter.kind] };
}

function LibraryThumb({
  record,
  className,
}: {
  record: CustomBackgroundRecord | null;
  className: string;
}) {
  const imageId = record?.source.kind === "image" ? (record.source.imageIds[0] ?? null) : null;
  if (record === null) {
    return (
      <span
        className={cn(
          "flex items-center justify-center border border-dashed border-border bg-muted/40 text-muted-foreground",
          className,
        )}
      >
        <BanIcon className="size-4" />
      </span>
    );
  }
  return <BackgroundThumbnail imageId={imageId} className={className} />;
}

function LibraryTile({
  record,
  selected,
  onSelect,
  onDelete,
}: {
  record: CustomBackgroundRecord | null;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const { name, filter } = libraryPreview(record);
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        aria-label={`${name}, ${filter}`}
        aria-pressed={selected}
        onClick={onSelect}
        className={backgroundPickerTileClass(selected)}
      >
        <LibraryThumb record={record} className="aspect-[4/3] w-full" />
        <span className="block space-y-0.5 px-1.5 py-1.5">
          <span className="block truncate text-xs text-foreground">{name}</span>
          <span className="block truncate text-2xs leading-normal text-muted-foreground">
            {filter}
          </span>
        </span>
      </button>
      {onDelete ? (
        <span className={backgroundPickerDeleteRevealClass}>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label={`Delete background ${name}`}
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
        </span>
      ) : null}
    </div>
  );
}

function LibraryPicker({
  library,
  selectedId,
  selectedRecord,
  onSelect,
  onDelete,
}: {
  library: CustomBackgroundLibrary;
  selectedId: string | null;
  selectedRecord: CustomBackgroundRecord | null;
  onSelect: (id: string | null) => void;
  onDelete: (record: CustomBackgroundRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const { name, filter } = libraryPreview(selectedRecord);
  const pick = (id: string | null) => {
    onSelect(id);
    setOpen(false);
  };
  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger aria-label={`Background: ${name}, ${filter}`} render={<SelectButton />}>
        <span className="flex items-center gap-2 py-1.5">
          <LibraryThumb record={selectedRecord} className="size-8 shrink-0 rounded-md" />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium text-foreground">{name}</span>
            <span className="block truncate text-2xs leading-tight text-muted-foreground">
              {filter}
            </span>
          </span>
        </span>
      </MenuTrigger>
      <MenuPopup align="start" className="w-(--anchor-width) min-w-80">
        <div className={cn(backgroundPickerMenuGridClass, "gap-2.5")}>
          <LibraryTile
            record={null}
            selected={selectedRecord === null}
            onSelect={() => pick(null)}
          />
          {library.map((entry) => {
            const tileRecord =
              selectedRecord && entry.id === selectedRecord.id ? selectedRecord : entry;
            return (
              <LibraryTile
                key={entry.id}
                record={tileRecord}
                selected={entry.id === selectedId}
                onSelect={() => pick(entry.id)}
                onDelete={() => onDelete(tileRecord)}
              />
            );
          })}
        </div>
      </MenuPopup>
    </Menu>
  );
}

export function BackgroundStudioPanel() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const library = useClientSettings((settings) => settings.customBackgrounds);
  const activeId = useClientSettings((settings) => settings.activeCustomBackgroundId);
  const enabled = useClientSettings((settings) => settings.customBackgroundEnabled);
  const dynamicTheme = useClientSettings((settings) => settings.customBackgroundDynamicTheme);
  const agentBubbles = useClientSettings((settings) => settings.customBackgroundAgentBubbles);
  const bubbleOpacity = useClientSettings(
    (settings) => settings.customBackgroundAgentBubbleOpacity,
  );
  const bubbleBlur = useClientSettings((settings) => settings.customBackgroundAgentBubbleBlur);
  const replyTextEmphasis = useClientSettings(
    (settings) => settings.customBackgroundReplyTextEmphasis,
  );
  const updateSettings = useUpdateClientSettings();

  const selectedId = activeId;
  const liveRecord = useBackgroundStudioStore((store) => store.preview);
  const setLiveRecord = useBackgroundStudioStore((store) => store.setPreview);
  const [upload, setUpload] = useState<UploadState>({
    status: "settled",
    notice: null,
    error: null,
  });
  const [renaming, setRenaming] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flush the latest edit on unmount without waiting for a React update.
  const pendingRef = useRef<CustomBackgroundRecord | null>(null);

  const storedRecord = useMemo(
    () => (selectedId === null ? null : (library.find((r) => r.id === selectedId) ?? null)),
    [library, selectedId],
  );
  const record = liveRecord && liveRecord.id === selectedId ? liveRecord : storedRecord;
  const persistLibrary = useCallback(
    (next: CustomBackgroundLibrary, nextActiveId?: string | null) => {
      updateSettings(
        nextActiveId === undefined
          ? { customBackgrounds: next }
          : {
              customBackgrounds: next,
              activeCustomBackgroundId: nextActiveId,
            },
      );
    },
    [updateSettings],
  );

  const flushPending = useCallback(() => {
    if (persistTimer.current) {
      clearTimeout(persistTimer.current);
      persistTimer.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) {
      persistLibrary(upsertBackground(getClientSettings().customBackgrounds, pending));
    }
    setLiveRecord(null);
  }, [persistLibrary, setLiveRecord]);

  const commitRecord = useCallback(
    (next: CustomBackgroundRecord) => {
      pendingRef.current = next;
      setLiveRecord(next);
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(flushPending, PERSIST_DEBOUNCE_MS);
    },
    [flushPending, setLiveRecord],
  );

  useEffect(() => flushPending, [flushPending]);

  const selectRow = (id: string | null) => {
    flushPending();
    setRenaming(false);
    if (id !== activeId) updateSettings({ activeCustomBackgroundId: id });
  };

  const addRecord = (next: CustomBackgroundRecord) => {
    flushPending();
    persistLibrary(upsertBackground(getClientSettings().customBackgrounds, next), next.id);
  };

  // Files already in the store match by content hash and skip decoding, so
  // adding a folder again only encodes its new images. The import finishes
  // and lands in the playlist even if the studio closes midway.
  const uploadImages = async (files: ReadonlyArray<File>) => {
    if (files.length === 0) {
      setUpload({ status: "settled", notice: "No supported images found.", error: null });
      return [];
    }
    setUpload({ status: "busy", done: 0, total: files.length });
    const results = await storeBackgroundImages(
      files.map((file) => () => Promise.resolve(file)),
      () =>
        setUpload((previous) =>
          previous.status === "busy" ? { ...previous, done: previous.done + 1 } : previous,
        ),
    );
    let error: string | null = null;
    results.forEach((result, index) => {
      if (result.ok) return;
      const reason = describeUploadFailure(result.reason);
      error = files.length > 1 ? `${files[index]!.name}: ${reason}` : reason;
    });
    const imageIds = results.flatMap((result) => (result.ok ? [result.image.id] : []));
    const alreadyImported = results.filter((result) => result.ok && result.existed).length;
    const notice =
      alreadyImported === 0
        ? null
        : `${imageIds.length - alreadyImported} new, ${alreadyImported} already imported.`;
    setUpload({ status: "settled", notice, error });
    return imageIds;
  };

  const linkFolders = async (backgroundId: string, paths: ReadonlyArray<string>) => {
    flushPending();
    for (const path of paths) {
      setUpload({ status: "busy", done: 0, total: 0 });
      const result = await linkBackgroundFolder({
        backgroundId,
        path,
        onProgress: (done, total) => setUpload({ status: "busy", done, total }),
      });
      setUpload(describeFolderSync(path, result));
    }
  };

  const createBackground = () => {
    addRecord(
      createEmptyBackground({
        id: randomUUID(),
        name: nextNewBackgroundName(getClientSettings().customBackgrounds),
        filter: defaultCustomBackgroundFilter("none"),
        createdAt: new Date().toISOString(),
      }),
    );
  };

  const deleteBackground = async (record: CustomBackgroundRecord) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      `Delete background "${record.name}"?\nIts image stays available to other backgrounds.`,
      { variant: "destructive" },
    );
    if (!confirmed || !mounted.current) return;
    flushPending();
    const current = getClientSettings();
    persistLibrary(
      removeBackground(current.customBackgrounds, record.id),
      nextActiveAfterRemove(current.activeCustomBackgroundId, record.id),
    );
  };

  const referencedImageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of library) {
      if (entry.source.kind === "image") for (const id of entry.source.imageIds) ids.add(id);
    }
    return ids;
  }, [library]);

  const filtersAvailable = isWebGlAvailable();
  const filterIsDefault =
    record !== null &&
    filtersEqual(record.filter, defaultCustomBackgroundFilter(record.filter.kind));

  return (
    <div className="@container/studio flex min-w-0 flex-col gap-4">
      <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        Enable custom background
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => updateSettings({ customBackgroundEnabled: checked })}
        />
      </label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-studio font-medium text-foreground">Playlist</span>
          <Button size="xs" variant="outline" aria-label="Add playlist" onClick={createBackground}>
            <PlusIcon /> New playlist
          </Button>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 flex-1">
            {renaming && record ? (
              <NameField
                key={record.id}
                name={record.name}
                onCommit={(name) => commitRecord({ ...record, name })}
                onDone={() => setRenaming(false)}
              />
            ) : (
              <LibraryPicker
                library={library}
                selectedId={selectedId}
                selectedRecord={record}
                onSelect={selectRow}
                onDelete={(entry) => void deleteBackground(entry)}
              />
            )}
          </div>
          {record && !renaming ? (
            <Button
              size="icon-sm"
              variant="ghost-muted"
              aria-label="Rename playlist"
              onClick={() => setRenaming(true)}
            >
              <PencilIcon />
            </Button>
          ) : null}
        </div>
      </div>
      {record ? (
        <>
          <StudioSection title="Pictures">
            <BackgroundImagePicker
              selectedImageIds={record.source.kind === "image" ? record.source.imageIds : []}
              referencedImageIds={referencedImageIds}
              busy={upload.status === "busy"}
              busyLabel={uploadLabel(upload)}
              onToggle={(imageId) =>
                commitRecord({
                  ...record,
                  source: toggleBackgroundImage(record.source, imageId),
                })
              }
              onUpload={(files) => {
                void uploadImages(files).then((imageIds) => {
                  if (imageIds.length === 0) return;
                  flushPending();
                  persistLibrary(
                    getClientSettings().customBackgrounds.map((entry) =>
                      entry.id === record.id
                        ? {
                            ...entry,
                            source: imageIds.reduce<CustomBackgroundSource>(
                              appendBackgroundImage,
                              entry.source,
                            ),
                          }
                        : entry,
                    ),
                  );
                });
              }}
              onLinkFolders={(paths) => void linkFolders(record.id, paths)}
            />
            {record.folders.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {record.folders.map((folder) => (
                  <li
                    key={folder.path}
                    className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
                  >
                    <FolderSyncIcon className="size-3.5 shrink-0" />
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="min-w-0 flex-1 truncate">
                            {backgroundFolderName(folder.path)}
                          </span>
                        }
                      />
                      <TooltipPopup side="top">{folder.path}</TooltipPopup>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-micro"
                            variant="ghost-muted"
                            aria-label="Stop syncing folder"
                            onClick={() =>
                              commitRecord(unlinkBackgroundFolder(record, folder.path))
                            }
                          >
                            <XIcon />
                          </Button>
                        }
                      />
                      <TooltipPopup side="top">
                        Stop syncing. Its pictures stay in the playlist.
                      </TooltipPopup>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            ) : null}
            {upload.status === "settled" && upload.notice ? (
              <p role="status" className="text-xs text-muted-foreground">
                {upload.notice}
              </p>
            ) : null}
            {upload.status === "settled" && upload.error ? (
              <p role="alert" className="text-xs text-destructive">
                {upload.error}
              </p>
            ) : null}
            {record.source.kind === "image" ? (
              <RotationFields
                source={record.source}
                onChange={(source) => commitRecord({ ...record, source })}
              />
            ) : null}
          </StudioSection>
          <StudioSection title="Style">
            {!filtersAvailable ? (
              <p role="status" className="text-xs text-muted-foreground">
                Filters need WebGL to be active.
              </p>
            ) : null}
            <StudioField label="Filter">
              <Select
                disabled={!filtersAvailable}
                value={record.filter.kind}
                onValueChange={(kind) => {
                  if (isFilterKind(kind)) commitRecord(withFilterKind(record, kind));
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="min-h-0 h-7.5 min-w-0 flex-1 sm:h-6.5 sm:min-h-0"
                  aria-label="Filter"
                >
                  <SelectValue>{FILTER_LABELS[record.filter.kind]}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem hideIndicator value="none">
                    {FILTER_LABELS.none}
                  </SelectItem>
                  {CUSTOM_BACKGROUND_FILTERS.map(({ kind }) => (
                    <SelectItem key={kind} hideIndicator value={kind}>
                      {FILTER_LABELS[kind]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              {filtersAvailable && !filterIsDefault && record.filter.kind !== "none" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost-muted"
                        aria-label="Reset filter to defaults"
                        onClick={() =>
                          commitRecord({
                            ...record,
                            filter: defaultCustomBackgroundFilter(record.filter.kind),
                          })
                        }
                      >
                        <Undo2Icon />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">Reset filter to defaults</TooltipPopup>
                </Tooltip>
              ) : null}
            </StudioField>
            {filtersAvailable ? (
              <DitheringPresetRow
                record={record}
                onPick={(preset) =>
                  commitRecord({ ...record, filter: preset.filter, ...preset.fade })
                }
              />
            ) : null}
            {filtersAvailable ? (
              <BackgroundControls
                filter={record.filter}
                onChange={(filter) =>
                  commitRecord({
                    ...record,
                    filter,
                  })
                }
              />
            ) : null}
            {FADE_CONTROLS.map(({ key, label }) => (
              <RangeControl
                key={key}
                label={label}
                min={MIN_CUSTOM_BACKGROUND_FADE}
                max={MAX_CUSTOM_BACKGROUND_FADE}
                step={1}
                value={record[key]}
                format={(value) => `${Math.round(value)}%`}
                onChange={(value) =>
                  commitRecord({
                    ...record,
                    [key]: Math.round(value),
                  })
                }
              />
            ))}
            <BrightnessAdaptControl
              record={record}
              onChange={(brightnessAdapt) => commitRecord({ ...record, brightnessAdapt })}
            />
            <RangeControl
              label="Background blur"
              min={0}
              max={MAX_CUSTOM_BACKGROUND_BLUR}
              step={1}
              value={record.blur}
              format={(value) => `${value}px`}
              onChange={(value) => commitRecord({ ...record, blur: Math.round(value) })}
            />
          </StudioSection>
        </>
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-studio text-muted-foreground">
          Add a playlist to get started, or pick one to edit.
        </div>
      )}
      <StudioSection title="Theme and chats">
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Theme from image colors
          <Switch
            checked={dynamicTheme}
            onCheckedChange={(checked) => updateSettings({ customBackgroundDynamicTheme: checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Bubbles behind agent replies
          <Switch
            checked={agentBubbles}
            onCheckedChange={(checked) => updateSettings({ customBackgroundAgentBubbles: checked })}
          />
        </label>
        {agentBubbles ? (
          <>
            <RangeControl
              label="Bubble opacity"
              min={0}
              max={100}
              step={1}
              value={bubbleOpacity}
              format={(value) => `${value}%`}
              onChange={(value) => updateSettings({ customBackgroundAgentBubbleOpacity: value })}
            />
            <RangeControl
              label="Bubble blur"
              min={0}
              max={MAX_AGENT_BUBBLE_BLUR}
              step={1}
              value={bubbleBlur}
              format={(value) => `${value}px`}
              onChange={(value) => updateSettings({ customBackgroundAgentBubbleBlur: value })}
            />
          </>
        ) : null}
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          Bolder, brighter reply text
          <Switch
            checked={replyTextEmphasis}
            onCheckedChange={(checked) =>
              updateSettings({ customBackgroundReplyTextEmphasis: checked })
            }
          />
        </label>
      </StudioSection>
    </div>
  );
}
