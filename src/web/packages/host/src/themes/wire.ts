import type { FabricThemeEnvelope } from "@yunari/renderer-core";
import type { ThemeContent } from "./store.js";

/**
 * The host's theme library is a folder, so a save carries the
 * document and its declared bytes as JSON rather than as an archive the host
 * would only have to unpack. Assets ride along base64-encoded, keyed by the
 * path the document declares.
 *
 *     { "envelope": { … }, "assets": { "assets/badge.svg": "<base64>" } }
 *
 * The archive is still the export format; this is the working path only. An
 * open answers with the stored document's `base`, and a save may send it back:
 * the pair is what lets the host tell a save built from what is stored from one
 * built from a document that is behind.
 *
 *     { "envelope": { … }, "assets": { … }, "base": "<sha256>" }
 */

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export function encodeThemeContent(
  content: ThemeContent,
  base?: string,
): {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, string>>;
  readonly base?: string;
} {
  return {
    envelope: content.envelope,
    assets: Object.fromEntries(
      Object.entries(content.assets).map(([assetPath, bytes]) => [
        assetPath,
        Buffer.from(bytes).toString("base64"),
      ]),
    ),
    ...(base === undefined ? {} : { base }),
  };
}

/** A decoded save: the content, and what the client says it is based on. */
export interface DecodedThemeSave {
  readonly content: ThemeContent;
  /** Absent when the client claims no base, which is a first save or a client
   *  that is not claiming one. Never guessed from the payload. */
  readonly base?: string;
  readonly overwrite: boolean;
}

export function decodeThemeSave(body: string): DecodedThemeSave {
  const parsed = JSON.parse(body) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("That is not a theme.");
  }
  const { envelope, assets, base, overwrite } = parsed as {
    readonly envelope?: unknown;
    readonly assets?: unknown;
    readonly base?: unknown;
    readonly overwrite?: unknown;
  };
  if (typeof envelope !== "object" || envelope === null) {
    throw new Error("A theme needs its document.");
  }
  if (typeof assets !== "object" || assets === null || Array.isArray(assets)) {
    throw new Error("A theme needs an assets map.");
  }
  // A base that is not a string, or an overwrite that is not a boolean, is a
  // malformed save rather than an absent claim: dropping either would turn a
  // client's bug into an ungated write, which is the one outcome the base is
  // here to prevent.
  if (base !== undefined && typeof base !== "string") {
    throw new Error("A theme's base is not a string.");
  }
  if (overwrite !== undefined && typeof overwrite !== "boolean") {
    throw new Error("A theme's overwrite flag is not a boolean.");
  }

  const decoded: Record<string, Uint8Array> = {};
  for (const [assetPath, encoded] of Object.entries(
    assets as Record<string, unknown>,
  )) {
    // `Buffer.from` silently drops what it does not understand, so a mangled
    // body would otherwise become a theme with silently truncated assets.
    if (
      typeof encoded !== "string" ||
      encoded.length % 4 !== 0 ||
      !BASE64.test(encoded)
    ) {
      throw new Error(`Asset "${assetPath}" is not base64.`);
    }
    decoded[assetPath] = new Uint8Array(Buffer.from(encoded, "base64"));
  }

  return {
    content: { envelope: envelope as FabricThemeEnvelope, assets: decoded },
    ...(base === undefined ? {} : { base }),
    overwrite: overwrite === true,
  };
}
