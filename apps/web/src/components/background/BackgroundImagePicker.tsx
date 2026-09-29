import type { CustomBackgroundImageId } from "@t3tools/contracts";
import { FolderPlusIcon, ImageIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";

import {
  CUSTOM_BACKGROUND_ACCEPTED_TYPES,
  deleteBackgroundImage,
  listBackgroundImages,
  type StoredBackgroundImage,
  subscribeBackgroundImages,
  useBackgroundImageUrl,
} from "~/customBackground/imageStore";
import { canSyncBackgroundFolders, pickBackgroundFolder } from "~/customBackground/folderSync";
import { imagesFromDrop, imagesFromFiles } from "~/customBackground/importFiles";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { StudioField } from "./BackgroundControls";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const BACKGROUND_FILE_ACCEPT = CUSTOM_BACKGROUND_ACCEPTED_TYPES.join(",");
const BACKGROUND_FILE_TYPES_LABEL = CUSTOM_BACKGROUND_ACCEPTED_TYPES.map((type) =>
  type.replace("image/", "").toUpperCase(),
).join(", ");

export function backgroundStudioFieldClass(className?: string): string {
  return cn(
    "relative inline-flex h-7.5 min-w-0 w-full flex-1 items-center rounded-lg border border-input bg-background text-sm text-foreground shadow-xs/5 outline-none not-dark:bg-clip-padding ring-ring/24 transition-shadow sm:h-6.5",
    "before:pointer-events-none before:absolute before:inset-0 before:rounded-studio-field-inner",
    "not-has-disabled:not-has-focus-visible:not-focus-visible:before:shadow-studio-field dark:not-has-disabled:not-has-focus-visible:not-focus-visible:before:shadow-studio-field-dark",
    "has-focus-visible:border-ring has-focus-visible:ring-3 focus-visible:border-ring focus-visible:ring-3",
    "has-[:disabled,:focus-visible]:shadow-none focus-visible:shadow-none",
    "has-disabled:opacity-64 disabled:opacity-64",
    "dark:bg-input/32",
    className,
  );
}

export function backgroundPickerTileClass(selected: boolean): string {
  return cn(
    "block w-full overflow-hidden rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected ? "border-primary ring-2 ring-primary/40" : "border-border/60 hover:border-border",
  );
}

export const backgroundPickerMenuGridClass = "grid max-h-72 grid-cols-3 overflow-y-auto p-2";

const uploadTileClass =
  "flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border px-2 text-center text-xs text-muted-foreground outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/10";

type DropTarget = "input" | "files" | "folder";

function dropTargetOf(element: HTMLElement): DropTarget {
  const target = element.dataset.dropTarget;
  return target === "input" || target === "folder" ? target : "files";
}

export const backgroundPickerDeleteRevealClass =
  "absolute right-1 top-1 flex opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 has-focus-visible:opacity-100 pointer-coarse:opacity-100";

function useStoredBackgroundImages(): ReadonlyArray<StoredBackgroundImage> | null {
  const [images, setImages] = useState<ReadonlyArray<StoredBackgroundImage> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void listBackgroundImages()
        .then((next) => {
          if (!cancelled) setImages(next);
        })
        .catch(() => {
          if (!cancelled) setImages([]);
        });
    };
    refresh();
    const unsubscribe = subscribeBackgroundImages(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return images;
}

export function BackgroundThumbnail({
  imageId,
  className,
}: {
  imageId: CustomBackgroundImageId | null;
  className?: string;
}) {
  const url = useBackgroundImageUrl(imageId, "thumbnail");
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden bg-muted text-muted-foreground",
        className,
      )}
    >
      {typeof url === "string" ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <ImageIcon className="size-4" />
      )}
    </div>
  );
}

