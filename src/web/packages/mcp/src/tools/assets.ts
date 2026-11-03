import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { FontAssetFormat } from "@yunari/renderer-core";
import {
  addAsset,
  assetKindForPath,
  assetOwner,
  type DeclaredAsset,
  declareAsset,
  MAX_ASSET_BYTES,
  removeAsset,
} from "@yunari/theme-kit";
import { z } from "zod/v4";
import type { ThemeCredits, ToolContext, VideoTrim } from "../types.js";
import { draftFor } from "./draft.js";
import { errorResult, imageResult, jsonAttempt } from "./result.js";

/** One face's registration metadata, carried so import can declare it. */
export interface AssetRefFont {
  readonly family: string;
  readonly weight: string | number;
  readonly style: "normal" | "italic";
  readonly format: FontAssetFormat;
  readonly subset?: string;
}

/** The opaque, agent-carried reference to one finder result. */
export interface AssetRef {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly preview: string;
  readonly licence: string;
  readonly sourceUrl: string;
  /** Present for a font row: the lead face's metadata. */
  readonly font?: AssetRefFont;
}

function encodeRef(ref: AssetRef): string {
  return Buffer.from(JSON.stringify(ref), "utf8").toString("base64");
}

const FONT_FORMATS: ReadonlySet<string> = new Set([
  "woff2",
  "woff",
  "ttf",
  "otf",
]);

function fontOf(value: unknown): AssetRefFont | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw new Error('That assetRef has a malformed "font".');
  }
  const font = value as Record<string, unknown>;
  const { family, weight, style, format, subset } = font;
  if (typeof family !== "string" || family.trim() === "") {
    throw new Error('That assetRef font has no "family".');
  }
  if (
    (typeof weight !== "string" && typeof weight !== "number") ||
    (style !== "normal" && style !== "italic") ||
    typeof format !== "string" ||
    !FONT_FORMATS.has(format)
  ) {
    throw new Error(
      "That assetRef font has no usable weight, style or format.",
    );
  }
  if (subset !== undefined && typeof subset !== "string") {
    throw new Error('That assetRef font has a malformed "subset".');
  }
  return {
    family,
    weight,
    style,
    format: format as FontAssetFormat,
    ...(subset === undefined ? {} : { subset }),
  };
}

function decodeRef(value: string): AssetRef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    throw new Error("That assetRef is not base64 JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("That assetRef is not an asset reference.");
  }
  const record = parsed as Record<string, unknown>;
  const text = (key: keyof AssetRef): string => {
    const field = record[key];
    if (typeof field !== "string") {
      throw new Error(`That assetRef has no "${key}".`);
    }
    return field;
  };
  // The ref is opaque and carried by hand, so a copy can arrive with the US
  // spelling of this one label. Accepting it keeps a recoverable ref usable.
  const licence = record["licence"] ?? record["license"];
  if (typeof licence !== "string") {
    const keys = Object.keys(record).sort().join(", ") || "(none)";
    throw new Error(`That assetRef has no "licence". Its keys are ${keys}.`);
  }
  const font = fontOf(record["font"]);
  return {
    source: text("source"),
    id: text("id"),
    name: text("name"),
    kind: text("kind"),
    preview: text("preview"),
    licence,
    sourceUrl: text("sourceUrl"),
    ...(font === undefined ? {} : { font }),
  };
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

function extensionOf(path: string): string {
  return extname(path).slice(1).toLowerCase();
}

/** The extension a host response's media type implies, when no filename did. */
function extensionOfContentType(contentType: string): string {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const known: Readonly<Record<string, string>> = {
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "font/woff2": "woff2",
    "font/woff": "woff",
    "font/ttf": "ttf",
    "font/otf": "otf",
  };
  return known[type] ?? "";
}

function mimeOf(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? "application/octet-stream";
}

function isVideo(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(path));
}

