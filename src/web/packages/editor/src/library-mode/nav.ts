import {
  ASSETS_GLYPH,
  CUSTOM_SHAPES_GLYPH,
  DISPLAYS_GLYPH,
  EDITOR_MODE_GLYPH,
  HARDWARE_GLYPH,
  LIBRARY_MODE_GLYPH,
  type LucideIcon,
  PUBLISH_ITEM_GLYPH,
  STACK_GLYPH,
  WIDGETS_GLYPH,
} from "../editor-shell/icons.js";
import { uiCopy } from "../ui-copy.js";
import type { LibraryPage } from "./sources.js";

/** The two headings the navigation column groups its rows under: what a person
 *  can browse, and the author's own submissions. */
export type LibraryGroup = "browse" | "publish";

export interface LibraryPageEntry {
  readonly id: LibraryPage;
  readonly group: LibraryGroup;
  readonly label: string;
  readonly glyph: LucideIcon;
}

/**
 * **The one owner of the Library page list.** The navigation column and the
 * panel that draws the chosen page both read this array, so a page cannot be
 * drawn with no word and a word cannot be drawn with no page. The order is the
 * column's reading order.
 */
export const LIBRARY_PAGES: readonly LibraryPageEntry[] = [
  {
    id: "dashboard-themes",
    group: "browse",
    label: uiCopy.library.pages.dashboardThemes,
    glyph: LIBRARY_MODE_GLYPH,
  },
  {
    id: "app-themes",
    group: "browse",
    label: uiCopy.library.pages.appThemes,
    glyph: EDITOR_MODE_GLYPH,
  },
  {
    id: "widgets",
    group: "browse",
    label: uiCopy.library.pages.widgets,
    glyph: WIDGETS_GLYPH,
  },
  {
    id: "shapes",
    group: "browse",
    label: uiCopy.library.pages.shapes,
    glyph: CUSTOM_SHAPES_GLYPH,
  },
  {
    id: "sensor-providers",
    group: "browse",
    label: uiCopy.library.pages.sensorProviders,
    glyph: HARDWARE_GLYPH,
  },
  {
    id: "asset-sources",
    group: "browse",
    label: uiCopy.library.pages.assetSources,
    glyph: ASSETS_GLYPH,
  },
  {
    id: "panel-drivers",
    group: "browse",
    label: uiCopy.library.pages.panelDrivers,
    glyph: DISPLAYS_GLYPH,
  },
  {
    id: "collections",
    group: "browse",
    label: uiCopy.library.pages.collections,
    glyph: STACK_GLYPH,
  },
  {
    id: "submissions",
    group: "publish",
    label: uiCopy.library.pages.submissions,
    glyph: PUBLISH_ITEM_GLYPH,
  },
];

/** Each group heading, in the order it draws. */
export const LIBRARY_GROUPS: readonly {
  readonly id: LibraryGroup;
  readonly label: string;
}[] = [
  { id: "browse", label: uiCopy.library.groups.browse },
  { id: "publish", label: uiCopy.library.groups.publish },
];
