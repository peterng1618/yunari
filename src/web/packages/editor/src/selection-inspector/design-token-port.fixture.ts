/**
 * The design-token port the paint-picker tests mount their surfaces over.
 *
 * A document's own palette and the one creation `create` mints: the real port
 * writes those through the session, so a fake shaped like it — and recording
 * which surface applied and revealed what — is what a surface test can assert
 * without a document.
 */
import type { FabricPalette } from "@yunari/renderer-core";
import type { TokenRef } from "../editor-shell/shell-stores.js";
import type { DesignTokenPort } from "./design-token-editor.js";

export function paintTokenPort(options: {
  readonly palette: FabricPalette;
  /** The id the next creation mints. */
  readonly created: string;
  readonly revealed?: TokenRef[];
  readonly onChange?: (palette: FabricPalette) => void;
}): DesignTokenPort {
  return {
    actions: {
      onChange: () => {},
      onDelete: () => {},
      unbindFace: () => {},
      paints: {
        palette: () => options.palette,
        onChange: (next) => options.onChange?.(next),
        onSettled: () => {},
        onDelete: undefined,
        usage: undefined,
      },
    },
    typeTokens: () => ({}),
    palette: () => options.palette,
    create: (kind, apply) => {
      const ref: TokenRef = { kind, id: options.created };
      return apply(ref) ? ref : undefined;
    },
    reveal: (ref) => options.revealed?.push(ref),
  };
}