export function BackgroundImagePicker({
  selectedImageIds,
  referencedImageIds,
  onToggle,
  onUpload,
  onLinkFolders,
  busy,
  busyLabel,
}: {
  selectedImageIds: ReadonlyArray<CustomBackgroundImageId>;
  referencedImageIds: ReadonlySet<string>;
  onToggle: (imageId: CustomBackgroundImageId) => void;
  onUpload: (files: ReadonlyArray<File>) => void;
  onLinkFolders: (paths: ReadonlyArray<string>) => void;
  busy: boolean;
  busyLabel: string | null;
}) {
  const previewImageId = selectedImageIds[0] ?? null;
  const label =
    busyLabel ??
    (selectedImageIds.length === 0
      ? "Add images…"
      : selectedImageIds.length === 1
        ? "1 image"
        : `${selectedImageIds.length} images`);
  const images = useStoredBackgroundImages();
  const filesInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [dragTarget, setDragTarget] = useState<DropTarget | null>(null);
  const syncsFolders = canSyncBackgroundFolders();

  function uploadFiles(files: ReadonlyArray<File>) {
    if (busy) return;
    setOpen(false);
    onUpload(files);
  }

  function uploadPicked(input: HTMLInputElement) {
    if (input.files && input.files.length > 0) uploadFiles(imagesFromFiles(input.files));
    input.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLButtonElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = busy ? "none" : "copy";
    if (!busy) setDragTarget(dropTargetOf(event.currentTarget));
  }

  function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    setDragTarget(null);
  }

  function linkFolders(paths: ReadonlyArray<string>) {
    if (busy || paths.length === 0) return;
    setOpen(false);
    onLinkFolders(paths);
  }

  function pickFolder() {
    if (!syncsFolders) {
      folderInputRef.current?.click();
      return;
    }
    void pickBackgroundFolder().then((path) => {
      if (path !== null) linkFolders([path]);
    });
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(null);
    const getPathForFile = window.desktopBridge?.getPathForFile;
    const folderPaths: Array<string> = [];
    const fileItems = Array.from(event.dataTransfer.items).filter((item) => {
      if (!syncsFolders || !getPathForFile || !item.webkitGetAsEntry()?.isDirectory) return true;
      const folder = item.getAsFile();
      const path = folder ? getPathForFile(folder) : "";
      if (path.length === 0) return true;
      folderPaths.push(path);
      return false;
    });
    linkFolders(folderPaths);
    if (fileItems.length === 0) return;
    void imagesFromDrop(fileItems)
      .catch(() => [])
      .then(uploadFiles);
  }

  const dropHandlers = {
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  };

  return (
    <StudioField label="Images">
      <input
        ref={filesInputRef}
        type="file"
        multiple
        accept={BACKGROUND_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Background image file"
        onChange={(event) => uploadPicked(event.currentTarget)}
      />
      <input
        ref={(input) => {
          folderInputRef.current = input;
          if (input) input.webkitdirectory = true;
        }}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label="Background image folder"
        onChange={(event) => uploadPicked(event.currentTarget)}
      />
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          render={
            <button
              type="button"
              {...dropHandlers}
              data-drop-target="input"
              data-dragging={dragTarget === "input"}
              className={backgroundStudioFieldClass(
                "cursor-pointer justify-start gap-2 px-[calc(--spacing(2.5)-1px)] data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/10",
              )}
            >
              <BackgroundThumbnail imageId={previewImageId} className="size-5 rounded-sm" />
              <span className="truncate">{label}</span>
            </button>
          }
        />
        <MenuPopup align="end" className="w-80">
          <div className={cn(backgroundPickerMenuGridClass, "gap-2")}>
            <div className="col-span-full grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                {...dropHandlers}
                data-drop-target="files"
                data-dragging={dragTarget === "files"}
                onClick={() => filesInputRef.current?.click()}
                className={uploadTileClass}
              >
                <UploadIcon className="size-4" />
                <span>Upload or drop images</span>
                <span className="text-2xs leading-(--text-xs--line-height)">
                  {BACKGROUND_FILE_TYPES_LABEL}
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                {...dropHandlers}
                data-drop-target="folder"
                data-dragging={dragTarget === "folder"}
                onClick={pickFolder}
                className={uploadTileClass}
              >
                <FolderPlusIcon className="size-4" />
                <span>Add or drop a folder</span>
                <span className="text-2xs leading-(--text-xs--line-height)">
                  {syncsFolders ? "Stays in sync each launch" : "Only new images import"}
                </span>
              </button>
            </div>
            {images?.map((image) => {
              const position = selectedImageIds.indexOf(image.id);
              const selected = position !== -1;
              return (
                <div key={image.id} className="group relative">
                  <button
                    type="button"
                    aria-label={`Use image ${image.width}×${image.height}`}
                    aria-pressed={selected}
                    onClick={() => onToggle(image.id)}
                    className={backgroundPickerTileClass(selected)}
                  >
                    <BackgroundThumbnail imageId={image.id} className="aspect-[4/3] w-full" />
                    {selected && selectedImageIds.length > 1 ? (
                      <span className="absolute left-1 top-1 flex size-4 items-center justify-center rounded-full bg-primary text-3xs leading-normal font-medium text-primary-foreground">
                        {position + 1}
                      </span>
                    ) : null}
                  </button>
                  {!referencedImageIds.has(image.id) ? (
                    <span className={backgroundPickerDeleteRevealClass}>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-micro"
                              variant="outline"
                              aria-label="Delete unused image"
                              onClick={() => void deleteBackgroundImage(image.id)}
                            >
                              <Trash2Icon />
                            </Button>
                          }
                        />
                        <TooltipPopup side="top">Delete unused image</TooltipPopup>
                      </Tooltip>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="px-2 pb-1 text-2xs leading-normal text-muted-foreground">
            Pick several images to rotate through them.
          </p>
        </MenuPopup>
      </Menu>
    </StudioField>
  );
}
