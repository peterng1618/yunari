import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type {
  Artboard,
  FabricPalette,
  PalettePaint,
  TypeToken,
} from "@yunari/renderer-core";
import {
  createBlankTheme,
  setArtboard as kitSetArtboard,
  setBackground as kitSetBackground,
  setPalette as kitSetPalette,
  setTypeTokens as kitSetTypeTokens,
} from "@yunari/theme-kit";
import { z } from "zod/v4";
import type { Draft, ThemeMetadata, ToolContext } from "../types.js";
import { jsonAttempt } from "./result.js";

/**
 * The draft a tool mutates: the named one, or the only open draft.
 *
 * One owner for the lookup, so a compose tool and a verify tool cannot disagree
 * about which draft they are addressing.
 */
export function draftFor(context: ToolContext, themeId?: string): Draft {
  return themeId === undefined
    ? context.drafts.current()
    : context.drafts.read(themeId);
}

function finiteNumber(message: string) {
  return z.number().refine(Number.isFinite, message);
}

const artboardShapeSchema = z.enum(["rect", "circle"]);

function artboardOf(input: {
  readonly width: number;
  readonly height: number;
  readonly shape?: "rect" | "circle" | undefined;
  readonly contentFit?: "contain" | "cover" | undefined;
}): Artboard {
  if (input.width <= 0 || input.height <= 0) {
    throw new Error("An artboard needs a positive width and height.");
  }
  return {
    width: input.width,
    height: input.height,
    ...(input.shape === undefined || input.shape === "rect"
      ? {}
      : { shape: input.shape }),
    ...(input.contentFit === undefined ? {} : { contentFit: input.contentFit }),
  };
}

export async function createTheme(
  context: ToolContext,
  input: {
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly shape?: "rect" | "circle" | undefined;
    readonly contentFit?: "contain" | "cover" | undefined;
    readonly language?: string | undefined;
    readonly author?: string | undefined;
    readonly description?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    if (input.name.trim() === "") {
      throw new Error("A theme needs a name.");
    }
    const envelope = createBlankTheme({
      artboard: artboardOf(input),
      name: input.name,
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.language === undefined
        ? {}
        : { themeLanguage: input.language }),
    });
    const draft = context.drafts.create({ id: envelope.id, envelope });
    if (input.description !== undefined) {
      context.drafts.setMetadata(draft.id, {
        ...draft.envelope.metadata,
        description: input.description,
      });
    }
    return {
      themeId: draft.id,
      origin: draft.origin,
      envelope: draft.envelope,
    };
  });
}

export async function openTheme(
  context: ToolContext,
  themeId: string,
  confirmExisting: boolean,
): Promise<CallToolResult> {
  return await jsonAttempt(async () => {
    if (confirmExisting !== true) {
      throw new Error(
        `Refusing to open "${themeId}" without confirmExisting: true. Ask the user before modifying an existing theme.`,
      );
    }
    const content = await context.host.getTheme(themeId);
    const draft = context.drafts.open(themeId, content);
    return {
      themeId: draft.id,
      origin: draft.origin,
      base: draft.base ?? null,
      envelope: draft.envelope,
    };
  });
}

export async function setThemeMetadata(
  context: ToolContext,
  input: {
    readonly name?: string | undefined;
    readonly author?: string | undefined;
    readonly description?: string | undefined;
    readonly language?: string | undefined;
    readonly tags?: readonly string[] | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    const metadata: ThemeMetadata = {
      ...draft.envelope.metadata,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.author === undefined ? {} : { author: input.author }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.language === undefined
        ? {}
        : { themeLanguage: input.language }),
      ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
    };
    context.drafts.setMetadata(draft.id, metadata);
    return { themeId: draft.id, metadata };
  });
}

export async function setArtboard(
  context: ToolContext,
  input: {
    readonly width: number;
    readonly height: number;
    readonly shape?: "rect" | "circle" | undefined;
    readonly contentFit?: "contain" | "cover" | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    const artboard = artboardOf(input);
    draft.envelope = kitSetArtboard(draft.envelope, artboard);
    return { themeId: draft.id, artboard };
  });
}

const paintSchema: z.ZodType<PalettePaint> = z.union([
  z.object({ kind: z.literal("solid"), color: z.string().min(1) }),
  z.object({
    kind: z.literal("gradient"),
    angle: finiteNumber("A gradient angle must be a finite number."),
    stops: z
      .array(
        z.object({
          offset: finiteNumber("A stop offset must be a finite number."),
          color: z.string().min(1),
        }),
      )
      .min(2),
  }),
]);

