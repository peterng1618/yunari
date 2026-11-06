import type { Artboard, FabricThemeEnvelope } from "@yunari/renderer-core";
import { createBlankTheme } from "@yunari/theme-kit";
import { bundledStarterEnvelope } from "./bundled/starter.js";

/**
 * The starter as the library offers it: a template the product ships.
 *
 * A template is not a theme the author made, so it is not in the host's
 * library store — it has no file, no id in a themes directory and nothing to
 * delete, which is what "your themes" is counted over. The document itself is
 * the committed `bundled/starter.theme.zip`, loaded once at boot.
 */
export const STARTER_TEMPLATE = {
  id: "yunari-starter-template",
  name: "Starter — System dashboard",
} as const;

/**
 * The reference composition, kept whole so it can be reached as what it now is
 * — a template, offered by `New from template` and listed in the library as one.
 * It is not what `New` means; see `createBlankFabricTheme`.
 */
export function createNewFabricTheme(): FabricThemeEnvelope {
  return bundledStarterEnvelope();
}

/**
 * A new document: the starter's envelope with the composition taken out, at the
 * artboard the author chose.
 */
export function createBlankFabricTheme(
  artboard: Artboard,
): FabricThemeEnvelope {
  return createBlankTheme({ artboard });
}
