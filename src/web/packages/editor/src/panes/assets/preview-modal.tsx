import type { AssetReference } from "@yunari/renderer-core";
import type * as React from "react";
import { useState } from "react";
import {
  assetFileName,
  type LocalAssetReference,
} from "../../asset-manager/index.js";
import { ActionBox, Dialog } from "../../components/ui/dialog.js";
import { type ModalSettle, openModal } from "../../components/ui/modal-host.js";
import {
  DELETE_ITEM_GLYPH,
  KIND_GLYPHS,
  type LucideIcon,
  PLACE_ON_CANVAS_GLYPH,
  REPLACE_ASSET_GLYPH,
} from "../../editor-shell/icons.js";
import { uiCopy } from "../../ui-copy.js";

/**
 * A declared file the preview can show. The union is written out rather than as
 * `Exclude<LocalAssetReference, ...>` because the plain `AssetReference` arm
 * admits `"font"` too — the point of this type is that a face never reaches a
 * surface whose subject is a picture.
 */
export type PlacedOrLocalAsset = AssetReference & {
  readonly kind: "image" | "svg" | "video";
};

/** What the preview modal needs to draw and to answer. The pane supplies its
 *  own closures, so the modal owns no document write and no picker. */
export interface AssetPreviewInput {
  readonly asset: PlacedOrLocalAsset;
  /** The manager's own blob URL for a picture; the pane's held URL for a video,
   *  which `AssetManager.previewUrl` deliberately answers `undefined` for. */
  readonly previewUrl: string | undefined;
  readonly inUse: boolean;
  /** The declared bytes' length, read from the package by the pane. A file the
   *  manager holds no bytes for has no reading and draws no size. */
  readonly sizeBytes: number | undefined;
  readonly onRemove: () => Promise<void>;
  readonly onReplace: () => void;
  readonly onBackground: (() => void) | undefined;
  readonly onPlace: (() => void) | undefined;
  /** Called once, after the surface has closed, so the caller can release a
   *  URL it minted for the preview. */
  readonly onClose: () => void;
}

type PreviewAction = "remove" | "replace" | "background" | "place";

interface PillReading {
  readonly id: string;
  readonly name: string;
  readonly mono: boolean;
  readonly proposed: boolean;
}

/** One pill: the `--panel-2` inside a 1px edge at a full radius. A
 *  reading the package does not hold is dashed and muted — the mark
 *  for `None recorded`. A long reading (a source URL, an attribution sentence)
 *  is one truncated line with the whole value on `title`: the pills
 *  are chips, and a three-line chip is not one. */
function Pill({
  reading,
}: {
  readonly reading: PillReading;
}): React.JSX.Element {
  return (
    <span
      data-yunari-asset-preview-pill={reading.id}
      title={reading.name}
      className={`inline-block max-w-full truncate rounded-full border bg-panel-2 px-[var(--space-10)] py-[var(--space-4)] text-xs font-medium ${
        reading.proposed
          ? "border-dashed border-edge text-muted"
          : "border-edge text-text"
      } ${reading.mono ? "font-mono" : ""}`}
    >
      {reading.name}
    </span>
  );
}

/** The eyebrow over its pills. An empty group is not drawn: a heading over
 *  nothing is a word that says nothing, which is what a video whose metadata
 *  has not arrived would otherwise leave on screen. */
function PillGroup({
  id,
  name,
  readings,
}: {
  readonly id: string;
  readonly name: string;
  readonly readings: readonly PillReading[];
}): React.JSX.Element | null {
  if (readings.length === 0) return null;
  return (
    <div
      data-yunari-asset-preview-group={id}
      className="flex flex-col gap-[var(--space-6)]"
    >
      <span className="text-2xs font-semibold tracking-[0.11em] text-faint uppercase">
        {name}
      </span>
      <span className="flex flex-wrap gap-[var(--space-6)]">
        {readings.map((reading) => (
          <Pill key={reading.id} reading={reading} />
        ))}
      </span>
    </div>
  );
}

/** The size's aspect ratio in its lowest whole terms (`2400×1600` → `3:2`).
 *  Repetends (`1366×768`) keep the divisor's remainder rather than inventing a
 *  rounded bucket: the pill is a measurement, not a classification. */
