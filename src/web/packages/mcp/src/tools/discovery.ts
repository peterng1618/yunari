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

/**
 * Families that describe what this machine is doing now — what is playing, what
 * game is running, the weather — rather than how loaded its hardware is.
 *
 * A design brief that leaves the readings open is better served by one of these
 * than by a fourth load figure. The list is product vocabulary, not a copy of
 * the catalogue: every family the host reports still appears in `families`,
 * and a family added later appears as non-contextual until it is classified.
 */
const CONTEXTUAL_FAMILIES = new Set([
  "time",
  "date",
  "media",
  "game",
  "frame",
  "weather",
  "audio",
  "battery",
  "wifi",
  "system",
]);

/** Per-family counts, so a caller can see the catalogue at a glance. */
function familiesOf(
  sensors: readonly {
    readonly semanticKey: string;
    readonly family?: string | undefined;
  }[],
  measured: ReadonlySet<string>,
): {
  family: string;
  keys: number;
  measured: number;
  contextual: boolean;
}[] {
  const byFamily = new Map<
    string,
    { family: string; keys: number; measured: number; contextual: boolean }
  >();

  for (const sensor of sensors) {
    if (sensor.family === undefined || sensor.family === "") continue;
    const row = byFamily.get(sensor.family) ?? {
      family: sensor.family,
      keys: 0,
      measured: 0,
      contextual: CONTEXTUAL_FAMILIES.has(sensor.family),
    };
    row.keys += 1;
    if (measured.has(sensor.semanticKey)) row.measured += 1;
    byFamily.set(sensor.family, row);
  }

  return [...byFamily.values()];
}

export async function listSensors(
  context: ToolContext,
  measured = true,
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
        valueKind: sensor.valueKind,
        mediaKind: sensor.mediaKind,
        measured: answering.has(sensor.semanticKey),
      })),
      families: familiesOf(listing.sensors, answering),
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
