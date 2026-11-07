import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type {
  Artboard,
  BackgroundAnchor,
  BackgroundMedia,
  BackgroundMediaComposition,
  FabricPalette,
  PalettePaint,
  TypeToken,
} from "@yunari/renderer-core";
import {
  BACKGROUND_ANCHORS,
  BACKGROUND_MODES,
  DEFAULT_BACKGROUND_MEDIA_BOUNDS,
  MAX_BACKGROUND_EXTENT,
  MAX_BACKGROUND_FADE,
  MAX_METADATA_NAME_BYTES,
  MIN_BACKGROUND_EXTENT,
  MIN_BACKGROUND_FADE,
  normalizeThemeMetadata,
  themeMetadataRefusal,
  themeTagsRefusal,
} from "@yunari/renderer-core";
import {
  createBlankTheme,
  setArtboard as kitSetArtboard,
  setBackground as kitSetBackground,
  setPalette as kitSetPalette,
  setTypeTokens as kitSetTypeTokens,
} from "@yunari/theme-kit";
import { z } from "zod/v4";
import type { Draft, ToolContext } from "../types.js";
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
    const metadata = normalizeThemeMetadata({
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
    });
    const refusal = themeMetadataRefusal(metadata);
    if (refusal !== undefined) throw new Error(refusal);
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

/**
 * The media a `set_background` call leaves.
 *
 * `base` is the media already on the same asset, or nothing when the caller is
 * showing a different one. An omitted field keeps the base's value; a field the
 * caller states replaces it. Defaults (0 offset, 1 scale, no flip) are stored by
 * omission, as the editor's own controls store them.
 */
function backgroundMediaFor(
  base: BackgroundMedia | undefined,
  asset: { readonly id: string; readonly kind: string },
  input: {
    readonly bounds?: "theme" | "display" | undefined;
    readonly fallbackFrame?: number | undefined;
    readonly offsetX?: number | undefined;
    readonly offsetY?: number | undefined;
    readonly scale?: number | undefined;
    readonly flipX?: boolean | undefined;
    readonly flipY?: boolean | undefined;
  },
): BackgroundMedia {
  const fallbackFrame = input.fallbackFrame ?? base?.fallbackFrame;
  const offsetX = input.offsetX ?? base?.offsetX;
  const offsetY = input.offsetY ?? base?.offsetY;
  const scale = input.scale ?? base?.scale;
  const flipX = input.flipX ?? base?.flipX;
  const flipY = input.flipY ?? base?.flipY;
  return {
    assetId: asset.id,
    bounds: input.bounds ?? base?.bounds ?? DEFAULT_BACKGROUND_MEDIA_BOUNDS,
    ...(fallbackFrame === undefined || asset.kind !== "video"
      ? {}
      : { fallbackFrame }),
    ...(offsetX === undefined ? {} : { offsetX }),
    ...(offsetY === undefined ? {} : { offsetY }),
    ...(scale === undefined ? {} : { scale }),
    ...(flipX === true ? { flipX: true } : {}),
    ...(flipY === true ? { flipY: true } : {}),
    ...(base?.composition === undefined
      ? {}
      : { composition: base.composition }),
  };
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
    readonly mode?: "simple" | "advanced" | undefined;
    /** `full` is the cover: it removes the composition instead of storing one. */
    readonly anchor?: "full" | BackgroundAnchor | undefined;
    readonly extent?: number | undefined;
    readonly fade?: number | undefined;
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

    const composing =
      input.anchor !== undefined ||
      input.extent !== undefined ||
      input.fade !== undefined;
    if (
      input.color === undefined &&
      input.mediaAssetId === undefined &&
      input.mode === undefined &&
      !composing
    ) {
      throw new Error("A background needs a colour token or a media asset.");
    }

    const existing = draft.envelope.background;
    // The optional composition is opted into, never inferred: a stray
    // composition key under the simple model would be stored and never painted.
    const advanced = (input.mode ?? existing?.mode) === "advanced";
    if (composing && !advanced) {
      throw new Error(
        'A background composition needs mode: "advanced"; the simple background covers its box with the media.',
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
          composition?: BackgroundMediaComposition;
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
      // The editor's asset switch keeps a field the caller did not restate only
      // when the asset does not change: geometry belongs to the picture it was
      // framed for, and a new picture starts at the defaults. `composition`
      // addresses the same media, so it travels only with the same asset.
      media = backgroundMediaFor(
        existing?.media?.assetId === asset.id ? existing.media : undefined,
        asset,
        input,
      );
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
      const composition = compositionOf(media.composition, input);
      const { composition: _previous, ...plain } = media;
      media = composition === undefined ? plain : { ...media, composition };
    }

    // Returning to simple drops what the simple model cannot store, rather than
    // leaving keys the validator would refuse on the next read.
    const returning = input.mode === "simple";
    let kept = media;
    if (returning && media !== undefined) {
      const { composition: _composition, ...plain } = media;
      kept = plain;
    }
    const { mode: _mode, ...simple } = existing ?? {};
    const background = {
      ...(returning ? simple : (existing ?? {})),
      ...(color === undefined ? {} : { color }),
      ...(kept === undefined ? {} : { media: kept }),
      ...(input.mode === undefined || returning ? {} : { mode: input.mode }),
    };
    draft.envelope = kitSetBackground(draft.envelope, background);
    return { themeId: draft.id, background };
  });
}

