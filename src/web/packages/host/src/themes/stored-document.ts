import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type FabricThemeEnvelope,
  MIN_SUPPORTED_SCHEMA_MAJOR,
  parseSchemaMajor,
  SUPPORTED_SCHEMA_MAJOR,
} from "@yunari/renderer-core";

/** The document member of a theme folder. */
export const THEME_FILE = "theme.json";

/**
 * Whether the bytes on disk are a document an older build wrote, so the store
 * owes it a rewrite.
 *
 * It must never throw: a folder is untrusted input, and this is asked before
 * anything validates it. Only a version this build reads *and* has outgrown
 * answers true — a future major or a malformed version is left alone rather
 * than rewritten down, because a later minor of the current major is readable
 * as it is.
 */
export function storedDocumentNeedsRewrite(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return false;
  }
  const version = (raw as Record<string, unknown>)["schemaVersion"];
  if (typeof version === "number") {
    return (
      Number.isSafeInteger(version) &&
      version >= MIN_SUPPORTED_SCHEMA_MAJOR &&
      version <= SUPPORTED_SCHEMA_MAJOR
    );
  }
  const major = parseSchemaMajor(version);
  return major !== undefined && major < SUPPORTED_SCHEMA_MAJOR;
}

/**
 * Replaces a folder's `theme.json` with `envelope` atomically: the new bytes
 * are written to a temp member of the same folder, then renamed over the
 * document, so a reader sees either the whole old file or the whole new one.
 */
export async function rewriteStoredDocument(
  folder: string,
  envelope: FabricThemeEnvelope,
): Promise<void> {
  const temp = path.join(
    folder,
    `.${THEME_FILE}.${randomBytes(3).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(temp, JSON.stringify(envelope), { flag: "wx" });
    await fs.rename(temp, path.join(folder, THEME_FILE));
  } finally {
    await fs.rm(temp, { force: true });
  }
}