function paintOf(value: string | PalettePaint): PalettePaint {
  return typeof value === "string" ? { kind: "solid", color: value } : value;
}

export async function setPalette(
  context: ToolContext,
  entries: readonly {
    readonly id: string;
    readonly name: string;
    readonly value: string | PalettePaint;
  }[],
  themeId?: string | undefined,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    const existing = draft.envelope.globals?.palette ?? {};
    const next: Record<string, { name: string; value: PalettePaint }> = {
      ...existing,
    };
    for (const entry of entries) {
      if (entry.id === "none") {
        throw new Error(
          "palette.none is the immutable transparent token and cannot be changed.",
        );
      }
      next[entry.id] = { name: entry.name, value: paintOf(entry.value) };
    }
    const palette = next as FabricPalette;
    draft.envelope = kitSetPalette(draft.envelope, palette);
    return { themeId: draft.id, palette };
  });
}

export async function setTypeTokens(
  context: ToolContext,
  roles: Readonly<
    Partial<
      Record<
        "heading" | "body" | "mono",
        {
          readonly family?: string | undefined;
          readonly weight?: string | number | undefined;
        }
      >
    >
  >,
  themeId?: string | undefined,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    const existing = draft.envelope.globals?.typeTokens ?? {};
    const next: Record<string, TypeToken> = { ...existing };
    for (const role of ["heading", "body", "mono"] as const) {
      const update = roles[role];
      if (update === undefined) continue;
      const family = update.family ?? next[role]?.family;
      if (family === undefined || family === "") {
        throw new Error(`The "${role}" type token needs a font family.`);
      }
      const weight = update.weight ?? next[role]?.weight;
      next[role] = {
        family,
        ...(weight === undefined ? {} : { weight }),
      };
    }
    draft.envelope = kitSetTypeTokens(draft.envelope, next);
    return { themeId: draft.id, typeTokens: next };
  });
}

export async function setBackground(
  context: ToolContext,
  input: {
    readonly color?: string | undefined;
    readonly mediaAssetId?: string | undefined;
    readonly bounds?: "theme" | "display" | undefined;
    readonly fallbackFrame?: number | undefined;
    readonly offsetX?: number | undefined;
    readonly offsetY?: number | undefined;
    readonly scale?: number | undefined;
    readonly flipX?: boolean | undefined;
    readonly flipY?: boolean | undefined;
    readonly clear?: boolean | undefined;
    readonly themeId?: string | undefined;
  },
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, input.themeId);
    if (input.clear === true) {
      draft.envelope = kitSetBackground(draft.envelope, undefined);
      return { themeId: draft.id, background: null };
    }
    if (input.color === undefined && input.mediaAssetId === undefined) {
      throw new Error("A background needs a colour token or a media asset.");
    }

    const palette = draft.envelope.globals?.palette ?? {};
    let color: { readonly ref: `palette.${string}` } | undefined;
    if (input.color !== undefined) {
      const token = input.color.startsWith("palette.")
        ? input.color.slice("palette.".length)
        : input.color;
      if (palette[token] === undefined) {
        throw new Error(`There is no palette token "${token}" in this theme.`);
      }
      color = { ref: `palette.${token}` };
    }

    let media:
      | {
          assetId: string;
          bounds: "theme" | "display";
          fallbackFrame?: number;
          offsetX?: number;
          offsetY?: number;
          scale?: number;
          flipX?: boolean;
          flipY?: boolean;
        }
      | undefined;
    if (input.mediaAssetId !== undefined) {
      const asset = (draft.envelope.assets ?? []).find(
        (candidate) => candidate.id === input.mediaAssetId,
      );
      if (asset === undefined) {
        throw new Error(
          `There is no asset "${input.mediaAssetId}" in this theme.`,
        );
      }
      media = {
        assetId: asset.id,
        bounds: input.bounds ?? "theme",
        ...(input.fallbackFrame === undefined
          ? {}
          : { fallbackFrame: input.fallbackFrame }),
        ...(input.offsetX === undefined ? {} : { offsetX: input.offsetX }),
        ...(input.offsetY === undefined ? {} : { offsetY: input.offsetY }),
        ...(input.scale === undefined ? {} : { scale: input.scale }),
        ...(input.flipX === undefined ? {} : { flipX: input.flipX }),
        ...(input.flipY === undefined ? {} : { flipY: input.flipY }),
      };
    }

    const background = {
      ...(color === undefined ? {} : { color }),
      ...(media === undefined ? {} : { media }),
    };
    draft.envelope = kitSetBackground(draft.envelope, background);
    return { themeId: draft.id, background };
  });
}

