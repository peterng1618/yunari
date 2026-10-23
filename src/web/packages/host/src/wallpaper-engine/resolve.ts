import fs from "node:fs/promises";
import path from "node:path";

import type { LibraryItem } from "./library.js";

/**
 * What one item resolves to (§4), first match wins: an image extension is an
 * image before the type is consulted, then the type decides. A payload that is
 * not on disk is not an outcome — the item is dropped rather than listed with
 * nothing behind it.
 */

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
] as const;

export type ItemPayload =
  | {
      readonly kind: "image";
      readonly path: string;
      readonly contentType: string;
    }
  | {
      readonly kind: "video";
      readonly path: string;
      readonly contentType: string;
    }
  | { readonly kind: "web" }
  | { readonly kind: "scene"; readonly path: string };

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};

const VIDEO_TYPES: Readonly<Record<string, string>> = {
  ".mp4": "video/mp4",
  ".wmv": "video/x-ms-wmv",
};

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** True when `target` is `directory` or below it, on the same drive. */
export function insideOf(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

export async function resolvePayload(
  item: LibraryItem,
): Promise<ItemPayload | undefined> {
  // `project.file` is third-party content, so a path that leaves the item's own
  // directory is not a payload. A payload absent from disk is not an outcome
  // either (§4): the item is dropped rather than served as an empty asset.
  if (!insideOf(item.directory, item.payload)) {
    return undefined;
  }
  if (!(await exists(item.payload))) {
    return undefined;
  }

  const extension = path.extname(item.payload).toLowerCase();
  const imageType = IMAGE_TYPES[extension];
  if (imageType !== undefined) {
    return { kind: "image", path: item.payload, contentType: imageType };
  }

  if (item.type === "video") {
    return {
      kind: "video",
      path: item.payload,
      contentType: VIDEO_TYPES[extension] ?? "application/octet-stream",
    };
  }
  if (item.type === "web") {
    return { kind: "web" };
  }

  return { kind: "scene", path: item.payload };
}
