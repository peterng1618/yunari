import {
  BUILT_IN_ASSET_BODIES,
  type InstalledPlugin,
  isCodeAssetSourceEntry,
  type PluginInstaller,
} from "@yunari/extension-api";
import type { AssetResult, PresetKind } from "@yunari/renderer-core";
import type {
  AssetSource,
  SearchPage,
  SourceBytes,
  SourceContext,
} from "../assets/source.js";
import { redactForBrowser } from "../providers/provider.js";
import type { PluginSupervisor } from "./runtime/supervisor.js";

/**
 * The adapter from a code asset source contribution to the host's source port.
 *
 * RPC payloads are JSON. `asset.search` answers `{ results, totalPages }` and
 * `asset.bytes` answers `{ bytes: <base64>, contentType, filename }`; every
 * answer is read here, because a plugin's bytes are untrusted input. A plugin
 * never receives a host credential: it fetches through its own host API
 * secrets, so `requires` is absent and `configurable` is false.
 */

const PRESET_KINDS: ReadonlySet<string> = new Set(["palette", "gradient"]);

/** 32 MiB of decoded bytes: the largest asset a plugin may hand the host. */
const MAX_PLUGIN_ASSET_BYTES = 32 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const LOG_LIMIT = 200;

const UNREADABLE_PAGE = "The plugin returned an unreadable search page.";
const UNREADABLE_RESULT = "The plugin returned an unreadable asset result.";
const UNREADABLE_BYTES =
  "The plugin returned an unreadable asset bytes answer.";

export type CodeAssetSourceContribution = {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: string;
  readonly requires?: string;
  readonly presetKind?: PresetKind;
  readonly host?: string;
  readonly entry: string;
};

type ContributionRead =
  | { readonly ok: true; readonly contribution: CodeAssetSourceContribution }
  | { readonly ok: false; readonly reason: string };

type BytesRead =
  | { readonly ok: true; readonly bytes: SourceBytes }
  | { readonly ok: false; readonly reason: string };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A code contribution admitted by the host, or the refusal.
 *
 * Only the grid body is adapted. The font picker needs each row's `font` cuts,
 * which this adapter deliberately does not carry yet, and the wallpaper-engine
 * body is the host's own local library UI; admitting either would draw rows no
 * consumer could use. A non-empty `requires` would name an entry in the shared
 * host credential store, which a plugin never reads.
 */
function readContribution(
  value: Readonly<Record<string, unknown>>,
): ContributionRead {
  const id = value["id"];
  const label = value["label"];
  const category = value["category"];
  const body = value["body"];
  const entry = value["entry"];

  if (!nonEmpty(id))
    return { ok: false, reason: 'A code asset source needs a non-empty "id".' };
  if (!nonEmpty(label))
    return {
      ok: false,
      reason: `The code asset source "${id}" needs a non-empty "label".`,
    };
  if (!nonEmpty(category))
    return {
      ok: false,
      reason: `The code asset source "${id}" needs a non-empty "category".`,
    };
  if (typeof entry !== "string")
    return {
      ok: false,
      reason: `The code asset source "${id}" needs a string "entry".`,
    };
  if (typeof body !== "string" || !BUILT_IN_ASSET_BODIES.has(body))
    return {
      ok: false,
      reason: `The code asset source "${id}" declares a body the editor does not draw; use "grid", "font-picker" or "wallpaper-engine".`,
    };
  if (body !== "grid")
    return {
      ok: false,
      reason: `The code asset source "${id}" declares the "${body}" body, which the host does not adapt from a plugin yet; use "grid".`,
    };

  const requires = value["requires"];
  if (requires !== undefined && requires !== "")
    return {
      ok: false,
      reason: `The code asset source "${id}" asks for a host credential; a plugin uses its own secrets.`,
    };

  const presetKind = value["presetKind"];
  if (
    presetKind !== undefined &&
    (typeof presetKind !== "string" || !PRESET_KINDS.has(presetKind))
  )
    return {
      ok: false,
      reason: `The code asset source "${id}" declares an unknown presetKind.`,
    };

  const host = value["host"];
  if (host !== undefined && typeof host !== "string")
    return {
      ok: false,
      reason: `The code asset source "${id}" declares a non-string host.`,
    };

  return {
    ok: true,
    contribution: {
      id,
      label,
      category,
      body,
      entry,
      ...(requires === undefined || requires === ""
        ? {}
        : { requires: requires as string }),
      ...(presetKind === undefined
        ? {}
        : { presetKind: presetKind as PresetKind }),
      ...(host === undefined ? {} : { host }),
    },
  };
}

