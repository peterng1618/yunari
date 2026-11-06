import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The widget pack the app ships: the eight starter cards as insertion units.
 *
 * The bytes are read from beside this module rather than built here, so the
 * pack the host serves is the same zip an author can open, and no two
 * derivations of the shipped units exist. `vite.config.ts` copies it into
 * `dist/` beside the bundle, where `import.meta.url` resolves after a build.
 *
 * Read synchronously on first use: the host reads it once at startup, and a
 * missing member is a broken bundle worth failing on rather than serving an
 * empty Add pane.
 */
let bytes: Uint8Array | undefined;

export function defaultWidgetPackBytes(): Uint8Array {
  bytes ??= new Uint8Array(
    readFileSync(
      fileURLToPath(new URL("./default.widgets.zip", import.meta.url)),
    ),
  );
  return bytes;
}
