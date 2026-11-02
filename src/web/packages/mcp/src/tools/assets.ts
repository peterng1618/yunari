import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import {
  addAsset,
  assetKindForPath,
  type DeclaredAsset,
  declareAsset,
  MAX_ASSET_BYTES,
} from "@yunari/theme-kit";
import { z } from "zod/v4";
import type {
  AssetSearchRequest,
  ThemeCredits,
  ToolContext,
  VideoTrim,
} from "../types.js";
import { draftFor } from "./draft.js";
import { errorResult, imageResult, jsonAttempt } from "./result.js";

/** The opaque, agent-carried reference to one finder result. */
export interface AssetRef {
  readonly source: string;
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly preview: string;
  readonly licence: string;
  readonly sourceUrl: string;
}

function encodeRef(ref: AssetRef): string {
  return Buffer.from(JSON.stringify(ref), "utf8").toString("base64");
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
  return {
    source: text("source"),
    id: text("id"),
    name: text("name"),
    kind: text("kind"),
    preview: text("preview"),
    licence: text("licence"),
    sourceUrl: text("sourceUrl"),
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

function mimeOf(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? "application/octet-stream";
}

function isVideo(path: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(path));
}

function extensionForKind(kind: string): string {
  return kind === "svg"
    ? "svg"
    : kind === "gif"
      ? "gif"
      : kind === "video"
        ? "mp4"
        : kind === "font"
          ? "woff2"
          : "png";
}

/** The finder answers with ids already prefixed `<source>:`; keep them whole. */
export async function searchAssets(
  context: ToolContext,
  query: string,
  sourceIds?: readonly string[],
  page?: number,
): Promise<CallToolResult> {
  return await jsonAttempt(async () => {
    const enabled =
      sourceIds ??
      (await context.host.listAssetSources()).map((source) => source.id);
    if (enabled.length === 0) {
      throw new Error("This host has no asset sources to search.");
    }
    const pages: Record<string, number> = {};
    for (const id of enabled) pages[id] = page ?? 1;

    const request: AssetSearchRequest = { query, enabled, pages, body: "grid" };
    const answer = await context.host.searchAssets(request);

    return {
      results: answer.pages.flatMap((answerPage) =>
        answerPage.results.map((result) => ({
          assetRef: encodeRef({
            source: answerPage.source,
            id: result.id,
            name: result.name,
            kind: result.kind,
            preview: result.preview,
            licence: result.licence,
            sourceUrl: result.sourceUrl,
          }),
          name: result.name,
          kind: result.kind,
          preview: result.preview,
          licence: result.licence,
          sourceUrl: result.sourceUrl,
          ...(result.subtitle === undefined
            ? {}
            : { subtitle: result.subtitle }),
        })),
      ),
      failures: answer.pages.flatMap((answerPage) =>
        answerPage.failure === undefined
          ? []
          : [{ source: answerPage.source, ...answerPage.failure }],
      ),
    };
  });
}

export async function previewAsset(
  context: ToolContext,
  assetRef: string,
): Promise<CallToolResult> {
  try {
    const ref = decodeRef(assetRef);
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

    if (input.assetRef !== undefined) {
      const ref = decodeRef(input.assetRef);
      const fetched = await context.host.assetBytes(ref.source, ref.id);
      bytes = fetched.bytes;
      declarationPath =
        fetched.filename === ""
          ? `${ref.name || "asset"}.${extensionForKind(ref.kind)}`
          : basename(fetched.filename);
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
}