function extensionForKind(kind: string): string {
  return kind === "svg" || kind === "icon"
    ? "svg"
    : kind === "gif"
      ? "gif"
      : kind === "video"
        ? "mp4"
        : kind === "font"
          ? "woff2"
          : "png";
}

/** Wallpaper Engine is a library on this PC, not a searchable provider, so a
 *  page of its matches is fixed rather than paged through the finder. */
const WALLPAPER_PAGE_SIZE = 40;

/** The finder answers with ids already prefixed `<source>:`; keep them whole. */
export async function searchAssets(
  context: ToolContext,
  query: string,
  sourceIds?: readonly string[],
  page?: number,
): Promise<CallToolResult> {
  return await jsonAttempt(async () => {
    const sources = await context.host.listAssetSources().catch(() => []);
    const enabled = sourceIds ?? sources.map((source) => source.id);
    if (enabled.length === 0) {
      throw new Error("This host has no asset sources to search.");
    }

    const selected = enabled.map((id) => {
      const source = sources.find((candidate) => candidate.id === id);
      // An id the listing omitted is still searched as a grid source: the host
      // owns which sources exist and refuses or ignores an unknown one.
      return source ?? { id, body: "grid" as const };
    });

    // A finder body is per source family: a font source answers the picker's
    // shape, a grid source the search shape, and Wallpaper Engine only lists.
    const idsOf = (body: string): string[] =>
      selected
        .filter((source) => source.body === body)
        .map((source) => source.id);

    const requestFor = (
      body: "grid" | "font-picker",
      ids: readonly string[],
    ) => {
      const pages: Record<string, number> = {};
      for (const id of ids) pages[id] = page ?? 1;
      return context.host.searchAssets({ query, enabled: ids, pages, body });
    };

    const grid = idsOf("grid");
    const fonts = idsOf("font-picker");
    const wallpapers = idsOf("wallpaper-engine").length > 0;

    const [gridAnswer, fontAnswer, wallpaperAnswer] = await Promise.all([
      grid.length === 0
        ? Promise.resolve({ pages: [] })
        : requestFor("grid", grid),
      fonts.length === 0
        ? Promise.resolve({ pages: [] })
        : requestFor("font-picker", fonts),
      wallpapers
        ? context.host.listWallpapers().catch((error: unknown) => ({
            available: false as const,
            reason: error instanceof Error ? error.message : String(error),
          }))
        : Promise.resolve(undefined),
    ]);

    const rows = [...gridAnswer.pages, ...fontAnswer.pages].flatMap(
      (answerPage) =>
        answerPage.results.map((result) => {
          const cut = result.font?.cuts[0];
          const font =
            cut === undefined
              ? undefined
              : {
                  family: cut.family,
                  weight: cut.weight,
                  style: cut.style,
                  format: cut.format,
                  ...(cut.subset === undefined ? {} : { subset: cut.subset }),
                };
          return {
            assetRef: encodeRef({
              source: answerPage.source,
              id: result.id,
              name: result.name,
              kind: result.kind,
              preview:
                result.preview === ""
                  ? (cut?.previewUrl ?? "")
                  : result.preview,
              licence: result.licence,
              sourceUrl: result.sourceUrl,
              ...(font === undefined ? {} : { font }),
            }),
            name: result.name,
            kind: result.kind,
            preview:
              result.preview === "" ? (cut?.previewUrl ?? "") : result.preview,
            licence: result.licence,
            sourceUrl: result.sourceUrl,
            ...(result.subtitle === undefined
              ? {}
              : { subtitle: result.subtitle }),
            ...(font === undefined ? {} : { font }),
          };
        }),
    );

    const wallpaperRows =
      wallpaperAnswer === undefined || wallpaperAnswer.available !== true
        ? []
        : (wallpaperAnswer.items ?? [])
            .filter(
              (item) =>
                item.kind === "video" &&
                item.title.toLowerCase().includes(query.trim().toLowerCase()),
            )
            .slice(0, WALLPAPER_PAGE_SIZE)
            .map((item) => {
              const preview = `${context.host.url}/api/wallpaper-engine/item/${encodeURIComponent(item.workshopId)}/preview`;
              const sourceUrl = item.attribution?.workshopUrl ?? "";
              return {
                assetRef: encodeRef({
                  source: "wallpaper-engine",
                  id: item.workshopId,
                  name: item.title,
                  kind: "video",
                  preview,
                  licence: "Unknown",
                  sourceUrl,
                }),
                name: item.title,
                kind: "video",
                preview,
                licence: "Unknown",
                sourceUrl,
                subtitle: `${Math.round(item.filesize / 1024 / 1024)} MB · Wallpaper Engine`,
              };
            });

    const failures: {
      source: string;
      reason: string;
      message?: string;
      credential?: string;
    }[] = [...gridAnswer.pages, ...fontAnswer.pages].flatMap((answerPage) =>
      answerPage.failure === undefined
        ? []
        : [{ source: answerPage.source, ...answerPage.failure }],
    );
    if (wallpaperAnswer !== undefined && wallpaperAnswer.available !== true) {
      failures.push({
        source: "wallpaper-engine",
        reason: "failed",
        message:
          wallpaperAnswer.reason ??
          "The Wallpaper Engine library is unavailable.",
      });
    }

    return { results: [...rows, ...wallpaperRows], failures };
  });
}

