import type { CallToolResult } from "@modelcontextprotocol/server";
import type { ToolContext } from "../types.js";
import { jsonAttempt } from "./result.js";

async function attempt(work: () => Promise<unknown>): Promise<CallToolResult> {
  return await jsonAttempt(work);
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
  measured = true,
): Promise<CallToolResult> {
  return await attempt(async () => {
    const listing = await context.host.sensors(measured);
    const answering = new Set(listing.measured);
    // Several providers may catalogue the same semantic key. A key is the
    // identifier a binding uses, so the listing names it once; the first row's
    // label and family describe it.
    const seen = new Set<string>();
    const sensors: {
      key: string;
      family: string | undefined;
      label: string;
      unit: string | undefined;
      measured: boolean;
    }[] = [];
    for (const sensor of listing.sensors) {
      if (seen.has(sensor.semanticKey)) continue;
      seen.add(sensor.semanticKey);
      sensors.push({
        key: sensor.semanticKey,
        family: sensor.family,
        label: sensor.label,
        unit: sensor.unit,
        measured: answering.has(sensor.semanticKey),
      });
    }
    return { sensors, measured };
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
