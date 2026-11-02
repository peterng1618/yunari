import type { Artboard, FabricThemeEnvelope } from "@yunari/renderer-core";
import { createBlankTheme, createStarterTheme } from "@yunari/theme-kit";
import { starterBackdrop } from "./starter-backdrop.js";

/**
 * The starter as the library offers it: a template the product ships.
 *
 * A template is not a theme the author made, so it is not in the host's
 * library store — it has no file, no id in a themes directory and nothing to
 * delete, which is what "your themes" is counted over.
 *
 * The composition itself lives in `@yunari/theme-kit`; this file supplies the
 * editor's packaged backdrop bytes. A second copy of the composition here would
 * be a document the MCP server could not reproduce.
 */
export const STARTER_TEMPLATE = {
  id: "yunari-starter-template",
  name: "Starter — System dashboard",
} as const;

/** The id the reference theme was saved under while documents carried shared
    literals. Documents now mint their own; this records the retired name. */
export { STARTER_ENVELOPE_ID } from "@yunari/theme-kit";

/**
 * The reference composition, kept whole so it can be reached as what it now is
 * — a template, offered by `New from template` and listed in the library as one.
 * It is not what `New` means; see `createBlankFabricTheme`.
 */
export function createNewFabricTheme(): FabricThemeEnvelope {
  return createStarterTheme({ backdrop: starterBackdrop });
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
