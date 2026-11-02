import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { validateFabricThemeEnvelope } from "@yunari/renderer-core";
import { z } from "zod/v4";
import type { Draft, SaveResult, ToolContext } from "../types.js";
import { draftFor } from "./draft.js";
import {
  errorResult,
  failureResult,
  imageResult,
  jsonAttempt,
  textResult,
} from "./result.js";

/** One validator-shaped issue for an asset a draft names but does not carry. */
interface DraftIssue {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

function missingAssetIssues(draft: Draft): DraftIssue[] {
  return (draft.envelope.assets ?? []).flatMap((asset) => {
    const bytes = draft.assets[asset.path];
    if (bytes !== undefined && bytes.byteLength > 0) return [];
    return [
      {
        code: "missing-asset-bytes",
        path: `/assets/${asset.id}`,
        message: `"${asset.id}" is declared but this draft carries no bytes for "${asset.path}".`,
      },
    ];
  });
}

function validationOf(draft: Draft): {
  ok: boolean;
  issues: readonly unknown[];
} {
  const result = validateFabricThemeEnvelope(draft.envelope);
  const missing = missingAssetIssues(draft);
  if (result.ok && missing.length === 0) {
    return { ok: true, issues: [] };
  }
  return {
    ok: false,
    issues: [...(result.ok ? [] : result.issues), ...missing],
  };
}

export async function validateTheme(
  context: ToolContext,
  themeId?: string,
): Promise<CallToolResult> {
  return await jsonAttempt(() => {
    const draft = draftFor(context, themeId);
    return { themeId: draft.id, ...validationOf(draft) };
  });
}

/** A save that both save_theme and the panel preview use. */
export async function saveDraft(
  context: ToolContext,
  themeId?: string,
): Promise<
  | { readonly ok: true; readonly draft: Draft; readonly result: SaveResult }
  | { readonly ok: false; readonly issues: readonly unknown[] }
> {
  const draft = draftFor(context, themeId);
  const validation = validationOf(draft);
  if (!validation.ok) return { ok: false, issues: validation.issues };

  const result = await context.host.saveTheme(draft.id, {
    envelope: draft.envelope,
    assets: draft.assets,
    ...(draft.credits === undefined ? {} : { credits: draft.credits }),
    ...(draft.base === undefined ? {} : { base: draft.base }),
  });
  context.drafts.markSaved(draft.id, result.base);
  return { ok: true, draft, result };
}

export async function saveTheme(
  context: ToolContext,
  themeId?: string,
): Promise<CallToolResult> {
  try {
    const saved = await saveDraft(context, themeId);
    if (!saved.ok) {
      return failureResult({ ok: false, issues: saved.issues });
    }
    return textResult({ ...saved.result, ok: true, saved: true });
  } catch (error) {
    return errorResult(error);
  }
}

/**
 * The player's own viewport for an artboard: its aspect, long edge capped at
 * 1600, and a square for a circle because the disc is inscribed in it.
 */
export function browserViewport(artboard: {
  readonly width: number;
  readonly height: number;
  readonly shape?: "rect" | "circle";
}): { readonly width: number; readonly height: number } {
  const long = Math.max(artboard.width, artboard.height);
  const capped = Math.min(1600, long);
  if (artboard.shape === "circle") {
    const side = Math.max(1, Math.round(capped));
    return { width: side, height: side };
  }
  const scale = long > 0 ? capped / long : 1;
  return {
    width: Math.max(1, Math.round(artboard.width * scale)),
    height: Math.max(1, Math.round(artboard.height * scale)),
  };
}

function boundKeysOf(draft: Draft): string[] {
  return [
    ...new Set(
      Object.values(draft.envelope.bindings ?? {}).flatMap((list) =>
        list.map((binding) => binding.semanticKey),
      ),
    ),
  ];
}

export async function previewTheme(
  context: ToolContext,
  displayId?: string,
  themeId?: string,
): Promise<CallToolResult> {
  try {
    const draft = draftFor(context, themeId);
    const display =
      displayId === undefined
        ? undefined
        : (await context.host.activeThemes()).displays.find(
            (candidate) => candidate.id === displayId,
          );
    if (displayId !== undefined && display === undefined) {
      throw new Error(`There is no display "${displayId}" on this host.`);
    }

    if (display?.kind !== "panel") {
      const url = new URL(context.host.url);
      url.pathname = "/";
      url.search = "";
      url.searchParams.set("theme", draft.id);
      if (displayId !== undefined) url.searchParams.set("display", displayId);
      return textResult({
        mode: "browser",
        themeId: draft.id,
        ...(displayId === undefined ? {} : { displayId }),
        url: url.toString(),
        viewport: browserViewport(draft.envelope.artboard),
        shape: draft.envelope.artboard.shape ?? "rect",
        boundSensors: boundKeysOf(draft),
      });
    }

    const saved = await saveDraft(context, themeId);
    if (!saved.ok) {
      return failureResult({
        mode: "panel",
        saved: false,
        issues: saved.issues,
      });
    }

    const png = await context.host.panelPreview(draft.id, display.id, true);
    const answering = new Set((await context.host.sensors(true)).measured);
    const geometry = display.panel?.geometry ?? {
      width: draft.envelope.artboard.width,
      height: draft.envelope.artboard.height,
    };
    return imageResult(png, "image/png", {
      mode: "panel",
      themeId: draft.id,
      saved: true,
      display: { id: display.id, label: display.label },
      geometry,
      shape: display.shape,
      missingSensors: boundKeysOf(draft).filter((key) => !answering.has(key)),
    });
  } catch (error) {
    return errorResult(error);
  }
}

export async function assignTheme(
  context: ToolContext,
  displayId: string,
  themeId: string,
): Promise<CallToolResult> {
  return await jsonAttempt(async () => {
    const active = await context.host.activeThemes();
    const display = active.displays.find(
      (candidate) => candidate.id === displayId,
    );
    if (display === undefined) {
      throw new Error(`There is no display "${displayId}" on this host.`);
    }
    await context.host.assignTheme(displayId, themeId);
    return {
      display: displayId,
      label: display.label,
      kind: display.kind,
      theme: themeId,
    };
  });
}

/** Registers the validation and deployment tools on the server. */
export function registerVerifyTools(server: McpServer, context: ToolContext) {
  server.registerTool(
    "validate_theme",
    {
      description:
        "Validate the draft envelope and its asset bytes. Reports ok and every issue, never throws on an invalid theme.",
      inputSchema: z.object({ themeId: z.string().min(1).optional() }),
    },
    async ({ themeId }) => await validateTheme(context, themeId),
  );

  server.registerTool(
    "preview_theme",
    {
      description:
        "A browser display answers the player URL and an artboard-aspect viewport. A panel display saves the draft first and answers a PNG at its geometry.",
      inputSchema: z.object({
        themeId: z.string().min(1).optional(),
        displayId: z.string().min(1).optional(),
      }),
    },
    async ({ themeId, displayId }) =>
      await previewTheme(context, displayId, themeId),
  );

  server.registerTool(
    "save_theme",
    {
      description:
        "Validate and write the draft to the host's theme library. A refused save returns its issues and leaves the draft intact.",
      inputSchema: z.object({ themeId: z.string().min(1).optional() }),
    },
    async ({ themeId }) => await saveTheme(context, themeId),
  );

  server.registerTool(
    "assign_theme",
    {
      description:
        "Assign a stored theme id to a display. Refuses a display this host does not have.",
      inputSchema: z.object({
        displayId: z.string().min(1),
        themeId: z.string().min(1),
      }),
    },
    async ({ displayId, themeId }) =>
      await assignTheme(context, displayId, themeId),
  );
}
