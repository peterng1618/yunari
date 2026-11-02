import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/** Bundles the MCP server for Node so the published package needs no workspace source tree. */
export default defineConfig({
  resolve: {
    alias: {
      "@yunari/renderer-core": fileURLToPath(
        new URL("../renderer-core/src/index.ts", import.meta.url),
      ),
      "@yunari/theme-kit": fileURLToPath(
        new URL("../theme-kit/src/index.ts", import.meta.url),
      ),
      "@yunari/theme-package": fileURLToPath(
        new URL("../theme-package/src/index.ts", import.meta.url),
      ),
    },
  },
  build: {
    /** SSR keeps `node:` builtins external and avoids browser shims. */
    ssr: "src/main.ts",
    target: "node22",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    /** Keep server stack traces readable. */
    minify: false,
    rollupOptions: {
      output: {
        format: "esm",
        entryFileNames: "main.js",
      },
    },
  },
});