function readPreset(value: unknown): NonNullable<AssetResult["preset"]> {
  if (!isRecord(value)) throw new Error(UNREADABLE_RESULT);

  const kind = value["kind"];
  if (kind === "palette") {
    const colours = value["colours"];
    if (
      !Array.isArray(colours) ||
      colours.some((colour) => typeof colour !== "string")
    )
      throw new Error(UNREADABLE_RESULT);
    return { kind: "palette", colours };
  }

  if (kind === "gradient") {
    const angle = value["angle"];
    const stops = value["stops"];
    if (
      typeof angle !== "number" ||
      !Number.isFinite(angle) ||
      !Array.isArray(stops)
    )
      throw new Error(UNREADABLE_RESULT);
    const parsed = stops.map((stop) => {
      if (!isRecord(stop)) throw new Error(UNREADABLE_RESULT);
      const offset = stop["offset"];
      const color = stop["color"];
      if (
        typeof offset !== "number" ||
        !Number.isFinite(offset) ||
        typeof color !== "string"
      )
        throw new Error(UNREADABLE_RESULT);
      return { offset, color };
    });
    return { kind: "gradient", angle, stops: parsed };
  }

  throw new Error(UNREADABLE_RESULT);
}

/** Every field the grid draws is required and usable, or the page is refused. */
function readResult(value: unknown): AssetResult {
  if (!isRecord(value)) throw new Error(UNREADABLE_RESULT);

  const id = value["id"];
  const name = value["name"];
  const sourceUrl = value["sourceUrl"];
  const preview = value["preview"];
  const kind = value["kind"];
  const licence = value["licence"];
  const subtitle = value["subtitle"];
  const preset = value["preset"];

  if (!nonEmpty(id) || !nonEmpty(name) || !nonEmpty(sourceUrl))
    throw new Error(UNREADABLE_RESULT);
  if (
    typeof preview !== "string" ||
    typeof kind !== "string" ||
    typeof licence !== "string"
  )
    throw new Error(UNREADABLE_RESULT);
  if (subtitle !== undefined && typeof subtitle !== "string")
    throw new Error(UNREADABLE_RESULT);

  return {
    id,
    name,
    kind,
    preview,
    subtitle: subtitle as string | undefined,
    licence,
    sourceUrl,
    ...(preset === undefined ? {} : { preset: readPreset(preset) }),
  };
}

function readPage(value: unknown): {
  readonly results: readonly AssetResult[];
  readonly totalPages: number | undefined;
} {
  if (!isRecord(value) || !Array.isArray(value["results"]))
    throw new Error(UNREADABLE_PAGE);

  const totalPages = value["totalPages"];
  if (
    totalPages !== undefined &&
    (typeof totalPages !== "number" ||
      !Number.isFinite(totalPages) ||
      totalPages < 0)
  )
    throw new Error(UNREADABLE_PAGE);

  return {
    results: value["results"].map(readResult),
    totalPages: totalPages as number | undefined,
  };
}

function readBytes(value: unknown): BytesRead {
  if (!isRecord(value)) return { ok: false, reason: UNREADABLE_BYTES };

  const encoded = value["bytes"];
  const contentType = value["contentType"];
  const filename = value["filename"];

  if (
    typeof encoded !== "string" ||
    !BASE64.test(encoded) ||
    encoded.length % 4 !== 0
  )
    return {
      ok: false,
      reason: `${UNREADABLE_BYTES} Its bytes are not base64.`,
    };

  const decoded = Buffer.from(encoded, "base64");
  if (decoded.byteLength > MAX_PLUGIN_ASSET_BYTES)
    return {
      ok: false,
      reason: `${UNREADABLE_BYTES} Its bytes are past the host's limit.`,
    };

  // Both travel as response headers, so a control character would split one and
  // make `writeHead` throw; a filename separator would also name a path.
  if (!nonEmpty(contentType) || CONTROL_CHARACTERS.test(contentType))
    return {
      ok: false,
      reason: `${UNREADABLE_BYTES} Its content type is unusable.`,
    };

  if (
    !nonEmpty(filename) ||
    filename.includes("/") ||
    filename.includes("\\") ||
    CONTROL_CHARACTERS.test(filename)
  )
    return {
      ok: false,
      reason: `${UNREADABLE_BYTES} Its filename is unusable.`,
    };

  return {
    ok: true,
    bytes: {
      bytes: new Uint8Array(decoded),
      contentType,
      filename,
    },
  };
}

