import type {
  Artboard,
  AssetReference,
  Background,
  Binding,
  Globals,
  PalettePaint,
  ThemeMetadata,
} from "./document.js";

/**
 * The theme schema version this build reads and writes.
 *
 * One owner, and the envelope's own type pins itself to it, so the number the
 * About tab reports cannot drift from the number a save writes.
 */
export const SUPPORTED_SCHEMA_VERSION = 2;

export interface FabricPaletteEntry {
  readonly name: string;
  readonly value: PalettePaint;
}

export type FabricPalette = Readonly<Record<string, FabricPaletteEntry>>;
/** Development v2 has one global owner for paint and one for typography. */
export type FabricGlobals = Pick<Globals, "typePresets"> & {
  readonly palette?: FabricPalette;
};

/** Versioned Yunari metadata around the opaque Fabric-authored scene. */
export interface FabricThemeEnvelope {
  readonly schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  readonly fabricVersion: string;
  readonly id: string;
  readonly artboard: Artboard;
  readonly background?: Background;
  readonly scene: Readonly<Record<string, unknown>>;
  readonly metadata?: ThemeMetadata;
  readonly globals?: FabricGlobals;
  readonly assets?: readonly AssetReference[];
  /** Semantic bindings remain Yunari data, keyed by Fabric object id. */
  readonly bindings?: Readonly<Record<string, readonly Binding[]>>;
  readonly editorMetadata?: Readonly<Record<string, unknown>>;
}

export type FabricThemeEnvelopeInput = Omit<
  FabricThemeEnvelope,
  "schemaVersion" | "fabricVersion" | "scene"
>;