function ratioOf(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${width / divisor}:${height / divisor}`;
}

/** The attribution pills: the declaration's own licence and source, each once.
 *  Nothing recorded is said rather than left blank. */
function attributionReadings(
  asset: PlacedOrLocalAsset,
): readonly PillReading[] {
  const readings: PillReading[] = [];
  const seen = new Set<string>();
  const add = (id: string, name: string | undefined, mono: boolean): void => {
    if (name === undefined || name === "" || seen.has(name)) return;
    seen.add(name);
    readings.push({ id, name, mono, proposed: false });
  };
  add("license", asset.license?.name, false);
  add("attribution", asset.license?.attribution, false);
  add("source", asset.sourceUrl, true);
  if (readings.length === 0) {
    readings.push({
      id: "none",
      name: uiCopy.assets.preview.noneRecorded,
      mono: false,
      proposed: true,
    });
  }
  return readings;
}

/**
 * The asset preview: the declared file at the size it will be used, with the
 * facts and the eligible commands on a 270px panel.
 *
 * **The pane opens it, and the pane acts.** Every command here is a callback
 * the pane supplied, so Remove runs through the pane's `submit()` and the
 * render and sentence follow exactly as its card buttons' do; Replace opens the
 * pane's own replace picker, because a second picker would be a second import
 * path.
 *
 * **One surface for a picture and a video.** A video drops Place and draws a
 * player; Background becomes its primary command. A font has no preview at all
 * — the finder owns a face's specimen.
 */
function AssetPreviewModal({
  input,
  settle,
}: {
  readonly input: AssetPreviewInput;
  readonly settle: ModalSettle<void>;
}): React.JSX.Element {
  const copy = uiCopy.assets.preview;
  const { asset } = input;
  // The media's own reading, not a guess: a picture's `naturalWidth` and a
  // video's `videoWidth` arrive after load, and until one does the caption shows
  // the verb without the numbers.
  const [size, setSize] = useState<
    { readonly width: number; readonly height: number } | undefined
  >();

  const close = (): void => settle.dismiss();

  const actions: readonly {
    readonly id: PreviewAction;
    readonly label: string;
    readonly icon: LucideIcon;
    readonly primary: boolean;
    readonly press: () => void;
  }[] = [
    {
      id: "remove",
      label: uiCopy.panels.assetCard.remove,
      icon: DELETE_ITEM_GLYPH,
      primary: false,
      press: () => {
        // The pane states its own refusal behind the surface; either answer
        // closes, so a refused removal is not a modal left hanging.
        void input.onRemove().then(close, close);
      },
    },
    {
      id: "replace",
      label: uiCopy.panels.assetCard.replace,
      icon: REPLACE_ASSET_GLYPH,
      primary: false,
      press: () => {
        input.onReplace();
        close();
      },
    },
    ...(input.onBackground === undefined
      ? []
      : [
          {
            id: "background" as const,
            label: copy.background,
            icon: KIND_GLYPHS.image,
            // A video has no Place: Background is the one canvas write left.
            primary: asset.kind === "video",
            press: () => {
              input.onBackground?.();
              close();
            },
          },
        ]),
    ...(input.onPlace === undefined || asset.kind === "video"
      ? []
      : [
          {
            id: "place" as const,
            label: copy.place,
            icon: PLACE_ON_CANVAS_GLYPH,
            // A picture's one canvas write: the foot's primary verb.
            primary: true,
            press: () => {
              input.onPlace?.();
              close();
            },
          },
        ]),
  ];

  const shapeReadings: readonly PillReading[] =
    size === undefined
      ? []
      : [
          {
            id: "size",
            name: `${size.width}×${size.height}`,
            mono: true,
            proposed: false,
          },
          {
            id: "ratio",
            name: ratioOf(size.width, size.height),
            mono: true,
            proposed: false,
          },
        ];
  const attribution = attributionReadings(asset);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      label={assetFileName(asset)}
      closeLabel={copy.close}
      closeIcon
      className="editor-shell-dialog--asset-preview"
    >
      <div
        data-yunari-asset-preview-modal=""
        className="flex min-h-0 min-w-0 flex-1"
      >
        {/* The stage: the file contained at every size, nothing cropped, and
            one height for every file so the box does not move between them. */}
        <div
          data-yunari-asset-preview-stage=""
          className="relative flex min-w-0 flex-1 items-center justify-center p-[var(--space-20)] [background:var(--asset-preview-stage)]"
        >
          {asset.kind === "video" ? (
            <video
              data-yunari-asset-preview-player=""
              className="max-h-full max-w-full rounded-[var(--radius-md)] object-contain"
              {...(input.previewUrl === undefined
                ? {}
                : { src: input.previewUrl })}
              controls
              muted
              loop
              autoPlay
              playsInline
              onLoadedMetadata={(event) => {
                const player = event.currentTarget;
                if (player.videoWidth > 0 && player.videoHeight > 0) {
                  setSize({
                    width: player.videoWidth,
                    height: player.videoHeight,
                  });
                }
              }}
            />
          ) : input.previewUrl === undefined ? null : (
            <img
              data-yunari-asset-preview-image=""
              className="max-h-full max-w-full rounded-[var(--radius-md)] object-contain"
              src={input.previewUrl}
              alt=""
              onLoad={(event) => {
                const image = event.currentTarget;
                if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                  setSize({
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  });
                }
              }}
            />
          )}
          {input.previewUrl === undefined ? null : (
            <span
              data-yunari-asset-preview-caption=""
              className="absolute bottom-[var(--space-12)] left-[var(--space-16)] rounded-[var(--radius-sm)] bg-panel/90 px-[var(--space-8)] py-[var(--space-4)] font-mono text-2xs text-muted"
            >
              {size === undefined
                ? copy.fit
                : `${size.width} × ${size.height} · ${copy.fit}`}
            </span>
          )}
        </div>

        <div
          data-yunari-asset-preview-panel=""
          className="flex w-[var(--asset-preview-panel-width)] flex-none flex-col border-l border-edge bg-panel"
        >
          <div className="flex flex-none flex-col gap-[var(--space-6)] border-b border-edge pt-[var(--space-14)] pr-[var(--asset-preview-header-gutter)] pb-[var(--space-12)] pl-[var(--space-16)]">
            <div className="flex min-w-0 items-start gap-[var(--space-8)]">
              <span className="min-w-0 break-words text-lg font-semibold text-text [overflow-wrap:anywhere]">
                {assetFileName(asset)}
              </span>
              <span className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-muted">
                {uiCopy.panels.assetCard.kind[asset.kind]}
              </span>
            </div>
            <div className="flex items-center gap-[var(--space-8)]">
              <span
                data-yunari-asset-preview-badge=""
                className="flex-none rounded-full border border-edge px-[var(--space-8)] py-[var(--space-4)] text-2xs font-medium text-faint"
              >
                {input.inUse
                  ? uiCopy.panels.assetCard.inUse
                  : uiCopy.panels.assetCard.unused}
              </span>
              <span className="flex-1" />
              {input.sizeBytes === undefined ? null : (
                <span className="flex-none font-mono text-2xs text-faint">
                  {copy.size(input.sizeBytes)}
                </span>
              )}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-12)] overflow-auto px-[var(--space-16)] py-[var(--space-12)]">
            <PillGroup id="shape" name={copy.shape} readings={shapeReadings} />
            <PillGroup
              id="attribution"
              name={copy.attribution}
              readings={attribution}
            />

            <div className="flex flex-col gap-[var(--space-4)] border-t border-edge-2 pt-[var(--space-6)] text-2xs text-faint">
              <span id="asset-preview-usage">
                {input.inUse ? copy.usedBySome : copy.usedByNothing}
              </span>
            </div>
          </div>

          <div className="grid flex-none grid-cols-2 gap-[var(--space-6)] border-t border-edge px-[var(--space-16)] py-[var(--space-12)]">
            {actions.map((action) => (
              <ActionBox
                key={action.id}
                data={{ "data-yunari-asset-preview-action": action.id }}
                icon={action.icon}
                label={action.label}
                {...(action.primary ? { tone: "accent" as const } : {})}
                {...(action.id === "remove"
                  ? {
                      destructive: true,
                      // A referenced asset cannot be removed, so the reason is
                      // what the disabled box points at rather than a refusal
                      // spoken behind a surface that already closed.
                      ...(input.inUse
                        ? {
                            disabled: true as const,
                            describedById: "asset-preview-usage",
                          }
                        : {}),
                    }
                  : {})}
                onClick={action.press}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Opens the asset preview and resolves when it closes.
 *
 * `onClose` runs after the surface has unmounted, which is where the caller
 * releases anything it minted (the pane's video blob URL).
 */
export function openAssetPreview(input: AssetPreviewInput): Promise<void> {
  return openModal<void>((settle) => (
    <AssetPreviewModal input={input} settle={settle} />
  )).then(() => input.onClose());
}

/** The pane's half: a declaration is previewable when a picture or a movie is
 *  its subject, which is every kind the manager declares but a face. */
export function isPreviewable(
  asset: LocalAssetReference,
): asset is PlacedOrLocalAsset {
  return (
    asset.kind === "image" || asset.kind === "svg" || asset.kind === "video"
  );
}
