import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type {
  Artboard,
  BackgroundBlend,
  BackgroundEdge,
  BackgroundRegion,
  FabricPalette,
  PalettePaint,
  StyleValue,
  TypeToken,
} from "@yunari/renderer-core";
import {
  BACKGROUND_EDGES,
  BACKGROUND_MODES,
  MAX_BACKGROUND_BLEND_LENGTH,
  MAX_BACKGROUND_INSET,
  MIN_BACKGROUND_BLEND_LENGTH,
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
import { jsonAttempt, withRequestedTheme } from "./result.js";

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
    const content = await context.host
      .getTheme(themeId)
      .catch((error: unknown) => {
        throw withRequestedTheme(error, themeId);
      });
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
          readonly face?: string | undefined;
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
      const weight = weightOf(update.weight) ?? next[role]?.weight;
      const face =
        update.face === undefined ? next[role]?.face : { assetId: update.face };
      next[role] = {
        ...next[role],
        family,
        ...(weight === undefined ? {} : { weight }),
        ...(face === undefined ? {} : { face }),
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
    readonly mode?: "basic" | "advanced" | undefined;
    readonly fill?: string | PalettePaint | undefined;
    readonly inset?:
      | {
          readonly left?: number | undefined;
          readonly top?: number | undefined;
          readonly right?: number | undefined;
          readonly bottom?: number | undefined;
        }
      | undefined;
    readonly blend?:
      | {
          readonly shape?: "linear" | "radial" | undefined;
          readonly edge?: BackgroundEdge | undefined;
          readonly length: number;
        }
      | undefined;
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

    const composing = input.inset !== undefined || input.blend !== undefined;
    if (
      input.color === undefined &&
      input.mediaAssetId === undefined &&
      input.fill === undefined &&
      input.mode === undefined &&
      !composing
    ) {
      throw new Error("A background needs a colour token or a media asset.");
    }

    const existing = draft.envelope.background;
    // The optional composition is opted into, never inferred: a stray `fill`
    // under the basic model would be stored and never painted.
    const advanced = (input.mode ?? existing?.mode) === "advanced";
    if ((input.fill !== undefined || composing) && !advanced) {
      throw new Error(
        'A background composition needs mode: "advanced"; the basic background covers its box with the media.',
      );
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

    let fill: StyleValue | undefined;
    if (input.fill !== undefined) {
      fill =
        typeof input.fill === "string"
          ? (() => {
              const token = input.fill.startsWith("palette.")
                ? input.fill.slice("palette.".length)
                : input.fill;
              if (palette[token] === undefined) {
                throw new Error(
                  `There is no palette token "${token}" in this theme.`,
                );
              }
              return { ref: `palette.${token}` };
            })()
          : { value: input.fill };
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
          region?: BackgroundRegion;
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
    } else {
      // Composition fields address the media that is already there; a bare
      // colour edit must not drop it.
      media = existing?.media;
    }

    if (composing) {
      if (media === undefined) {
        throw new Error(
          "A background composition needs a media background to sit in.",
        );
      }
      media = {
        ...media,
        region: regionOf(media.region, input.inset, input.blend),
      };
    }

    // Returning to basic drops what the basic model cannot store, rather than
    // leaving keys the validator would refuse on the next read.
    const returning = input.mode === "basic";
    let kept = media;
    if (returning && media !== undefined) {
      const { region: _region, ...plain } = media;
      kept = plain;
    }
    const { mode: _mode, fill: _fill, ...basic } = existing ?? {};
    const background = {
      ...(returning ? basic : (existing ?? {})),
      ...(color === undefined ? {} : { color }),
      ...(returning || fill === undefined ? {} : { fill }),
      ...(kept === undefined ? {} : { media: kept }),
      ...(input.mode === undefined || returning ? {} : { mode: input.mode }),
    };
    // The fill is the paint behind the media; with none it would be stored and
    // never painted, which is the dead state the validator refuses too.
    if (background.fill !== undefined && background.media === undefined) {
      throw new Error("A fill needs a media background to sit behind.");
    }
    draft.envelope = kitSetBackground(draft.envelope, background);
    return { themeId: draft.id, background };
  });
}

/**
 * The media's region after an edit, with the model's own ranges enforced before
 * the draft holds an invalid background.
 *
 * Insets accumulate on the existing region; a blend is replaced whole. A shape
 * follows the edge it was given, and a linear ramp that names no edge keeps a
 * previously authored one rather than guessing.
 */
