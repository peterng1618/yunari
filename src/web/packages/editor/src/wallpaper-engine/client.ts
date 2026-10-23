import type { ThemeCreditsEntry } from "@yunari/theme-package";

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
  readonly kind: "image" | "video" | "web" | "scene";
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

const KINDS = ["image", "video", "web", "scene"] as const;

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

export async function fetchItemAsset(
  item: WallpaperEngineItem,
  options?: WallpaperEngineClientOptions,
): Promise<File | undefined> {
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(
      url(
        `/api/wallpaper-engine/item/${encodeURIComponent(item.workshopId)}/asset`,
      ),
    );
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
export function creditsEntryOf(item: WallpaperEngineItem): ThemeCreditsEntry {
  const attribution = item.attribution;
  const workshopUrl = attribution?.workshopUrl;
  const steamId = attribution?.steamId;

  return {
    kind: "wallpaper",
    title: item.title,
    ...(steamId === undefined ? {} : { author: { steamId } }),
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

/** A scene's unpack answer. `launched` false means the project exists but no
 *  editor process started; the caller names the project rather than retrying. */
export type StartProjectAnswer =
  | {
      readonly ok: true;
      readonly name: string;
      readonly reused: boolean;
      readonly launched: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/** One file Wallpaper Engine wrote into a watched export directory. */
export interface ExportFile {
  readonly name: string;
  readonly format: "png" | "mp4";
  readonly modified: number;
  readonly size: number;
}

/** How often the sheet asks the host for a newer export. */
export const EXPORT_POLL_MS = 2000;

const EXPORT_FORMATS = ["png", "mp4"] as const;

function exportFileOf(value: unknown): ExportFile | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const name = stringAt(record, "name");
  const format = Object.hasOwn(record, "format") ? record.format : undefined;
  const modified = Object.hasOwn(record, "modified")
    ? record.modified
    : undefined;
  const size = Object.hasOwn(record, "size") ? record.size : undefined;

  if (
    name === undefined ||
    !EXPORT_FORMATS.includes(format as (typeof EXPORT_FORMATS)[number]) ||
    typeof modified !== "number" ||
    !Number.isFinite(modified) ||
    typeof size !== "number" ||
    !Number.isFinite(size) ||
    size < 0
  ) {
    return undefined;
  }

  return { name, format: format as ExportFile["format"], modified, size };
}

/** Unpack the item and launch Wallpaper Engine's editor on it. The write is the
 *  host's; a refusal is an answer, never a throw. */
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
        : {
            ok: true,
            name,
            reused: answer.reused === true,
            launched: answer.launched === true,
          };
    }

    const reason = stringAt(answer, "reason");
    return { ok: false, reason: reason ?? "refused" };
  } catch {
    return refused;
  }
}

/** The exports written since the sheet opened, newest first. A host that
 *  refuses answers nothing rather than inventing a file. */
export async function findExports(
  since: number,
  options?: WallpaperEngineClientOptions,
): Promise<readonly ExportFile[]> {
  if (!Number.isSafeInteger(since) || since < 0) return [];
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(
      url(`/api/wallpaper-engine/exports?since=${since}`),
    );
    if (!response.ok) return [];

    const body = (await response.json()) as unknown;
    if (typeof body !== "object" || body === null) return [];
    const files = Object.hasOwn(body, "files")
      ? (body as Record<string, unknown>).files
      : undefined;
    if (!Array.isArray(files)) return [];

    return files
      .map(exportFileOf)
      .filter((file): file is ExportFile => file !== undefined);
  } catch {
    return [];
  }
}

/** One export's bytes, named by the host's header and otherwise by the name the
 *  listing gave — which already carries the format's extension. */
export async function fetchExport(
  name: string,
  options?: WallpaperEngineClientOptions,
): Promise<File | undefined> {
  const { fetcher, url } = request(options);

  try {
    const response = await fetcher(
      url(`/api/wallpaper-engine/export?name=${encodeURIComponent(name)}`),
    );
    if (!response.ok) return undefined;

    const contentType = response.headers.get("content-type");
    const served = response.headers.get("x-yunari-filename");
    return new File(
      [new Uint8Array(await response.arrayBuffer()) as unknown as BlobPart],
      served === null || served === "" ? name : served,
      { type: contentType?.split(";")[0]?.trim().toLowerCase() ?? "" },
    );
  } catch {
    return undefined;
  }
}