/** Results whose own bytes are the picture. Everything else — a video, a
 *  scene, a font — answers with the row's preview instead. */
const IMAGE_KINDS = new Set(["image", "svg", "gif"]);

const PREVIEW_TIMEOUT_MS = 10_000;

/** The row's poster still, or nothing when the source published none or the
 *  fetch cannot answer with an image. A relative preview resolves against the
 *  host, so the host's own Wallpaper Engine stills work alongside remote ones. */
async function previewStill(
  ref: AssetRef,
  baseUrl: string,
): Promise<
  { readonly bytes: Uint8Array; readonly mimeType: string } | undefined
> {
  if (ref.preview === "") return undefined;
  let url: URL;
  try {
    url = new URL(ref.preview, baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PREVIEW_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (mimeType === undefined || !mimeType.startsWith("image/")) {
      return undefined;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > MAX_ASSET_BYTES ? undefined : { bytes, mimeType };
  } catch {
    return undefined;
  }
}

export async function previewAsset(
  context: ToolContext,
  assetRef: string,
): Promise<CallToolResult> {
  try {
    const ref = decodeRef(assetRef);
    if (!IMAGE_KINDS.has(ref.kind)) {
      const still = await previewStill(ref, context.host.url);
      if (still !== undefined) {
        return imageResult(still.bytes, still.mimeType, {
          name: ref.name,
          kind: ref.kind,
          licence: ref.licence,
          sourceUrl: ref.sourceUrl,
          bytes: still.bytes.byteLength,
        });
      }
      throw new Error(
        `"${ref.name}" is a ${ref.kind}, not an image this tool can preview.`,
      );
    }
    const { bytes, filename } = await context.host.assetBytes(
      ref.source,
      ref.id,
    );
    const mimeType = mimeOf(filename === "" ? ref.id : filename);
    if (!mimeType.startsWith("image/")) {
      throw new Error(
        `"${ref.name}" is a ${ref.kind}, not an image this tool can preview.`,
      );
    }
    return imageResult(bytes, mimeType, {
      name: ref.name,
      kind: ref.kind,
      licence: ref.licence,
      sourceUrl: ref.sourceUrl,
      bytes: bytes.byteLength,
    });
  } catch (error) {
    return errorResult(error);
  }
}

function mergedCredits(
  existing: ThemeCredits | undefined,
  entry: DeclaredAsset["credit"],
): ThemeCredits {
  const kept = (existing?.entries ?? []).filter(
    (candidate) => candidate.assetId !== entry.assetId,
  );
  return {
    format: "yunari-theme-credits",
    version: 1,
    entries: [...kept, entry],
  };
}

export async function importAsset(
  context: ToolContext,
  input: {
    readonly assetRef?: string | undefined;
    readonly path?: string | undefined;
    readonly startMs?: number | undefined;
    readonly endMs?: number | undefined;
    readonly themeId?: string | undefined;
    readonly license?: string | undefined;
    readonly author?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(async () => {
    if ((input.assetRef === undefined) === (input.path === undefined)) {
      throw new Error("Name exactly one of assetRef or path.");
    }
    let trim: VideoTrim | undefined;
    if (input.startMs !== undefined || input.endMs !== undefined) {
      const { startMs, endMs } = input;
      if (
        startMs === undefined ||
        endMs === undefined ||
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        startMs < 0 ||
        endMs <= startMs
      ) {
        throw new Error("A video trim needs startMs < endMs, both >= 0.");
      }
      trim = { startMs, endMs };
    }

    const draft = draftFor(context, input.themeId);
    let bytes: Uint8Array;
    let declarationPath: string;
    let title: string | undefined;
    let license: string;
    let author: string | undefined;
    let sourceUrl: string | undefined;
    let font: AssetRefFont | undefined;

    if (input.assetRef !== undefined) {
      const ref = decodeRef(input.assetRef);
      font = ref.font;
      if (ref.source === "wallpaper-engine") {
        const fetched = await context.host.wallpaperBytes(ref.id, "asset");
        bytes = fetched.bytes;
        const fetchedExtension =
          extensionOf(fetched.filename) === ""
            ? extensionOfContentType(fetched.contentType)
            : extensionOf(fetched.filename);
        declarationPath = `${ref.name || "body"}.${
          fetchedExtension === "" ? "mp4" : fetchedExtension
        }`;
      } else {
        const fetched = await context.host.assetBytes(ref.source, ref.id);
        bytes = fetched.bytes;
        const fetchedName =
          fetched.filename === "" ? ref.name : basename(fetched.filename);
        declarationPath =
          font === undefined
            ? fetched.filename === ""
              ? `${ref.name || "asset"}.${extensionForKind(ref.kind)}`
              : fetchedName
            : `${fetchedName.replace(/\.[^.]+$/u, "") || "font"}.${font.format}`;
      }
      title = ref.name;
      license = ref.licence === "" ? "Unknown" : ref.licence;
      sourceUrl = ref.sourceUrl === "" ? undefined : ref.sourceUrl;
    } else {
      const path = input.path as string;
      if (input.license === undefined || input.license === "") {
        throw new Error(
          `A local import needs the licence the user stated for "${path}".`,
        );
      }
      // Refuse an unsupported extension and an over-cap file before reading:
      // a user-named or prompt-injected path must not be loaded to find out.
      declarationPath = basename(path);
      assetKindForPath(declarationPath);
      const info = await stat(path);
      if (!info.isFile()) {
        throw new Error(`"${path}" is not a file.`);
      }
      if (info.size > MAX_ASSET_BYTES) {
        throw new Error(
          `"${declarationPath}" is larger than the ${MAX_ASSET_BYTES} byte asset cap.`,
        );
      }
      bytes = new Uint8Array(await readFile(path));
      license = input.license;
      author = input.author;
    }

    if (isVideo(declarationPath)) {
      bytes = await context.host.normalizeVideo(bytes, trim);
      // The normalizer's output is MP4 whatever the source container was, so
      // the declaration names the file the store will actually hold.
      declarationPath = `${declarationPath.replace(/\.[^.]+$/u, "")}.mp4`;
    } else if (trim !== undefined) {
      throw new Error(`"${declarationPath}" is not a video to trim.`);
    }

    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new Error(
        `"${declarationPath}" is larger than the ${MAX_ASSET_BYTES} byte asset cap.`,
      );
    }

    const declared = await declareAsset({
      path: declarationPath,
      bytes,
      ...(title === undefined ? {} : { title }),
      ...(author === undefined ? {} : { author }),
      license,
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      ...(font === undefined ? {} : { font }),
      ...(trim === undefined
        ? {}
        : { changes: `Trimmed to ${trim.startMs}-${trim.endMs} ms.` }),
    });

    draft.envelope = addAsset(draft.envelope, declared.reference, bytes);
    context.drafts.setAsset(draft.id, declared.reference.path, bytes);
    context.drafts.setCredits(
      draft.id,
      mergedCredits(draft.credits, declared.credit),
    );

    return {
      themeId: draft.id,
      assetId: declared.reference.id,
      path: declared.reference.path,
      kind: declared.reference.kind,
      bytes: declared.bytes.byteLength,
      credit: declared.credit,
    };
  });
}

const assetRefSchema = z
  .string()
  .min(1)
  .describe("The opaque assetRef a search_assets row returned.");

/**
 * Drops a declared asset the draft no longer uses.
 *
 * Replacing a media asset used to leave the old declaration, its bytes and its
 * credit in the package. A referenced asset is refused rather than silently
 * breaking the object that names it.
 */
export async function removeDraftAsset(
  context: ToolContext,
  assetId: string,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    const asset = (draft.envelope.assets ?? []).find(
      (candidate) => candidate.id === assetId,
    );
    if (asset === undefined) {
      throw new Error(`There is no asset "${assetId}" in this theme.`);
    }
    const owner = assetOwner(draft.envelope, assetId);
    if (owner !== undefined) {
      throw new Error(
        `"${assetId}" is still used by ${owner}; remove that reference first.`,
      );
    }
    draft.envelope = removeAsset(draft.envelope, assetId);
    context.drafts.deleteAsset(draft.id, asset.path);
    if (draft.credits !== undefined) {
      context.drafts.setCredits(draft.id, {
        ...draft.credits,
        entries: draft.credits.entries.filter(
          (entry) => entry.assetId !== assetId,
        ),
      });
    }
    return { themeId: draft.id, removed: assetId, path: asset.path };
  });
}