function regionOf(
  existing: BackgroundRegion | undefined,
  inset:
    | {
        readonly left?: number | undefined;
        readonly top?: number | undefined;
        readonly right?: number | undefined;
        readonly bottom?: number | undefined;
      }
    | undefined,
  blend:
    | {
        readonly shape?: "linear" | "radial" | undefined;
        readonly edge?: BackgroundEdge | undefined;
        readonly length: number;
      }
    | undefined,
): BackgroundRegion {
  const next: {
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    blend?: BackgroundBlend;
  } = { ...existing };

  if (inset !== undefined) {
    for (const edge of BACKGROUND_EDGES) {
      const value = inset[edge];
      if (value === undefined) continue;
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > MAX_BACKGROUND_INSET
      ) {
        throw new Error(
          `The ${edge} inset must be from 0 to ${MAX_BACKGROUND_INSET}.`,
        );
      }
      next[edge] = value;
    }
    if ((next.left ?? 0) + (next.right ?? 0) >= 1) {
      throw new Error("The left and right insets must leave a positive area.");
    }
    if ((next.top ?? 0) + (next.bottom ?? 0) >= 1) {
      throw new Error("The top and bottom insets must leave a positive area.");
    }
  }

  if (blend !== undefined) {
    if (
      !Number.isFinite(blend.length) ||
      blend.length < MIN_BACKGROUND_BLEND_LENGTH ||
      blend.length > MAX_BACKGROUND_BLEND_LENGTH
    ) {
      throw new Error(
        `The blend length must be from ${MIN_BACKGROUND_BLEND_LENGTH} to ${MAX_BACKGROUND_BLEND_LENGTH}.`,
      );
    }
    const shape =
      blend.shape ?? (blend.edge !== undefined ? "linear" : "radial");
    if (shape === "linear") {
      const edge =
        blend.edge ??
        (existing?.blend?.shape === "linear" ? existing.blend.edge : undefined);
      if (edge === undefined) {
        throw new Error(
          "A linear blend needs an edge: left, right, top or bottom.",
        );
      }
      next.blend = { shape: "linear", edge, length: blend.length };
    } else {
      if (blend.edge !== undefined) {
        throw new Error("A radial blend has no edge.");
      }
      next.blend = { shape: "radial", length: blend.length };
    }
  }

  return next;
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

/** A digit-only weight is the same weight a packaged face declares as a
 *  number. It is coerced here, at the tool boundary, so a face that matches
 *  the file validates; a named weight (`bold`) stays a string and is the
 *  validator's to compare. */
function weightOf(
  weight: string | number | undefined,
): string | number | undefined {
  if (typeof weight !== "string") return weight;
  const trimmed = weight.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export const roleUpdateSchema = z.strictObject({
  family: z.string().min(1).optional(),
  weight: z.union([z.string(), z.number()]).optional(),
  face: z
    .string()
    .min(1)
    .optional()
    .describe("The packaged font asset's assetId, so this role loads it."),
});

/** The tool's top-level shape. **Strict**, so a caller that nests the roles
 *  under a `roles` key is told that the shape is wrong instead of receiving a
 *  success whose input was silently stripped. */
export const typeTokensInputSchema = z.strictObject({
  heading: roleUpdateSchema.optional(),
  body: roleUpdateSchema.optional(),
  mono: roleUpdateSchema.optional(),
  themeId: z.string().min(1).optional(),
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
        "Set the heading, body or mono type token's family, weight and packaged face. Pass roles flat — `heading`, `body` or `mono` at the top level, not nested under a `roles` key. Sizes belong to individual text runs.",
      inputSchema: typeTokensInputSchema,
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
        'Set the draft background\'s colour token and optional declared media asset, bounds and fallback frame. The basic model covers the box with the media. Set mode to "advanced" to compose it: fill paints the area a region leaves uncovered; inset and blend place the media in a region of the box and fade it into that fill. clear removes the background layer.',
      inputSchema: z.object({
        color: z.string().min(1).optional(),
        mediaAssetId: z.string().min(1).optional(),
        mode: z.enum(BACKGROUND_MODES).optional(),
        bounds: z.enum(["theme", "display"]).optional(),
        fallbackFrame: z.number().int().min(0).optional(),
        offsetX: z.number().optional(),
        offsetY: z.number().optional(),
        scale: z.number().optional(),
        flipX: z.boolean().optional(),
        flipY: z.boolean().optional(),
        fill: z.union([z.string().min(1), paintSchema]).optional(),
        inset: z
          .object({
            left: z.number().min(0).max(MAX_BACKGROUND_INSET).optional(),
            top: z.number().min(0).max(MAX_BACKGROUND_INSET).optional(),
            right: z.number().min(0).max(MAX_BACKGROUND_INSET).optional(),
            bottom: z.number().min(0).max(MAX_BACKGROUND_INSET).optional(),
          })
          .optional(),
        blend: z
          .object({
            shape: z.enum(["linear", "radial"]).optional(),
            edge: z.enum(BACKGROUND_EDGES).optional(),
            length: z
              .number()
              .min(MIN_BACKGROUND_BLEND_LENGTH)
              .max(MAX_BACKGROUND_BLEND_LENGTH),
          })
          .optional(),
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
