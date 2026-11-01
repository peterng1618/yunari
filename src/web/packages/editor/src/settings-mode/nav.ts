import {
  CONNECTIONS_GLYPH,
  DISPLAYS_GLYPH,
  HARDWARE_GLYPH,
  INFO_GLYPH,
  KEYBOARD_GLYPH,
  type LucideIcon,
  PALETTE_GLYPH,
  READINGS_GLYPH,
  UNITS_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";

/** The eight Settings destinations. The type is also the active-page state the
 *  shell holds, so a page added here and not handled there fails to compile. */
export type SettingsPage =
  | "displays"
  | "hardware"
  | "units"
  | "readings"
  | "appearance"
  | "keyboard"
  | "asset-sources"
  | "about";

/** The two headings the column groups its rows under. This PC is the machine
 *  and its screens; Editor is how the author works on it. */
export type SettingsGroup = "this-pc" | "editor";

export interface SettingsPageEntry {
  readonly id: SettingsPage;
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
export function pageCopy(page: SettingsPage): {
  readonly title: string;
  readonly hint: string;
} {
  return {
    title: uiCopy.settings.pages[pageKey(page)],
    hint: uiCopy.settings.pageHints[pageKey(page)],
  };
}

/** The copy keys use camel case; the page ids use the shell's kebab case. */
function pageKey(page: SettingsPage): keyof typeof uiCopy.settings.pages {
  return page === "asset-sources" ? "assetSources" : page;
}