/** Registers the three asset tools on the server. */
export function registerAssetTools(server: McpServer, context: ToolContext) {
  server.registerTool(
    "search_assets",
    {
      description:
        "Search the host's asset finder. Each row carries an opaque assetRef for import_asset.",
      inputSchema: z.object({
        query: z.string().min(1),
        sourceIds: z.array(z.string().min(1)).optional(),
        page: z.number().int().min(1).optional(),
      }),
    },
    async ({ query, sourceIds, page }) =>
      await searchAssets(context, query, sourceIds, page),
  );

  server.registerTool(
    "preview_asset",
    {
      description:
        "Fetch one finder result through the host and return it as image content.",
      inputSchema: z.object({ assetRef: assetRefSchema }),
    },
    async ({ assetRef }) => await previewAsset(context, assetRef),
  );

  server.registerTool(
    "import_asset",
    {
      description:
        "Declare an asset in the open draft from a finder result or a local file the user named. Video goes through the host's normalizer.",
      inputSchema: z.object({
        assetRef: assetRefSchema.optional(),
        path: z
          .string()
          .min(1)
          .optional()
          .describe("A local path, only when the user named the file."),
        startMs: z.number().optional(),
        endMs: z.number().optional(),
        license: z
          .string()
          .min(1)
          .optional()
          .describe("The licence the user stated for a local file."),
        author: z.string().optional(),
        themeId: z.string().min(1).optional(),
      }),
    },
    async (input) => await importAsset(context, input),
  );

  server.registerTool(
    "remove_asset",
    {
      description:
        "Remove a declared asset the draft no longer uses, with its bytes and credit. Refuses an asset an object, the background or a font face still references.",
      inputSchema: z.object({
        assetId: z.string().min(1),
        themeId: z.string().min(1).optional(),
      }),
    },
    async ({ assetId, themeId }) =>
      await removeDraftAsset(context, assetId, themeId),
  );
}
