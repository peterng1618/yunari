/**
 * The product's version, substituted by Vite's `define` at build time from the
 * workspace manifest (`src/web/package.json`) — see this package's
 * `vite.config.ts`, and the root `vitest.config.ts`, which injects the same
 * constant because the unit suite does not build through that file. Declared
 * here so the editor source can name it without a module to import it from.
 */
declare const __YUNARI_VERSION__: string;
