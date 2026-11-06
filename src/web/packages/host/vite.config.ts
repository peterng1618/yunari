import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the host for Node so the published package needs no workspace source tree. */
export default defineConfig({
  plugins: [
    {
      name: "copy-default-widget-pack",
      /** `bundled-default-pack.ts` reads this beside `main.js`, so the archive
       *  has to travel with the bundle rather than stay in `src/`. */
      closeBundle() {
        copyFileSync(
          fileURLToPath(
            new URL("./src/packs/default.widgets.zip", import.meta.url),
          ),
          fileURLToPath(new URL("./dist/default.widgets.zip", import.meta.url)),
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@yunari/renderer-core": fileURLToPath(
        new URL("../renderer-core/src/index.ts", import.meta.url),
      ),
      "@yunari/theme-package": fileURLToPath(
        new URL("../theme-package/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    /** SSR keeps `node:` builtins external and avoids browser shims. Two
     *  entries: the host itself and the forked plugin child, which
     *  `main.ts` resolves as its sibling. */
    ssr: true,
    target: "node22",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    /** Keep server stack traces readable. */
    minify: false,
    rollupOptions: {
      input: {
        main: "src/main.ts",
        "plugin-host": "src/extensions/runtime/plugin-host.ts",
      },
      output: {
        format: "esm",
        entryFileNames: "[name].js",
      },
    },
  },
});