/**
 * The media's composition after an edit, with the model's own ranges enforced
 * before the draft holds an invalid background.
 *
 * An omitted key keeps what the composition already stored, so a caller may
 * move the anchor without restating the fade. A centred band is sized by its
 * picture, so it stores no extent: an extent that named no edge is refused, and
 * one left behind by an earlier edge is dropped when the anchor moves to the
 * centre. `full` removes the composition: the media covers the box again.
 */
function compositionOf(
  existing: BackgroundMediaComposition | undefined,
  input: {
    readonly anchor?: "full" | BackgroundAnchor | undefined;
    readonly extent?: number | undefined;
    readonly fade?: number | undefined;
  },
): BackgroundMediaComposition | undefined {
  if (input.anchor === "full") {
    if (input.extent !== undefined || input.fade !== undefined) {
      throw new Error("A full cover has no extent or fade to store.");
    }
    return undefined;
  }

  const anchor = input.anchor ?? existing?.anchor;
  const next: {
    anchor?: BackgroundAnchor;
    extent?: number;
    fade?: number;
  } = anchor === undefined ? {} : { anchor };

  if (input.extent !== undefined) {
    if (
      !Number.isFinite(input.extent) ||
      input.extent < MIN_BACKGROUND_EXTENT ||
      input.extent > MAX_BACKGROUND_EXTENT
    ) {
      throw new Error(
        `The extent must be from ${MIN_BACKGROUND_EXTENT} to ${MAX_BACKGROUND_EXTENT}.`,
      );
    }
    if (anchor === undefined || anchor === "center") {
      throw new Error(
        "An extent needs an edge anchor: top, right, bottom or left.",
      );
    }
    next.extent = input.extent;
  } else if (
    anchor !== undefined &&
    anchor !== "center" &&
    existing?.extent !== undefined
  ) {
    next.extent = existing.extent;
  }

  const fade = input.fade ?? existing?.fade;
  if (fade !== undefined) {
    if (
      !Number.isFinite(fade) ||
      fade < MIN_BACKGROUND_FADE ||
      fade > MAX_BACKGROUND_FADE
    ) {
      throw new Error(
        `The fade must be from ${MIN_BACKGROUND_FADE} to ${MAX_BACKGROUND_FADE}.`,
      );
    }
    next.fade = fade;
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
        name: z
          .string()
          .min(1)
          .refine(
            (value) =>
              new TextEncoder().encode(value).byteLength <=
              MAX_METADATA_NAME_BYTES,
            `A theme name is at most ${MAX_METADATA_NAME_BYTES} bytes.`,
          )
          .optional(),
        author: z.string().optional(),
        description: z.string().optional(),
        language: z.string().min(1).optional(),
        tags: z
          .array(z.string())
          .superRefine((tags, ctx) => {
            const refusal = themeTagsRefusal(tags);
            if (refusal !== undefined)
              ctx.addIssue({ code: "custom", message: refusal });
          })
          .optional(),
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
        'Set the draft background\'s colour token and optional declared media asset, bounds and fallback frame. The simple model covers the box with the media. Set mode to "advanced" to compose it: the colour fills the gap the anchored media leaves uncovered. anchor places the media at the top, right, bottom, left or centre of its box; extent sets the size of an edge band; fade smooths the seam into the colour. A centre anchor letterboxes the picture to its own aspect. clear removes the background layer.',
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
        anchor: z.enum(["full", ...BACKGROUND_ANCHORS]).optional(),
        extent: z
          .number()
          .min(MIN_BACKGROUND_EXTENT)
          .max(MAX_BACKGROUND_EXTENT)
          .optional(),
        fade: z
          .number()
          .min(MIN_BACKGROUND_FADE)
          .max(MAX_BACKGROUND_FADE)
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
