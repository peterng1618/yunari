import { uiCopy } from "../ui-copy.js";

/**
 * Sentinel ids in a token list: a token can never carry one, so a press on
 * either is a command rather than a reference. Shared so the token inspector's
 * family list and a run's token list cannot drift apart.
 */
export const IMPORT_LOCAL_FONT_ID = "@yunari:import-local-font";
export const FONT_FINDER_ID = "@yunari:font-finder";

/** One action row: the sentinel id and the words it shows. */
export interface FontActionOption {
  readonly id: string;
  readonly name: string;
}

/**
 * The trailing action rows both token lists draw: import first, then the
 * finder, each only where its port exists — a press that did nothing is worse
 * than an absent row. Only the ports' presence is read, so each caller keeps
 * its own signature.
 */
export function fontActionOptions(ports: {
  readonly importLocalFont?: unknown;
  readonly openFontFinder?: unknown;
}): readonly FontActionOption[] {
  return [
    ...(ports.importLocalFont === undefined
      ? []
      : [{ id: IMPORT_LOCAL_FONT_ID, name: uiCopy.panels.importLocalFont }]),
    ...(ports.openFontFinder === undefined
      ? []
      : [{ id: FONT_FINDER_ID, name: uiCopy.panels.fontFinder }]),
  ];
}
