import {
  type FabricThemeEnvelope,
  STABLE_ID_PATTERN,
} from "@yunari/renderer-core";
import {
  readThemePackage,
  type ThemeCredits,
  type WidgetDocument,
  writeThemePackage,
  writeWidgetPackage,
} from "@yunari/theme-package";

type PackageParseResult =
  | {
      readonly ok: true;
      readonly envelope: FabricThemeEnvelope;
      readonly assets: Readonly<Record<string, Uint8Array>>;
      /** Absent when the package carried no usable picture. */
      readonly thumbnail?: Uint8Array;
      /** The package's attribution member, when it carried one. */
      readonly credits?: ThemeCredits;
    }
  | { readonly ok: false; readonly message: string };

type PackageSerializeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

export function parseThemePackage(bytes: Uint8Array): PackageParseResult {
  const result = readThemePackage(bytes);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return {
    ok: true,
    envelope: result.envelope,
    assets: result.assets,
    ...(result.thumbnail === undefined ? {} : { thumbnail: result.thumbnail }),
    ...(result.credits === undefined ? {} : { credits: result.credits }),
  };
}

export function serializeThemePackage(
  envelope: FabricThemeEnvelope,
  assets: Readonly<Record<string, Uint8Array>> = {},
  thumbnail?: Uint8Array,
  credits?: ThemeCredits,
): PackageSerializeResult {
  return writeThemePackage({
    envelope,
    assets,
    ...(thumbnail === undefined ? {} : { thumbnail }),
    ...(credits === undefined ? {} : { credits }),
  });
}

export function fileNameFor(theme: { readonly id: string }): string {
  const base = STABLE_ID_PATTERN.test(theme.id) ? theme.id : "theme";
  return `${base}.yunari-theme`;
}

export function widgetFileNameFor(widget: { readonly id: string }): string {
  const base = STABLE_ID_PATTERN.test(widget.id) ? widget.id : "widget";
  return `${base}.yunari-widget`;
}

/** A selection's package uses the widget writer, which owns its manifest kind
 *  and the envelope check a widget document must pass. */
export function serializeWidgetPackage(
  document: WidgetDocument,
  assets: Readonly<Record<string, Uint8Array>> = {},
): PackageSerializeResult {
  return writeWidgetPackage({ document, assets });
}
