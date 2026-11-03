import type { FabricThemeEnvelope, FacetRecord } from "@yunari/renderer-core";
import type { ThemeCredits, ThemeCreditsEntry } from "@yunari/theme-package";
import { vi } from "vitest";
import {
  AssetManager,
  type LocalAssetReference,
} from "../asset-manager/index.js";
import type { CleanupAnswer } from "../editor-document.js";
import type { ErrorManager } from "../error-manager/index.js";
import type {
  ThemeLibraryClient,
  ThemeLibraryEntry,
} from "../theme-library-client.js";
import { ThemeLibraryManager } from "./index.js";

/**
 * Fixtures and a manager harness shared by this directory's test files: the
 * documented envelope, a stored installed theme, the asset and save ledgers,
 * and the one manager construction every case wires.
 */
export const envelope: FabricThemeEnvelope = {
  schemaVersion: "2.0.0",
  fabricVersion: "7.4.0",
  id: "living-room",
  artboard: { width: 1920, height: 1080 },
  scene: { version: "7.4.0", objects: [] },
};

/** An installed theme as the library stored it: it declares everything the
 *  remix has to drop, including a credit of its own — a saved remix has no
 *  host origin record, so the chooser offers it Duplicate. */
export const storedInstalled: FabricThemeEnvelope = {
  ...envelope,
  metadata: {
    name: "Primary",
    author: "Ada",
    version: "1.2.0",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    themeLanguage: "en",
    remixOf: {
      catalogueId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f2a3b4c5d",
      name: "Ancestor",
      version: "1.0.0",
    },
  },
};

export const PARENT = {
  catalogueId: "5f0c4f30-0f8c-4e4f-9c1f-1f0f0f0f0f0f",
  name: "Primary",
  version: "1.2.0",
} as const;

export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PNG = new Uint8Array([137, 80, 78, 71]);
export const OTHER = new Uint8Array([137, 80, 78, 72]);

/** The record the host derives for every listed theme; no case here reads it. */
export const FACETS: FacetRecord = {
  author: undefined,
  colourMode: "unclassified",
  sensors: [],
  tags: [],
  orientation: "landscape",
  aspect: "16:9",
  width: 1920,
  height: 1080,
};

/** One theme as the host's listing reports it, with its modified time. */
export function listed(id: string, updatedAt: string): ThemeLibraryEntry {
  return { id, name: id, updatedAt, facets: FACETS };
}
export const CREDITS: ThemeCredits = {
  format: "yunari-theme-credits",
  version: 1,
  entries: [
    {
      kind: "icon",
      title: "Badge",
      license: "ISC v2",
      changes: "Imported unchanged",
    },
  ],
};

export function declaration(id: string, sha256: string): LocalAssetReference {
  return { id, kind: "image", path: `assets/${id}.png`, sha256 };
}

/** A manager holding these declarations, as the shell hands one over once it
 *  has revived the document's scene. */
export function assetsWith(
  declarations: readonly LocalAssetReference[],
  bytes: Readonly<Record<string, Uint8Array>>,
): AssetManager {
  const assets = new AssetManager();
  assets.load({ assets: declarations }, bytes);
  return assets;
}

/** What a request body carries, kept in one place so a test asserts on the save
 *  rather than on a transcription of it. */
export interface SaveCall {
  readonly id: string;
  readonly base: string | undefined;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  readonly overwrite: boolean;
}

export function savedCalls(save: ReturnType<typeof vi.fn>): SaveCall[] {
  return save.mock.calls.map(([id, content, options]) => ({
    id: id as string,
    base: (content as { readonly base?: string }).base,
    assets: (
      content as { readonly assets: Readonly<Record<string, Uint8Array>> }
    ).assets,
    overwrite: (options as { readonly overwrite: boolean }).overwrite,
  }));
}

import type { Mock } from "vitest";

/** What {@link harness} hands back: the manager under test and the spies a case
 *  asserts through. Named because an inferred return type from `vi.fn()`
 *  reaches a vitest-internal `Procedure` a declaration file cannot name. */
