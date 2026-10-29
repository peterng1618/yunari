import type { ThemeCreditsEntry } from "@yunari/theme-package";
import { uiCopy } from "../ui-copy.js";
import { bytesFromBase64 } from "../video-normalizer.js";

/**
 * The finder's Wallpaper Engine body, fetch-only.
 *
 * The host reads this PC's Steam library, so every answer is a route call; the
 * browser never names a path. A host that is absent, refuses, or answers
 * something else is "not installed" — the tab draws the absence reason rather
 * than an empty grid a person would read as "no wallpapers".
 */

export interface WallpaperEngineItem {
  readonly workshopId: string;
  readonly title: string;
  readonly kind: "video" | "scene";
  readonly previewUrl: string | undefined;
  readonly filesize: number;
  readonly tags: readonly string[];
  readonly stillAtRest: boolean | undefined;
  readonly hasText: boolean | undefined;
  readonly attribution:
    | { readonly steamId?: string; readonly workshopUrl?: string }
    | undefined;
}

export type WallpaperEngineAnswer =
  | {
      readonly available: false;
      readonly reason: "not-installed" | "unsupported-platform" | "no-library";
    }
  | {
      readonly available: true;
      readonly items: readonly WallpaperEngineItem[];
      readonly skipped: number;
    };

export interface WallpaperEngineClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

const REASONS = [
  "not-installed",
  "unsupported-platform",
  "no-library",
] as const;

type Reason = (typeof REASONS)[number];

const KINDS = ["video", "scene"] as const;

/** The payload's real extension, read from the served content type. The asset
 *  route reports no filename today, so the item's title is what names the
 *  `File`; the asset manager then sees an extension it can validate. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/x-ms-wmv": "wmv",
  "video/quicktime": "mov",
};

function request(options?: WallpaperEngineClientOptions): {
  readonly fetcher: typeof fetch;
  readonly url: (path: string) => string;
} {
  return {
    fetcher: options?.fetch ?? globalThis.fetch.bind(globalThis),
    url: (path) => `${options?.baseUrl ?? ""}${path}`,
  };
}

function isReason(value: unknown): value is Reason {
  return REASONS.includes(value as Reason);
}

function isKind(value: unknown): value is WallpaperEngineItem["kind"] {
  return KINDS.includes(value as WallpaperEngineItem["kind"]);
}

/** A field the listing carried, read only when the record itself holds it. */
function stringAt(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}

function attributionOf(value: unknown): WallpaperEngineItem["attribution"] {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const steamId = stringAt(record, "steamId");
  const workshopUrl = stringAt(record, "workshopUrl");
  return steamId === undefined && workshopUrl === undefined
    ? undefined
    : {
        ...(steamId === undefined ? {} : { steamId }),
        ...(workshopUrl === undefined ? {} : { workshopUrl }),
      };
}

/** One item, or nothing: a malformed row is skipped rather than filled in. */
function itemOf(value: unknown): WallpaperEngineItem | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;

  const workshopId = stringAt(record, "workshopId");
  const title = stringAt(record, "title");
  const kind = Object.hasOwn(record, "kind") ? record.kind : undefined;
  const filesize = Object.hasOwn(record, "filesize")
    ? record.filesize
    : undefined;
  if (
    workshopId === undefined ||
    title === undefined ||
    !isKind(kind) ||
    typeof filesize !== "number" ||
    !Number.isFinite(filesize) ||
    filesize < 0
  ) {
    return undefined;
  }

  const tags = Object.hasOwn(record, "tags") ? record.tags : undefined;
  const stillAtRest = Object.hasOwn(record, "stillAtRest")
    ? record.stillAtRest
    : undefined;
  const hasText = Object.hasOwn(record, "hasText") ? record.hasText : undefined;

  return {
    workshopId,
    title,
    kind,
    previewUrl: stringAt(record, "previewUrl"),
    filesize,
    tags: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    stillAtRest: typeof stillAtRest === "boolean" ? stillAtRest : undefined,
    hasText: typeof hasText === "boolean" ? hasText : undefined,
    attribution: attributionOf(
      Object.hasOwn(record, "attribution") ? record.attribution : undefined,
    ),
  };
}

