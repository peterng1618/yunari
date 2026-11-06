import {
  IDENTIFIER_PATTERN,
  type InstalledExtension,
  isCodeAssetSourceEntry,
} from "@yunari/extension-api";
import type { PresetKind } from "@yunari/renderer-core";
import { redactForBrowser } from "../providers/provider.js";

/**
 * The declarative asset-source descriptor: the manifest says where to search,
 * how to page and which pointers name a result, so the host needs no code from
 * the plugin. Parsing lives here; the HTTP adapter is in `declarative-sources`.
 */

/** One extension may contribute this many adapted sources; the rest are
 *  refused with a stated reason rather than making startup unbounded. */
const MAX_SOURCES_PER_EXTENSION = 20;
export const DECLARATIVE_LOG_LIMIT = 200;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

const HTTPS_REQUIRED = "Declarative asset sources must use https.";
const USERINFO_REFUSED =
  "A declarative asset source URL may not carry user information.";

const PRESET_KINDS: ReadonlySet<string> = new Set(["palette", "gradient"]);
/** Bodies the editor draws itself. A source declaring one of these instead of
 *  "grid" would be handed to a body that expects a different result shape. */
const EDITOR_BODIES: ReadonlySet<string> = new Set([
  "font-picker",
  "wallpaper-engine",
]);
const CUSTOM_BODY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export interface DeclarativeAssetSource {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly body: string;
  readonly presetKind?: PresetKind;
  readonly host: string;
  readonly request: {
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly pageParam?: string;
    readonly firstPage?: number;
    readonly totalPath?: string;
  };
  readonly result: {
    readonly itemsPath: string;
    readonly id: string;
    readonly name: string;
    readonly preview?: string;
    readonly subtitle?: string;
    readonly kind?: string;
    readonly licence?: string;
    readonly sourceUrl?: string;
  };
}

type ReadResult =
  | { readonly ok: true; readonly source: DeclarativeAssetSource }
  | { readonly ok: false; readonly message: string };

type Check<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

function refuse(message: string): ReadResult {
  return { ok: false, message };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function readHeaders(
  value: unknown,
  id: string,
): Check<Readonly<Record<string, string>> | undefined> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value)) {
    return {
      ok: false,
      message: `The declarative asset source "${id}" declares unreadable request.headers.`,
    };
  }

  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (
      !HEADER_NAME.test(name) ||
      typeof header !== "string" ||
      CONTROL_CHARACTERS.test(header)
    ) {
      return {
        ok: false,
        message: `The declarative asset source "${id}" declares an unusable request header.`,
      };
    }
    headers[name] = header;
  }
  return { ok: true, value: headers };
}

function readUrl(value: unknown): Check<URL> {
  if (typeof value !== "string" || value === "") {
    return {
      ok: false,
      message: "A declarative asset source needs a non-empty request.url.",
    };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return {
      ok: false,
      message: "A declarative asset source URL is not a URL.",
    };
  }
  if (url.protocol !== "https:") return { ok: false, message: HTTPS_REQUIRED };
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: USERINFO_REFUSED };
  }
  return { ok: true, value: url };
}

/**
 * One contribution, admitted or refused.
 *
 * The descriptor is parsed once at load. A refusal disables only this source;
 * `declarativeAssetSources` reports it and the rest of the extension still
 * loads.
 */
