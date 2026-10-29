/**
 * Minimal typings for the Node built-ins used by *tests only*.
 *
 * `@types/node` is deliberately NOT a dependency of the browser-targeted
 * packages. `renderer-core` targets a browser and a phone WebView, and the
 * editor is a desktop bundle; pulling in the whole Node surface would let
 * `fs`, `process` and `child_process` type-check inside either, where they
 * cannot run. The §47 boundary is about what can be imported, and the cheapest
 * way to keep that honest is to not have the types available at all.
 *
 * **Shared, not local.** The editor's and the player's architecture tests need
 * the same declarations, and a copy per package would be the same vocabulary
 * declared three times. It lives here because `renderer-core` is where a
 * concept several packages read belongs; `packages/editor/tsconfig.json` and
 * `packages/player/tsconfig.json` both name this file in their `include`.
 *
 * Everything here is declared **narrowly** — one overload, the arguments
 * actually used — so adding a capability is a visible act rather than an
 * accident. What needs them today:
 *
 * - reading `schema/theme-document.schema.json` off disk, so the drift guard
 *   compares against the published contract;
 * - reading the starter's packaged backdrop as bytes, so the `sha256` its
 *   declaration claims is checked against the file rather than trusted, and
 *   hashing it to do so;
 * - walking `packages/editor/src` to assert the import-direction and file-size
 *   rules;
 * - walking `packages/renderer-core/src`, `scene-fabric/src` and `player/src`
 *   to assert §47's import boundary — that Fabric is only ever taken from
 *   `fabric/es`, that the interactive `Canvas` never reaches the display
 *   bundle, and that no editor specifier does either;
 * - turning a `file://` URL into a path, for all of the above.
 *
 * DELETE THIS FILE if `@types/node` is ever added to the workspace — these
 * declarations would then conflict with the real ones.
 */

declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}

declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): {
    update(bytes: Uint8Array): { digest(encoding: "hex"): string };
  };
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...segments: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...segments: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
