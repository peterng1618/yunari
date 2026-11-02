import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ToolContext } from "../types.js";

/** A successful tool answer: text JSON, never a binary payload. */
function textResult(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * A failed tool answer. The MCP server keeps the connection open for a later
 * call, so a host refusal is relayed as a tool error rather than thrown.
 */
function errorResult(error: unknown): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true,
  };
}

async function attempt(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return textResult(await work());
  } catch (error) {
    return errorResult(error);
  }
}

export async function yunariStatus(
  context: ToolContext,
): Promise<CallToolResult> {
  return await attempt(() => context.host.status());
}

export async function listDisplays(
  context: ToolContext,
): Promise<CallToolResult> {
  return await attempt(async () => {
    const active = await context.host.activeThemes();
    return {
      default: active.default,
      displays: active.displays.map((display) => ({
        id: display.id,
        label: display.label,
        kind: display.kind,
        shape: display.shape,
        rotation: display.rotation,
        theme: display.theme,
        ...(display.panel === undefined
          ? {}
          : {
              panel: {
                status: display.panel.status,
                commands: display.panel.commands,
                ...(display.panel.geometry === undefined
                  ? {}
                  : { geometry: display.panel.geometry }),
              },
            }),
      })),
    };
  });
}

export async function listSensors(
  context: ToolContext,
  measured: boolean,
): Promise<CallToolResult> {
  return await attempt(async () => {
    const listing = await context.host.sensors(measured);
    const answering = new Set(listing.measured);
    return {
      sensors: listing.sensors.map((sensor) => ({
        key: sensor.semanticKey,
        family: sensor.family,
        label: sensor.label,
        unit: sensor.unit,
        measured: answering.has(sensor.semanticKey),
      })),
      measured,
    };
  });
}

export async function listThemes(
  context: ToolContext,
): Promise<CallToolResult> {
  return await attempt(() => context.host.listThemes());
}

export async function getTheme(
  context: ToolContext,
  themeId: string,
): Promise<CallToolResult> {
  return await attempt(async () => {
    const content = await context.host.getTheme(themeId);
    return {
      envelope: content.envelope,
      assetPaths: Object.keys(content.assets),
      ...(content.credits === undefined ? {} : { credits: content.credits }),
      ...(content.base === undefined ? {} : { base: content.base }),
    };
  });
}

export async function listAssetSources(
  context: ToolContext,
): Promise<CallToolResult> {
  return await attempt(async () => {
    const sources = await context.host.listAssetSources();
    return sources.map((source) => ({
      id: source.id,
      label: source.label,
      category: source.category,
      requires: source.requires,
    }));
  });
}