export function readDeclarativeAssetSource(
  value: unknown,
  allowFrameBody = false,
): ReadResult {
  if (!isRecord(value)) {
    return refuse("A declarative asset source must be an object.");
  }

  const id = value["id"];
  if (!nonEmpty(id) || !IDENTIFIER_PATTERN.test(id)) {
    return refuse(
      'A declarative asset source needs a lowercase identifier "id".',
    );
  }

  const label = value["label"];
  if (!nonEmpty(label)) {
    return refuse(
      `The declarative asset source "${id}" needs a non-empty "label".`,
    );
  }

  const category = value["category"];
  if (!nonEmpty(category)) {
    return refuse(
      `The declarative asset source "${id}" needs a non-empty "category".`,
    );
  }

  const body = value["body"];
  if (typeof body !== "string" || !CUSTOM_BODY_PATTERN.test(body)) {
    return refuse(
      `The declarative asset source "${id}" needs a lowercase "body".`,
    );
  }
  if (body !== "grid") {
    if (EDITOR_BODIES.has(body)) {
      return refuse(
        `The declarative asset source "${id}" declares the built-in "${body}" body; use "grid" or a custom body with "ui:frame".`,
      );
    }
    if (!allowFrameBody) {
      return refuse(
        `The declarative asset source "${id}" declares a body the editor cannot draw; use "grid" or declare the "ui:frame" capability.`,
      );
    }
  }

  // Host credentials belong to the host. A declarative row that names one
  // would turn it into data sent to the URL this manifest chose, with no
  // consent binding that destination; only the host's own source rows may
  // carry a credential.
  if (value["requires"] !== undefined) {
    return refuse(
      `The declarative asset source "${id}" may not use a host credential; fetch with its own endpoint instead.`,
    );
  }

  const presetKindValue = value["presetKind"];
  if (
    presetKindValue !== undefined &&
    (typeof presetKindValue !== "string" || !PRESET_KINDS.has(presetKindValue))
  ) {
    return refuse(
      `The declarative asset source "${id}" declares an unknown presetKind.`,
    );
  }

  const host = value["host"];
  if (!nonEmpty(host)) {
    return refuse(
      `The declarative asset source "${id}" needs a non-empty "host".`,
    );
  }

  if (!isRecord(value["request"])) {
    return refuse(
      `The declarative asset source "${id}" needs a request object.`,
    );
  }
  const requestValue = value["request"];
  if (requestValue["auth"] !== undefined) {
    return refuse(
      `The declarative asset source "${id}" may not declare request.auth.`,
    );
  }

  const url = readUrl(requestValue["url"]);
  if (!url.ok) return refuse(url.message);

  const headers = readHeaders(requestValue["headers"], id);
  if (!headers.ok) return refuse(headers.message);

  const pageParam = requestValue["pageParam"];
  if (pageParam !== undefined && !nonEmpty(pageParam)) {
    return refuse(
      `The declarative asset source "${id}" declares an empty pageParam.`,
    );
  }

  const firstPage = requestValue["firstPage"];
  if (
    firstPage !== undefined &&
    (typeof firstPage !== "number" ||
      !Number.isInteger(firstPage) ||
      firstPage < 0)
  ) {
    return refuse(
      `The declarative asset source "${id}" declares an unusable firstPage.`,
    );
  }

  const totalPath = requestValue["totalPath"];
  if (totalPath !== undefined && typeof totalPath !== "string") {
    return refuse(
      `The declarative asset source "${id}" declares an unusable totalPath.`,
    );
  }

  if (!isRecord(value["result"])) {
    return refuse(
      `The declarative asset source "${id}" needs a result object.`,
    );
  }
  const resultValue = value["result"];

  const itemsPath = resultValue["itemsPath"];
  if (typeof itemsPath !== "string") {
    return refuse(
      `The declarative asset source "${id}" needs a string result.itemsPath.`,
    );
  }
  for (const field of ["id", "name"] as const) {
    if (!nonEmpty(resultValue[field])) {
      return refuse(
        `The declarative asset source "${id}" needs a non-empty result.${field} pointer.`,
      );
    }
  }
  for (const field of [
    "preview",
    "subtitle",
    "kind",
    "licence",
    "sourceUrl",
  ] as const) {
    if (
      resultValue[field] !== undefined &&
      typeof resultValue[field] !== "string"
    ) {
      return refuse(
        `The declarative asset source "${id}" declares an unusable result.${field} pointer.`,
      );
    }
  }

  return {
    ok: true,
    source: {
      id,
      label,
      category,
      body,
      host,
      ...(presetKindValue === undefined
        ? {}
        : { presetKind: presetKindValue as PresetKind }),
      request: {
        url: requestValue["url"] as string,
        ...(headers.value === undefined ? {} : { headers: headers.value }),
        ...(pageParam === undefined ? {} : { pageParam: pageParam as string }),
        ...(firstPage === undefined ? {} : { firstPage: firstPage as number }),
        ...(totalPath === undefined ? {} : { totalPath: totalPath as string }),
      },
      result: {
        itemsPath,
        id: resultValue["id"] as string,
        name: resultValue["name"] as string,
        ...(resultValue["preview"] === undefined
          ? {}
          : { preview: resultValue["preview"] as string }),
        ...(resultValue["subtitle"] === undefined
          ? {}
          : { subtitle: resultValue["subtitle"] as string }),
        ...(resultValue["kind"] === undefined
          ? {}
          : { kind: resultValue["kind"] as string }),
        ...(resultValue["licence"] === undefined
          ? {}
          : { licence: resultValue["licence"] as string }),
        ...(resultValue["sourceUrl"] === undefined
          ? {}
          : { sourceUrl: resultValue["sourceUrl"] as string }),
      },
    },
  };
}

export function warnDeclarativeSource(pluginKey: string, reason: string): void {
  console.warn(
    `Declarative asset source ${pluginKey}: ${redactForBrowser(reason, DECLARATIVE_LOG_LIMIT)}`,
  );
}

/**
 * Every declarative source the installed extensions may register.
 *
 * Only a contribution whose consent is not missing is considered. A malformed
 * row disables that source alone (or, for a duplicate id, the later row), and
 * an extension may not contribute more than `MAX_SOURCES_PER_EXTENSION`.
 */
export function declarativeAssetSources(
  extensions: readonly InstalledExtension[],
): readonly DeclarativeAssetSource[] {
  const sources: DeclarativeAssetSource[] = [];
  const seen = new Set<string>();

  for (const extension of extensions) {
    if (extension.consent === "missing") continue;

    let accepted = 0;
    for (const entry of extension.contributions.assetSources ?? []) {
      if (isCodeAssetSourceEntry(entry)) continue;

      if (accepted >= MAX_SOURCES_PER_EXTENSION) {
        warnDeclarativeSource(
          extension.key,
          `it contributes more than ${MAX_SOURCES_PER_EXTENSION} asset sources; the rest are ignored.`,
        );
        break;
      }

      const read = readDeclarativeAssetSource(
        entry,
        extension.capabilities.includes("ui:frame") &&
          extension.execution === "sandboxed-ui",
      );
      if (!read.ok) {
        warnDeclarativeSource(extension.key, read.message);
        continue;
      }

      if (seen.has(read.source.id)) {
        warnDeclarativeSource(
          extension.key,
          `the asset source "${read.source.id}" is already declared; the duplicate is skipped.`,
        );
        continue;
      }

      seen.add(read.source.id);
      accepted += 1;
      sources.push(read.source);
    }
  }

  return sources;
}
