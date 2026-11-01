import type { FontAssetReference } from "@yunari/renderer-core";
import {
  ASSET_FILE_EXTENSIONS,
  type LocalAssetReference,
  mimeOf,
} from "../../asset-manager/index.js";
import { uiCopy } from "../../ui-copy.js";
import type { FontMetadata } from "./font-metadata-form.js";

/** The metadata a declared face carries, read back into the form. */
export function metadataOfFont(asset: FontAssetReference): FontMetadata {
  const weight = Number(asset.weight);
  return {
    family: asset.family,
    // A declaration always carries a usable weight; a hand-edited package that
    // does not falls back to the parser's default rather than printing NaN.
    weight: Number.isFinite(weight) && weight > 0 ? weight : 400,
    style: asset.style,
    licence: asset.license?.name ?? "unknown",
    ...(asset.sourceUrl === undefined ? {} : { sourceUrl: asset.sourceUrl }),
  };
}

type LocalAssetKind = LocalAssetReference["kind"];

/** Which section a declared kind is drawn in. A total map, so a kind the
 *  manager grows fails to compile here rather than drawing nowhere. An SVG is
 *  an image file, so it sits with Images rather than inventing a section. */
export const GROUP_OF: Readonly<Record<LocalAssetKind, SectionId>> = {
  font: "fonts",
  image: "images",
  svg: "images",
  video: "videos",
};

export type SectionId = "fonts" | "images" | "videos";

export const SECTIONS: readonly {
  readonly id: SectionId;
  readonly label: string;
}[] = [
  { id: "fonts", label: uiCopy.assets.category.font },
  { id: "images", label: uiCopy.assets.category.image },
  { id: "videos", label: uiCopy.assets.category.video },
];

export const ASSET_FILE_ACCEPT = `${ASSET_FILE_EXTENSIONS.map((ext) => `.${ext}`).join(",")},.mpkg`;
/** A replacement is a declared asset's own byte swap, so a container the import
 *  path intercepts (`.mpkg`) has no place here. */
export const REPLACE_FILE_ACCEPT = ASSET_FILE_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",");

/** The package is intercepted before the manager sees it: a `.mpkg` is a
 *  container the host reads, never a declared asset. */
export function isPackageFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(".mpkg");
}

export function isVideoFile(file: File): boolean {
  return mimeOf(file.name)?.startsWith("video/") === true;
}

/** One card, and every declaration it stands for. A font family is one card:
 *  its weights are a choice a preset makes, not files the author picked, so
 *  importing six weights must not draw six cards. */
interface AssetRow {
  readonly key: string;
  /** The face the card's actions act on: weight 400 where the family has it. */
  readonly asset: LocalAssetReference;
  readonly ids: readonly string[];
  readonly label?: string;
  readonly detail?: string;
}

function isFace(asset: LocalAssetReference): asset is LocalAssetReference & {
  readonly family: string;
  readonly weight: string | number;
  readonly style: string;
  readonly format: string;
} {
  return "family" in asset && typeof asset.family === "string";
}

/** `font · woff2 · 400 normal · 700 normal`: what a family card holds. */
function faceDetail(faces: readonly LocalAssetReference[]): string {
  const parts = faces.flatMap((face) =>
    isFace(face) ? [`${face.weight} ${face.style}`] : [],
  );
  const format = faces
    .map((face) => (isFace(face) ? face.format : ""))
    .find((value) => value !== "");
  return [
    uiCopy.panels.assetCard.kind.font,
    ...(format === undefined ? [] : [format]),
    ...parts,
  ].join(" · ");
}

export function rowsOf(
  assets: readonly LocalAssetReference[],
): readonly AssetRow[] {
  const families = new Map<string, LocalAssetReference[]>();
  for (const asset of assets) {
    if (!isFace(asset)) continue;
    const faces = families.get(asset.family);
    if (faces === undefined) families.set(asset.family, [asset]);
    else faces.push(asset);
  }
  const seen = new Set<string>();
  const rows: AssetRow[] = [];
  for (const asset of assets) {
    if (!isFace(asset)) {
      rows.push({ key: asset.id, asset, ids: [asset.id] });
      continue;
    }
    // A family's card sits where its first face was declared.
    if (seen.has(asset.family)) continue;
    seen.add(asset.family);
    const faces = families.get(asset.family) ?? [asset];
    const lead =
      faces.find(
        (face) =>
          isFace(face) &&
          Number(face.weight) === 400 &&
          face.style === "normal",
      ) ?? faces[0]!;
    rows.push({
      key: `font:${asset.family}`,
      asset: lead,
      ids: faces.map((face) => face.id),
      label: asset.family,
      detail: faceDetail(faces),
    });
  }
  return rows;
}

/**
 * What the pane says an import did, decided by the kind.
 *
 * The switch has no `default`, so a fifth kind in the manager's `TYPES` fails to
 * compile here rather than falling through to the placed message: the kind union
 * is what decides, and the code should have to say so.
 */
export function importMessage(asset: LocalAssetReference): string {
  switch (asset.kind) {
    case "image":
    case "svg":
      return uiCopy.panels.assetPlaced;
    case "video":
      // A video is the modal's now, which names its own outcome; the arm stays
      // so the switch remains total over the manager's kinds.
      return uiCopy.panels.assetDeclaredOnly;
    case "font":
      return uiCopy.panels.assetDeclaredFont;
  }
}
