import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundledStarter } from "../bundled/starter.js";

/**
 * Loads the committed starter for every suite.
 *
 * `createNewFabricTheme()` is the template, not a builder: it reads the
 * document that boot loaded. A test that opens a document therefore needs the
 * same load the editor performs, and doing it once here keeps every suite on
 * the package the product ships rather than a second composition authored for
 * tests.
 */
const packagePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../bundled/starter.theme.zip",
);

await loadBundledStarter(
  (async () =>
    new Response(new Uint8Array(readFileSync(packagePath)))) as typeof fetch,
);
