import { defineConfig } from "vite";

/**
 * The host's React admin entry — the theme chooser served at `/`.
 *
 * **A separate build from the player and the editor.** The player bundle is
 * React-free and size-budgeted (`packages/player/scripts/check-size.mjs`), so
 * this cannot join it; the editor bundle is mounted under `/editor/` and is
 * loopback-only, while the chooser is served to a display over the LAN. Output
 * lands in `dist-admin` and is served from `/admin/`.
 *
 * The filenames are stable rather than hashed because `public/chooser.html` is
 * served from source with no build step and names them directly. `serveStatic`
 * answers them with `no-cache` and an ETag, so a rebuild is picked up without
 * the cache retaining an old one.
 */
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist-admin",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: "src/admin/entry.tsx",
      output: {
        format: "es",
        entryFileNames: "chooser.js",
        assetFileNames: "chooser[extname]",
      },
    },
  },
});