const notInstalled: WallpaperEngineAnswer = {
  available: false,
  reason: "not-installed",
};

export async function fetchWallpaperEngine(
  options?: WallpaperEngineClientOptions,
): Promise<WallpaperEngineAnswer> {
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(url("/api/wallpaper-engine"));
    if (!response.ok) return notInstalled;

    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return notInstalled;
    const answer = body as Record<string, unknown>;

    if (answer.available === false) {
      const reason = Object.hasOwn(answer, "reason")
        ? answer.reason
        : undefined;
      return isReason(reason)
        ? { available: false, reason }
        : { available: false, reason: "not-installed" };
    }
    if (answer.available !== true || !Array.isArray(answer.items)) {
      return notInstalled;
    }

    const items = answer.items
      .map(itemOf)
      .filter((entry): entry is WallpaperEngineItem => entry !== undefined);
    const skipped = answer.skipped;

    return {
      available: true,
      items,
      skipped:
        typeof skipped === "number" && Number.isInteger(skipped) && skipped >= 0
          ? skipped
          : 0,
    };
  } catch {
    return notInstalled;
  }
}

function extensionOf(contentType: string | null): string | undefined {
  const bare = contentType?.split(";")[0]?.trim().toLowerCase();
  return bare === undefined ? undefined : EXTENSIONS[bare];
}

/** The host route an item's own bytes are served from. */
export function itemAssetPath(workshopId: string): string {
  return `/api/wallpaper-engine/item/${encodeURIComponent(workshopId)}/asset`;
}

export async function fetchItemAsset(
  item: WallpaperEngineItem,
  options?: WallpaperEngineClientOptions,
): Promise<File | undefined> {
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(url(itemAssetPath(item.workshopId)));
    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type");
    const served = response.headers.get("x-yunari-filename");
    const extension = extensionOf(contentType);
    const name =
      served === null || served === ""
        ? extension === undefined
          ? item.title
          : `${item.title}.${extension}`
        : served;

    return new File(
      [new Uint8Array(await response.arrayBuffer()) as unknown as BlobPart],
      name,
      { type: contentType?.split(";")[0]?.trim().toLowerCase() ?? "" },
    );
  } catch {
    return undefined;
  }
}

export async function fetchItemPreview(
  workshopId: string,
  options?: WallpaperEngineClientOptions,
): Promise<Blob | undefined> {
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(
      url(
        `/api/wallpaper-engine/item/${encodeURIComponent(workshopId)}/preview`,
      ),
    );
    return response.ok ? await response.blob() : undefined;
  } catch {
    return undefined;
  }
}

/** The attribution an imported item carries. Wallpaper Engine themes declare no
 *  licence, so the entry says it does not know rather than borrowing one. */
export function creditsEntryOf(
  item: WallpaperEngineItem,
  authorName?: string,
): ThemeCreditsEntry {
  const attribution = item.attribution;
  const workshopUrl = attribution?.workshopUrl;
  const steamId = attribution?.steamId;
  const author =
    steamId === undefined && authorName === undefined
      ? undefined
      : {
          ...(steamId === undefined ? {} : { steamId }),
          ...(authorName === undefined ? {} : { name: authorName }),
        };

  return {
    kind: "wallpaper",
    title: item.title,
    ...(author === undefined ? {} : { author }),
    // The id is known whenever the item is, so it is recorded even when no
    // workshop URL was cached; only the link itself is allowed to go missing.
    source: {
      workshopId: item.workshopId,
      ...(workshopUrl === undefined ? {} : { url: workshopUrl }),
    },
    license: "unknown",
    changes: "Copied unchanged",
  };
}

/** A scene's unpack answer. The project is written; no editor process starts. */
export type StartProjectAnswer =
  | { readonly ok: true; readonly name: string; readonly reused: boolean }
  | { readonly ok: false; readonly reason: string };

