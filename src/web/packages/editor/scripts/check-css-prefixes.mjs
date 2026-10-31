/**
 * Every property `editor-shell.css` declares in its standard form must survive
 * the production minifier in that form.
 *
 * Lightning CSS chooses prefixes from the build's CSS target. Without one it
 * may emit only `-webkit-appearance`, which a browser that supports `appearance`
 * ignores: the stylesheet looks right in source, builds green and paints wrong
 * only in browsers nobody in the loop uses. The target is pinned in
 * `vite.config.ts`; this script reads what that produced.
 *
 * Run by the package's build, after Vite has written `dist/assets/*.css`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const assets = fileURLToPath(new URL("../dist/assets/", import.meta.url));
const sheets = readdirSync(assets).filter((name) => name.endsWith(".css"));
if (sheets.length === 0) {
  throw new Error(`No built stylesheet under ${assets}; build first.`);
}

/** Declarations the editor authors unprefixed, property and value. A
 *  prefix-only emit leaves nothing a target browser applies. */
const STANDARD = [{ property: "appearance", value: "none" }];

let failed = false;
for (const name of sheets) {
  const css = readFileSync(join(assets, name), "utf8");
  for (const { property, value } of STANDARD) {
    if (!new RegExp(`(^|[;{])${property}:${value}`).test(css)) {
      console.error(
        `${name}: no standard \`${property}:${value}\` survived the minifier — a prefixed-only emit cannot be applied by a target browser.`,
      );
      failed = true;
    }
  }
}
if (failed) process.exit(1);