export interface Harness {
  readonly manager: ThemeLibraryManager;
  readonly client: ThemeLibraryClient;
  readonly save: Mock;
  readonly saveThumbnail: Mock;
  readonly markSaved: Mock;
  readonly announceChange: Mock;
  readonly adoptIdentity: Mock;
  readonly warn: Mock;
  readonly onSaved: Mock;
  readonly onError: Mock;
  readonly onNewFromStarter: Mock;
  readonly onOpenTheme: Mock;
}

export function harness(options: {
  readonly assets?: AssetManager;
  readonly base?: string;
  readonly snapshot?: () => FabricThemeEnvelope;
  readonly picture?: () => Promise<Uint8Array | undefined>;
  readonly client?: Partial<ThemeLibraryClient>;
  /** The answer to the replacement question. `true` unless a case is about the
   *  refusal, which is the one road that reads nothing. */
  readonly confirm?: () => Promise<boolean>;
  /** The document's cleanup question, which this manager asks before overwriting.
   *  Nothing unused by default, so an existing case is not about it. */
  readonly cleanup?: () => Promise<CleanupAnswer>;
  readonly credits?: () => ThemeCredits | undefined;
  /** The copy a save stores; by default the envelope being written and the
   *  document's bytes. */
  readonly output?: (envelope: FabricThemeEnvelope) => {
    readonly envelope: FabricThemeEnvelope;
    readonly assets: Readonly<Record<string, Uint8Array>>;
    readonly credits?: ThemeCredits;
  };
  readonly adoptIdentity?: (id: string, name: string) => void;
}): Harness {
  const save = vi.fn(async () => "base-after-save");
  const open = vi.fn(async () => ({
    envelope,
    assets: {},
    base: "base-from-open",
  }));
  const saveThumbnail = vi.fn(async () => {});
  // Spies rather than inert stubs: the manager calls neither, and a test that
  // means to forbid a call can read that off them rather than trusting a
  // default that would resolve either way.
  const assign = vi.fn(async () => undefined);
  const listDisplays = vi.fn(async () => ({ default: null, displays: [] }));
  const markSaved = vi.fn();
  const announceChange = vi.fn();
  const adoptIdentity = vi.fn(options.adoptIdentity ?? (() => {}));
  const warn = vi.fn();
  const onSaved = vi.fn();
  const onError = vi.fn();
  const onNewFromStarter = vi.fn(async () => {});
  const onOpenTheme = vi.fn<
    (
      envelope: FabricThemeEnvelope,
      assets: Readonly<Record<string, Uint8Array>>,
      base?: string,
      credits?: readonly ThemeCreditsEntry[],
    ) => Promise<void>
  >(async () => {});
  const errors: ErrorManager = { error: vi.fn(), warn };
  // Built before the manager so the harness can hand back the very client it
  // wired: the defaults above are not what the manager received once an
  // override lands, and asserting on one of them would pass for the wrong
  // reason.
  const client: ThemeLibraryClient = {
    list: async () => [],
    open,
    save,
    saveThumbnail,
    assign,
    listDisplays,
    ...options.client,
  };
  const snapshot = options.snapshot ?? (() => envelope);
  const assets = options.assets ?? assetsWith([], {});
  const manager = new ThemeLibraryManager({
    snapshot,
    assets,
    output:
      options.output ??
      ((saved) => {
        const credits = options.credits?.();
        return {
          envelope: saved,
          assets: assets.assets,
          ...(credits === undefined ? {} : { credits }),
        };
      }),
    picture: options.picture ?? (async () => undefined),
    markSaved,
    announceChange,
    adoptIdentity,
    errors,
    confirmReplacement: options.confirm ?? (async () => true),
    confirmCleanup: options.cleanup ?? (async () => ({ proceed: true })),
    onSaved,
    onNewFromStarter,
    client,
    onError,
    onOpenTheme,
    ...(options.base === undefined ? {} : { base: options.base }),
  });
  return {
    manager,
    client,
    save,
    saveThumbnail,
    markSaved,
    announceChange,
    adoptIdentity,
    warn,
    onSaved,
    onError,
    onNewFromStarter,
    onOpenTheme,
  };
}
