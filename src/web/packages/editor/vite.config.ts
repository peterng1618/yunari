import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/** The product's version, read from the workspace manifest — the one place a
 *  release writes it — and injected as a constant so the About tab can name it
 *  with no module to import it from and no second copy to forget (`vg-279`).
 *  `vitest.config.ts` injects the same constant for the unit suite, which does
 *  not build through this file. */
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  define: { __YUNARI_VERSION__: JSON.stringify(version) },
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      // shadcn's own convention, and the reason a components.json can point at
      // this package's source without every generated import being rewritten.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@yunari/renderer-core": fileURLToPath(
        new URL("../renderer-core/src/index.ts", import.meta.url),
      ),
      "@yunari/theme-package": fileURLToPath(
        new URL("../theme-package/src/index.ts", import.meta.url),
      ),
      // SCAFFOLD: the fixture themes and the synthetic sample source. The
      // editor will open real documents (Gate 4) and preview live data through
      // the transport (Gate 3) instead.
      "@yunari/fake-source": fileURLToPath(
        new URL("../fake-source/src/index.ts", import.meta.url),
      ),
    },
  },
  // Served from two different places: `vite preview` and the browser suite put
  // this bundle at the root, while the host mounts it under `/editor`. The
  // default absolute base emits `/assets/…`, which under the host resolves
  // against the *player's* dist and 404s — the editor then boots to a blank
  // stage stuck on "starting…", because its HTML arrives and its script does
  // not. A relative base is the only one correct at both mount points; the host
  // redirects `/editor` to `/editor/` so it resolves against the right
  // directory (see `host/src/serve/static-path.ts`).
  base: "./",
  build: {
    // §124's floor applies to the player; the editor is desktop-only, and this
    // matches it so both are built by one toolchain rather than two.
    target: "es2022",
    // The editor's support floor, stated rather than inferred. Without a CSS
    // target lightningcss picks the prefix set itself and is free to emit only
    // the prefixed alias of a property, which a target browser that supports
    // the standard form then ignores — a stylesheet that builds green and
    // paints wrong. Chrome/Edge 111 and Safari 16.4 are the floor the product
    // supports; `scripts/check-css-prefixes.mjs` reads the built stylesheet and
    // fails the build when a declared property did not survive in that form.
    cssTarget: ["chrome111", "edge111", "safari16.4"],
    sourcemap: true,
  },
  server: {
    // Loopback only (§145). The editor is an admin surface and has no business
    // being reachable from the LAN.
    host: "127.0.0.1",
  },
});