function warn(pluginKey: string, reason: string): void {
  console.warn(
    `Plugin asset source ${pluginKey}: ${redactForBrowser(reason, LOG_LIMIT)}`,
  );
}

export class PluginAssetSource implements AssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: AssetSource["body"];
  readonly requires: string | undefined = undefined;
  readonly configurable = false;
  readonly presetKind?: PresetKind;
  readonly host?: string;

  readonly #supervisor: PluginSupervisor;
  readonly #pluginKey: string;

  constructor(options: {
    readonly plugin: InstalledPlugin;
    readonly supervisor: PluginSupervisor;
    readonly contribution: CodeAssetSourceContribution;
  }) {
    this.id = options.contribution.id;
    this.label = options.contribution.label;
    this.category = options.contribution.category;
    this.body = options.contribution.body as AssetSource["body"];
    this.#supervisor = options.supervisor;
    this.#pluginKey = options.plugin.key;
    if (options.contribution.presetKind !== undefined)
      this.presetKind = options.contribution.presetKind;
    if (options.contribution.host !== undefined)
      this.host = options.contribution.host;
  }

  async search(
    query: string,
    page: number,
    ctx: SourceContext,
  ): Promise<SearchPage> {
    if (ctx.signal.aborted) throw new Error(messageOf(ctx.signal.reason));

    const answer = await this.#supervisor.request<unknown>("asset.search", {
      query,
      page,
      source: this.id,
    });
    const read = readPage(answer);

    // Namespaced here so the grid row names its origin; `searchSources` leaves
    // an id that already carries this source's prefix alone.
    return {
      results: read.results.map((entry) => ({
        ...entry,
        id: entry.id.startsWith(`${this.id}:`)
          ? entry.id
          : `${this.id}:${entry.id}`,
      })),
      totalPages: read.totalPages,
    };
  }

  async bytesOf(
    resultId: string,
    ctx: SourceContext,
  ): Promise<SourceBytes | undefined> {
    if (ctx.signal.aborted) {
      warn(this.#pluginKey, messageOf(ctx.signal.reason));
      return undefined;
    }

    let answer: unknown;
    try {
      answer = await this.#supervisor.request<unknown>("asset.bytes", {
        id: resultId,
        source: this.id,
      });
    } catch (error) {
      warn(this.#pluginKey, messageOf(error));
      return undefined;
    }

    const read = readBytes(answer);
    if (!read.ok) {
      warn(this.#pluginKey, read.reason);
      return undefined;
    }
    return read.bytes;
  }
}

export interface CreatePluginAssetSourcesOptions {
  readonly installer: PluginInstaller;
  /** The one worker per plugin, started once by `startPluginSupervisors`. */
  readonly supervisors: ReadonlyMap<string, PluginSupervisor>;
  /** Source ids already registered by the host's own rows. */
  readonly taken?: readonly string[];
  /** One line per contribution that was refused; may reach the console. */
  readonly onFailure?: (pluginKey: string, reason: string) => void;
}

/**
 * One adapter per code asset contribution whose plugin worker is running.
 *
 * A plugin whose worker did not start contributes nothing and does not block
 * another plugin: `startPluginSupervisors` already reported that failure.
 */
export async function createPluginAssetSources(
  options: CreatePluginAssetSourcesOptions,
): Promise<readonly PluginAssetSource[]> {
  const sources: PluginAssetSource[] = [];
  const ids = new Set(options.taken ?? []);

  for (const plugin of await options.installer.list()) {
    const contributions = plugin.manifest.contributes.assetSources ?? [];
    const supervisor = options.supervisors.get(plugin.key);

    for (const entry of contributions) {
      if (!isCodeAssetSourceEntry(entry)) continue;
      if (supervisor === undefined) continue;

      const read = readContribution(entry);
      if (!read.ok) {
        options.onFailure?.(plugin.key, read.reason);
        continue;
      }

      // A duplicate would make `createAssetSources` throw at startup, so it
      // is refused here like a malformed contribution.
      if (ids.has(read.contribution.id)) {
        options.onFailure?.(
          plugin.key,
          `"${read.contribution.id}" is already an asset source.`,
        );
        continue;
      }
      ids.add(read.contribution.id);

      sources.push(
        new PluginAssetSource({
          plugin,
          supervisor,
          contribution: read.contribution,
        }),
      );
    }
  }

  return sources;
}