/** Unpack the item into a local project. The write is the host's; no editor
 *  process starts, and a refusal is an answer, never a throw. */
export async function startProject(
  workshopId: string,
  options?: WallpaperEngineClientOptions,
): Promise<StartProjectAnswer> {
  const { fetcher, url } = request(options);
  const refused: StartProjectAnswer = { ok: false, reason: "refused" };

  try {
    const response = await fetcher(
      url(
        `/api/wallpaper-engine/item/${encodeURIComponent(workshopId)}/project`,
      ),
      { method: "POST" },
    );
    if (!response.ok) return refused;

    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return refused;
    const answer = body as Record<string, unknown>;

    if (answer.ok === true) {
      const name = stringAt(answer, "name");
      return name === undefined
        ? refused
        : { ok: true, name, reused: answer.reused === true };
    }

    const reason = stringAt(answer, "reason");
    return { ok: false, reason: reason ?? "refused" };
  } catch {
    return refused;
  }
}

/** The normalizer answers MP4, so a name from a package's title or the picked
 *  file's stem carries the extension the manager validates. Shared with the
 *  session's video import, which names its declared file the same way. */
export function mp4NameOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return `${dot <= 0 ? name : name.slice(0, dot)}.mp4`;
}

/** A host-prepared package video, ready to declare as an asset. */
export type PrepareMobilePackageAnswer =
  | {
      readonly ok: true;
      readonly file: File;
      readonly title?: string;
      readonly workshopId?: string;
      readonly reencoded: boolean;
    }
  | { readonly ok: false; readonly message: string };

/** The host reads the author's `.mpkg` and normalizes its video; the editor
 *  never parses the package. The returned `File` is what the asset manager
 *  declares, named from the package's title when it carries one. */
export async function prepareMobilePackage(
  file: File,
  options?: WallpaperEngineClientOptions,
): Promise<PrepareMobilePackageAnswer> {
  const { fetcher, url } = request(options);
  const failed = (message: string): PrepareMobilePackageAnswer => ({
    ok: false,
    message,
  });

  try {
    const response = await fetcher(url("/api/wallpaper-engine/mpkg"), {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!response.ok) {
      // The host's sentence names the rule the package broke; a transport
      // refusal with no body keeps the pane's own words.
      const reason = await response.text().catch(() => "");
      return failed(
        reason.trim() === "" ? uiCopy.panels.assetImportFailed : reason.trim(),
      );
    }

    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null)
      return failed(uiCopy.panels.assetImportFailed);
    const answer = body as Record<string, unknown>;

    if (answer.ok !== true)
      return failed(
        stringAt(answer, "message") ?? uiCopy.panels.assetImportFailed,
      );
    if (typeof answer.videoBase64 !== "string")
      return failed(uiCopy.panels.assetImportFailed);

    const title = stringAt(answer, "title");
    const workshopId = stringAt(answer, "workshopId");
    return {
      ok: true,
      file: new File(
        [bytesFromBase64(answer.videoBase64) as unknown as BlobPart],
        title === undefined ? mp4NameOf(file.name) : `${title}.mp4`,
        { type: "video/mp4" },
      ),
      ...(title === undefined ? {} : { title }),
      ...(workshopId === undefined ? {} : { workshopId }),
      reencoded: answer.reencoded === true,
    };
  } catch {
    return failed(uiCopy.panels.assetImportFailed);
  }
}

/** The Steam persona behind an item's author id. A read that fails — offline,
 *  refused, or malformed — is absence, never a fabricated name. */
export async function fetchAuthorName(
  steamId: string,
  options?: WallpaperEngineClientOptions,
): Promise<string | undefined> {
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(
      url(`/api/wallpaper-engine/author/${encodeURIComponent(steamId)}`),
    );
    if (!response.ok) return undefined;

    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return undefined;
    return stringAt(body as Record<string, unknown>, "name");
  } catch {
    return undefined;
  }
}
