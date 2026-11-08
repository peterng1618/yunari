import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readFabricThemeEnvelope,
  SUPPORTED_SCHEMA_VERSION,
} from "@yunari/renderer-core";
import { createThemeStore, isValidThemeId } from "../src/themes/store.js";
import {
  storedDocumentNeedsRewrite,
  THEME_FILE,
} from "../src/themes/stored-document.js";

const [directory = path.join(os.homedir(), ".yunari", "themes"), ...flags] =
  process.argv.slice(2);
const write = flags.includes("--write");

/**
 * One pass over the library, reporting what the store would do and doing
 * nothing. A document the reader refuses is named here and left untouched:
 * the store's rewrite is the only writer, and it refuses the same file.
 */
async function report(): Promise<void> {
  let convertible = 0;
  let current = 0;
  let failed = 0;

  const entries = await fs
    .readdir(directory, { withFileTypes: true })
    .catch(() => []);

  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidThemeId(entry.name)) {
      continue;
    }
    let text: string;
    try {
      text = await fs.readFile(
        path.join(directory, entry.name, THEME_FILE),
        "utf8",
      );
    } catch {
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }

    const read = readFabricThemeEnvelope(raw);
    if (!read.ok) {
      failed += 1;
      console.log(
        `${entry.name}: FAILED ${read.issues.map((issue) => issue.code).join(", ")}`,
      );
    } else if (storedDocumentNeedsRewrite(raw)) {
      convertible += 1;
      const version = (raw as { schemaVersion: unknown }).schemaVersion;
      console.log(
        `${entry.name}: ${String(version)} -> ${SUPPORTED_SCHEMA_VERSION}`,
      );
    } else {
      current += 1;
    }
  }

  console.log(
    `convertible ${convertible}, current ${current}, failed ${failed}`,
  );
}

await report();
if (write) {
  await createThemeStore(directory).list();
  await report();
}
