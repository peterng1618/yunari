import {
  CONNECTIONS_GLYPH,
  CUSTOM_SHAPES_GLYPH,
  DISPLAYS_GLYPH,
  HARDWARE_GLYPH,
  INFO_GLYPH,
  KEYBOARD_GLYPH,
  type LucideIcon,
  PACKAGE_GLYPH,
  PALETTE_GLYPH,
  PREVIEW_RATIOS_GLYPH,
  READINGS_GLYPH,
  SIGNALRGB_GLYPH,
  UNITS_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";

/** The pages this build ships. The type is also the active-page state the shell
 *  holds, so a page added here and not handled there fails to compile. */
export type BuiltinSettingsPage =
  | "displays"
  | "hardware"
  | "signalrgb"
  | "units"
  | "readings"
  | "appearance"
  | "previews"
  | "path-presets"
  | "keyboard"
  | "asset-sources"
  | "extensions"
  | "about";

/** A built-in destination or an installed plugin's page. A plugin page id keeps
 *  the `plugin:` prefix so it can never collide with a built-in word. */
export type SettingsPage = BuiltinSettingsPage | `plugin:${string}`;

export function isBuiltinSettingsPage(
  page: SettingsPage,
): page is BuiltinSettingsPage {
  return SETTINGS_PAGES.some((entry) => entry.id === page);
}

/** The two headings the column groups its rows under. This PC is the machine
 *  and its screens; Editor is how the author works on it. */
export type SettingsGroup = "this-pc" | "editor";

export interface SettingsPageEntry {
  readonly id: BuiltinSettingsPage;
  readonly group: SettingsGroup;
  readonly label: string;
  readonly glyph: LucideIcon;
}

/** **The one owner of the page list.** The navigation column and the page
 *  panels both read this array, so a page cannot be drawn with no word, and a
 *  word cannot be drawn with no page. The order is the column's reading order. */
export const SETTINGS_PAGES: readonly SettingsPageEntry[] = [
  {
    id: "displays",
    group: "this-pc",
    label: uiCopy.settings.pages.displays,
    glyph: DISPLAYS_GLYPH,
  },
  {
    id: "hardware",
    group: "this-pc",
    label: uiCopy.settings.pages.hardware,
    glyph: HARDWARE_GLYPH,
  },
  {
    id: "signalrgb",
    group: "this-pc",
    label: uiCopy.settings.pages.signalrgb,
    glyph: SIGNALRGB_GLYPH,
  },
  {
    id: "units",
    group: "this-pc",
    label: uiCopy.settings.pages.units,
    glyph: UNITS_GLYPH,
  },
  {
    id: "readings",
    group: "this-pc",
    label: uiCopy.settings.pages.readings,
    glyph: READINGS_GLYPH,
  },
  {
    id: "appearance",
    group: "editor",
    label: uiCopy.settings.pages.appearance,
    glyph: PALETTE_GLYPH,
  },
  {
    id: "previews",
    group: "editor",
    label: uiCopy.settings.pages.previews,
    glyph: PREVIEW_RATIOS_GLYPH,
  },
  {
    id: "path-presets",
    group: "editor",
    label: uiCopy.settings.pages.pathPresets,
    glyph: CUSTOM_SHAPES_GLYPH,
  },
  {
    id: "keyboard",
    group: "editor",
    label: uiCopy.settings.pages.keyboard,
    glyph: KEYBOARD_GLYPH,
  },
  {
    id: "asset-sources",
    group: "editor",
    label: uiCopy.settings.pages.assetSources,
    glyph: CONNECTIONS_GLYPH,
  },
  {
    id: "about",
    group: "editor",
    label: uiCopy.settings.pages.about,
    glyph: INFO_GLYPH,
  },
  {
    id: "extensions",
    group: "editor",
    label: uiCopy.settings.pages.extensions,
    glyph: PACKAGE_GLYPH,
  },
];

/** Each group heading, in the order it draws. */
export const SETTINGS_GROUPS: readonly {
  readonly id: SettingsGroup;
  readonly label: string;
}[] = [
  { id: "this-pc", label: uiCopy.settings.groups.thisPc },
  { id: "editor", label: uiCopy.settings.groups.editor },
];

/** The page's own label and hint, by id. */
export function pageCopy(page: BuiltinSettingsPage): {
  readonly title: string;
  readonly hint: string;
} {
  return {
    title: uiCopy.settings.pages[pageKey(page)],
    hint: uiCopy.settings.pageHints[pageKey(page)],
  };
}

/** The copy keys use camel case; the page ids use the shell's kebab case. */
function pageKey(
  page: BuiltinSettingsPage,
): keyof typeof uiCopy.settings.pages {
  return page === "asset-sources"
    ? "assetSources"
    : page === "path-presets"
      ? "pathPresets"
      : page;
}
