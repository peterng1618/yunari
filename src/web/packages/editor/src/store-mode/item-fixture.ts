import {
  DASHBOARD_THEME_KIND,
  type FabricThemeEnvelope,
  facetRecordOf,
} from "@yunari/renderer-core";
import type { ThemeLibraryEntry } from "../theme-library-client.js";
import type { CatalogueFacts, StoreItem } from "./local-source.js";

/**
 * The store's own fixtures, in a file of their own rather than in the tests that
 * read them.
 *
 * **The reason is the design-token gate.** A `*.dom.test.tsx` beside a gated
 * source is itself gated (`vg-228`), and a theme's ground is a colour a fixture
 * cannot spell except as a hex literal — so the two grounds live here, where a
 * fixture's own values are not a surface going around the language.
 *
 * **The record is derived, never written.** `facetRecordOf` is the host's own
 * derivation and the record is what the facets are read off, so a hand-written
 * `{label: "CPU", family: "system"}` would answer something the host never would
 * — the trap A.4a's review found in a fixture.
 */

/** A ground dark enough for the record to read `dark`. */
export const DARK_GROUND = "#101010";

/** One light enough to read `light`. */
export const LIGHT_GROUND = "#f4f4f4";

/** One fixture theme, as the few facts a test varies. */
export interface FixtureTheme {
  readonly id: string;
  readonly name?: string;
  readonly author?: string;
  /** The document's own version, which the caption line prints beside the date
   *  (`1.4.0 · 2026-10-14`). Absent is a document that declares none, which is
   *  the case that must draw no separator. */
  readonly version?: string;
  readonly width?: number;
  readonly height?: number;
  /** The document's background paint, as the envelope stores it. **Absent is a
   *  document with no paint at all**, which the record reads as `unclassified` —
   *  the one colour mode no facet offers and no pill is drawn for. */
  readonly ground?: string;
  /** What the theme binds, keyed the way a document keys them. */
  readonly bindings?: FabricThemeEnvelope["bindings"];
  /** The style tags the document declares. **Absent is a document that declares
   *  none**, which is what every theme in the library was before the format
   *  carried the field. */
  readonly tags?: readonly string[];
}

/** The document behind a fixture theme. */
export function fixtureEnvelope(theme: FixtureTheme): FabricThemeEnvelope {
  return {
    schemaVersion: 2,
    fabricVersion: "7.4.0",
    id: theme.id,
    artboard: {
      width: theme.width ?? 1920,
      height: theme.height ?? 1080,
    },
    // The background is the envelope's own layer, not the artboard's paint.
    ...(theme.ground === undefined
      ? {}
      : { background: { color: { value: theme.ground } } }),
    metadata: {
      name: theme.name ?? theme.id,
      themeLanguage: "en",
      ...(theme.author === undefined ? {} : { author: theme.author }),
      ...(theme.version === undefined ? {} : { version: theme.version }),
      ...(theme.tags === undefined ? {} : { tags: theme.tags }),
    },
    scene: { version: "7.4.0", objects: [] },
    ...(theme.bindings === undefined ? {} : { bindings: theme.bindings }),
  };
}

/** The listing entry the host derives for a fixture theme. */
export function fixtureEntry(theme: FixtureTheme): ThemeLibraryEntry {
  return {
    id: theme.id,
    name: theme.name ?? theme.id,
    ...(theme.author === undefined ? {} : { author: theme.author }),
    ...(theme.version === undefined ? {} : { version: theme.version }),
    updatedAt: "2026-10-14T00:00:00.000Z",
    facets: facetRecordOf(fixtureEnvelope(theme)),
  };
}

/** The item a source would hand the gallery for a fixture theme.
 *
 *  The second argument is the catalogue's facts for an online fixture; a
 *  library fixture leaves it `undefined`, which is what the cell's origin pill
 *  and `installStateOf` read. */
export function fixtureItem(
  theme: FixtureTheme,
  catalogue: CatalogueFacts | undefined = undefined,
): StoreItem {
  const entry = fixtureEntry(theme);
  return {
    id: entry.id,
    kind: DASHBOARD_THEME_KIND,
    name: entry.name,
    author: entry.author,
    version: entry.version,
    updatedAt: entry.updatedAt,
    thumbnailUrl: undefined,
    ground: theme.ground,
    // A fixture theme is one the author made here, so the host holds no record
    // of where it came from — which is the absence the badge is read against.
    origin: undefined,
    // A fixture is a library item unless the case hands it catalogue facts.
    catalogue,
    facets: entry.facets,
  };
}