export async function discardDraft(
  context: ToolContext,
  themeId: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const discarded = context.drafts.discard(themeId);
    if (!discarded) {
      throw new Error(`No draft "${themeId}" is open.`);
    }
    return { themeId, discarded: true };
  });
}

const roleUpdateSchema = z.object({
  family: z.string().min(1).optional(),
  weight: z.union([z.string(), z.number()]).optional(),
});

/** Registers the draft and token tools on the server. */
export function registerDraftTools(server: McpServer, context: ToolContext) {
  server.registerTool(
    "create_theme",
    {
      description:
        "Create a blank theme draft in memory. Nothing is written to the host until save_theme.",
      inputSchema: z.object({
        name: z.string().min(1),
        width: finiteNumber("The artboard width must be finite."),
        height: finiteNumber("The artboard height must be finite."),
        shape: artboardShapeSchema.optional(),
        contentFit: z.enum(["contain", "cover"]).optional(),
        language: z.string().optional(),
        author: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    async (input) => await createTheme(context, input),
  );

  server.registerTool(
    "open_theme",
    {
      description:
        "Open a stored theme as a draft. Requires confirmExisting: true, which the skill asks the user for first.",
      inputSchema: z.object({
        themeId: z.string().min(1),
        confirmExisting: z.boolean(),
      }),
    },
    async ({ themeId, confirmExisting }) =>
      await openTheme(context, themeId, confirmExisting),
  );

  server.registerTool(
    "set_theme_metadata",
    {
      description: "Merge name, author, description, language or tags.",
      inputSchema: z.object({
        name: z.string().min(1).optional(),
        author: z.string().optional(),
        description: z.string().optional(),
        language: z.string().optional(),
        tags: z.array(z.string()).optional(),
        themeId: z.string().min(1).optional(),
      }),
    },
    async (input) => await setThemeMetadata(context, input),
  );

  server.registerTool(
    "set_artboard",
    {
      description:
        "Set the draft artboard's width, height, shape (rect or circle) and content fit.",
      inputSchema: z.object({
        width: finiteNumber("The artboard width must be finite."),
        height: finiteNumber("The artboard height must be finite."),
        shape: artboardShapeSchema.optional(),
        contentFit: z.enum(["contain", "cover"]).optional(),
        themeId: z.string().min(1).optional(),
      }),
    },
    async (input) => await setArtboard(context, input),
  );

  server.registerTool(
    "set_palette",
    {
      description:
        "Merge palette tokens into the draft. A value is a CSS colour or a solid/gradient paint.",
      inputSchema: z.object({
        entries: z
          .array(
            z.object({
              id: z.string().min(1),
              name: z.string().min(1),
              value: z.union([z.string().min(1), paintSchema]),
            }),
          )
          .min(1),
        themeId: z.string().min(1).optional(),
      }),
    },
    async ({ entries, themeId }) => await setPalette(context, entries, themeId),
  );

  server.registerTool(
    "set_type_tokens",
    {
      description:
        "Set the heading, body or mono type token's family and weight. Sizes belong to individual text runs.",
      inputSchema: z.object({
        heading: roleUpdateSchema.optional(),
        body: roleUpdateSchema.optional(),
        mono: roleUpdateSchema.optional(),
        themeId: z.string().min(1).optional(),
      }),
    },
    async ({ heading, body, mono, themeId }) =>
      await setTypeTokens(
        context,
        {
          ...(heading === undefined ? {} : { heading }),
          ...(body === undefined ? {} : { body }),
          ...(mono === undefined ? {} : { mono }),
        },
        themeId,
      ),
  );

  server.registerTool(
    "set_background",
    {
      description:
        "Set the draft background's colour token and optional declared media asset, bounds and fallback frame. clear removes the background layer.",
      inputSchema: z.object({
        color: z.string().min(1).optional(),
        mediaAssetId: z.string().min(1).optional(),
        bounds: z.enum(["theme", "display"]).optional(),
        fallbackFrame: z.number().int().min(0).optional(),
        offsetX: z.number().optional(),
        offsetY: z.number().optional(),
        scale: z.number().optional(),
        flipX: z.boolean().optional(),
        flipY: z.boolean().optional(),
        clear: z.boolean().optional(),
        themeId: z.string().min(1).optional(),
      }),
    },
    async (input) => await setBackground(context, input),
  );

  server.registerTool(
    "discard_draft",
    {
      description: "Drop one in-memory draft without touching the host.",
      inputSchema: z.object({ themeId: z.string().min(1) }),
    },
    async ({ themeId }) => await discardDraft(context, themeId),
  );
}
