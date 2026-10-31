import type {
  DisplayShape,
  FabricThemeEnvelope,
  FacetRecord,
  ThemeRemix,
  ValidationIssue,
} from "@yunari/renderer-core";
import {
  readThemeCredits,
  type ThemeCredits,
  type ThemeOrigin,
} from "@yunari/theme-package";

/**
 * The host's library is a folder, so a save carries the document
 * and its declared bytes rather than an archive the host would only unpack
 * again. The archive is still the export; this is the working path.
 */

export interface ThemeLibraryEntry {
  readonly id: string;
  readonly name: string;
  /** The host store's own mtime. A template is not a stored file and has none,
   *  which is what keeps it out of a count of the author's saved themes. */
  readonly updatedAt?: string;
  /** The document's author, when it declares one. */
  readonly author?: string;
  /** The document's own version, when it declares one. Optional like `author`,
   *  and absent for the same reason: a theme that declares no version draws no
   *  version and no separator beside it. */
  readonly version?: string;
  /** The catalogue item this document was remixed from, when it declares one.
   *  Optional like `author`, and absent for the same reason: a theme that
   *  declares no credit has no key at all. */
  readonly remixOf?: ThemeRemix;
  /** Where this copy came from, when the host holds a record of it.
   *  **Optional, and the absence is the truth**: the record is consumer state
   *  the host keeps beside the library, so a theme the author made here has no
   *  key at all — exactly as `author` has none for a document that declares
   *  none, and never a key holding `undefined`. */
  readonly origin?: ThemeOrigin;
  /** What the theme *is*, derived by the host from the document it listed —
   *  required, because every entry here is a stored theme and every stored
   *  theme has a document to derive it from. */
  readonly facets: FacetRecord;
  /** The artboard's paint as CSS, derived by the host from the same document,
   *  for a gallery cell with no picture to show. **Optional, and the absence is
   *  the truth**: a document with no paint — or with media behind the board,
   *  where the picture is the ground and the token is not — has no key at all on
   *  the wire, exactly as `author` has none for a theme that declares none. */
  readonly ground?: string;
  /** Where the theme's picture is served, built here because this is what
   *  knows the host's base URL. Absent from a producer that has no host. */
  readonly thumbnailUrl?: string;
}

/**
 * Where a stored theme came from, as the host records it: the catalogue item it
 * was installed from and the version this copy holds.
 *
 * The shape is `@yunari/theme-package`'s, shared with the host rather than
 * declared here, so a rename cannot typecheck on both sides and render
 * `From the store · undefined · undefined`. The host's record and this reading
 * of it are one owner.
 */
export type { ThemeOrigin };

export interface ThemeLibraryContent {
  readonly envelope: FabricThemeEnvelope;
  readonly assets: Readonly<Record<string, Uint8Array>>;
  /** The attribution member the host keeps beside the document. Absent when the
   *  stored theme credits nothing, which is not the same as an empty list. */
  readonly credits?: ThemeCredits;
  /** The stored document this content came from. Sending it back is what lets
   *  the host tell a save made from what it stored from one made from a
   *  document that has since been overtaken. */
  readonly base?: string;
}

/**
 * The host refused a save because the stored theme moved on after the document
 * this save was built from. Nothing was written, and nothing is lost: the
 * caller's document is untouched, and it can reload or replace deliberately.
 */
export class ThemeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThemeConflictError";
  }
}

/**
 * The host holds the theme and its document does not validate — a different
 * answer from "no such theme", which is what the host used to give for both.
 * `issues` is the validator's own list, carried through the `422` the host
 * answers, so a caller can tell this from the 404 a dead id gets and
 * say why rather than reporting a bare status.
 */
export class ThemeValidationError extends Error {
  readonly issues: readonly ValidationIssue[];
  constructor(id: string, issues: readonly ValidationIssue[]) {
    super(`"${id}" is stored but does not validate.`);
    this.name = "ThemeValidationError";
    this.issues = issues;
  }
}

/**
 * The host holds the theme and its stored document is past the size the store
 * will read — a different answer from "no such theme", which is what the host
 * used to give for both. The `413` the host answers carries no issues, because
 * nothing about the document is invalid: the reason is its size, and that is
 * the whole of it, so this is its own error rather than a validation failure
 * (vg-409).
 */
export class ThemeTooLargeError extends Error {
  constructor(id: string) {
    super(`"${id}" is stored but too large to open.`);
    this.name = "ThemeTooLargeError";
  }
}

/** The key `assign` takes for the theme a display holding no choice of its own
 *  falls to. The host owns this literal — `packages/host/src/settings/displays.ts`'s
 *  `DEFAULT_DISPLAY` — and this package does not depend on that one, so this is
 *  the editor's single copy of the string, beside the interface that documents
 *  the same key. */
export const DEFAULT_DISPLAY_KEY = "default";

/**
 * One row of the display map: a display and the theme it holds.
 *
 * The route also sends `kind` for the host page's own warning table, which is
 * the page's question and not this seam's. The default is not a row — it is the
 * theme a display holding none of its own falls to — so it travels beside these.
 */
export interface ThemedDisplay {
  readonly id: string;
  readonly label: string;
  /** What the host says this display is. The Host mode reads it to draw the
   *  panel state for a panel even when its device is not attached. */
  readonly kind: "paired" | "local" | "panel";
  /** The theme this display holds, or `null` for one holding none of its own —
   *  which is not the same as showing the default. */
  readonly theme: string | null;
  /** The glass this display is. The host answers `rect` for this PC and for any
   *  record whose shape it could not read. */
  readonly shape: DisplayShape;
  /** Whole degrees clockwise; the host answers `0` for an absent record value. */
  readonly rotation: number;
  /** Present only for a panel display this host drives: whether its device is
   *  open, and the commands its driver accepts. Absent for a paired browser and
   *  for a local monitor, which the host does not open. */
  readonly panel?: ThemedPanel;
}

/** What the host says about one panel display's device. */
export interface ThemedPanel {
  readonly status: PanelConnectionStatus;
  /** The command kinds the family accepts. Spelled as strings here because this
   *  seam reads the wire; the controls surface filters them. */
  readonly commands: readonly string[];
}

export type PanelConnectionStatus = "connected" | "connecting" | "disconnected";

export interface ThemeLibraryClient {
  list(): Promise<readonly ThemeLibraryEntry[]>;
  open(id: string): Promise<ThemeLibraryContent>;
  /** Saves, and answers the id of the document now stored — which is the base
   *  the next save is based on. */
  save(
    id: string,
    content: ThemeLibraryContent,
    options?: { readonly overwrite?: boolean },
  ): Promise<string>;
  /** Stores the theme's picture, so the library can show one. Optional: a
   * failure here must not fail the save. */
  saveThumbnail?(id: string, png: Uint8Array): Promise<void>;
  /** Moves the theme's folder to the host's trash. Recoverable from there, so
   *  this is a removal and not an unlink.
   *
   *  Optional, as {@link ThemeLibraryClient.saveThumbnail} is: a client that
   *  cannot delete must simply not offer deletion, rather than fail at the
   *  moment the author presses the button. */
  remove?(id: string): Promise<void>;
  /** Puts a theme on one display, or on {@link DEFAULT_DISPLAY_KEY} — what a
   *  display holding no choice of its own falls to. */
  assign(display: string, id: string): Promise<void>;
  /** Every display this host holds with the theme it shows, and the theme a
   *  display holding none falls to. This PC is always present and always first.
   *
   *  `default` is a *theme*, not a key: {@link DEFAULT_DISPLAY_KEY} is what
   *  `assign` takes. It is its own field and never a row, because a theme id is
   *  not a display id and a pseudo-row would make the two indistinguishable. */
  listDisplays(): Promise<{
    readonly default: string | null;
    readonly displays: readonly ThemedDisplay[];
    /** True when the host's display file is there and unusable: the list is
     *  empty because it could not be read, not because no display exists, and
     *  every write to it will refuse. Optional so a client that predates the
     *  answer reads as "nothing to report" rather than a fabricated failure. */
    readonly unreadable?: boolean;
  }>;
}

/** The shape of a library id. The host owns the same shape for a package's own
 *  id (`isValidThemeId`); this one is for the ids a client sends. */
const THEME_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/** Chunked because `String.fromCharCode` is applied to an argument list. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function readContent(json: unknown): ThemeLibraryContent {
  const body = json as {
    readonly envelope?: unknown;
    readonly assets?: unknown;
    readonly credits?: unknown;
    readonly base?: unknown;
  };
  // The package reader validates the member at this boundary too. A host that
  // sends one this build cannot read costs the attribution and never the
  // document: the theme is still the thing the author asked to open.
  const credits =
    body?.credits === undefined
      ? undefined
      : readThemeCredits(
          new TextEncoder().encode(JSON.stringify(body.credits)),
        );
  return {
    envelope: body?.envelope as FabricThemeEnvelope,
    assets: Object.fromEntries(
      Object.entries((body?.assets ?? {}) as Record<string, string>).map(
        ([assetPath, encoded]) => [assetPath, fromBase64(encoded)],
      ),
    ),
    ...(credits === undefined ? {} : { credits }),
    // A host that reports no base leaves the content without one, so the save
    // that follows is ungated rather than refused for a reason it cannot fix.
    ...(typeof body?.base === "string" ? { base: body.base } : {}),
  };
}

/** The shape and angle the host's record would read from two wire values.
 *
 *  **The one owner of that reading**, shared with the Host settings client: an
 *  unknown shape is a rectangular screen rather than a dropped row, and an
 *  angle its shape cannot hold reads as upright rather than as a number a
 *  control could then write back. */
export function readDisplayPresentation(
  shapeValue: unknown,
  rotationValue: unknown,
): { readonly shape: DisplayShape; readonly rotation: number } {
  const shape: DisplayShape = shapeValue === "circle" ? "circle" : "rect";
  if (
    typeof rotationValue !== "number" ||
    !Number.isInteger(rotationValue) ||
    rotationValue < 0 ||
    rotationValue >= 360
  ) {
    return { shape, rotation: 0 };
  }
  return {
    shape,
    rotation: shape === "rect" && rotationValue % 90 !== 0 ? 0 : rotationValue,
  };
}

/**
 * The host's display kind, read defensively.
 *
 * An older host that named none is read as a paired browser: the panel surface
 * gates on `panel`, so an unknown kind must not offer panel controls for a
 * device nothing said was one.
 */
function readDisplayKind(value: unknown): ThemedDisplay["kind"] {
  return value === "panel" || value === "local" ? value : "paired";
}

/**
 * The panel state the host reports, or nothing.
 *
 * A host before this field sends no `panel`, and a shape this build cannot read
 * is absent rather than defaulted: a status invented here would tell the owner
 * a device is connected when nothing said so.
 */
function readPanelState(value: unknown): { readonly panel?: ThemedPanel } {
  if (typeof value !== "object" || value === null) return {};

  const { status, commands } = value as {
    readonly status?: unknown;
    readonly commands?: unknown;
  };
  if (
    status !== "connected" &&
    status !== "connecting" &&
    status !== "disconnected"
  ) {
    return {};
  }

  return {
    panel: {
      status,
      commands: Array.isArray(commands)
        ? commands.filter((kind): kind is string => typeof kind === "string")
        : [],
    },
  };
}

export function createThemeLibraryClient(options?: {
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}): ThemeLibraryClient {
  const fetcher = options?.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options?.baseUrl ?? "";

  return {
    async list(): Promise<readonly ThemeLibraryEntry[]> {
      const response = await fetcher(`${baseUrl}/api/themes`);
      if (!response.ok) {
        throw new Error(`Could not list themes (${response.status}).`);
      }
      const data = (await response.json()) as
        | { themes?: readonly ThemeLibraryEntry[] }
        | readonly ThemeLibraryEntry[];
      const entries = Array.isArray(data)
        ? data
        : typeof data === "object" &&
            data !== null &&
            "themes" in data &&
            Array.isArray(data.themes)
          ? data.themes
          : [];
      // The picture's address is built here, because this is the thing that
      // knows the host's base URL and the route `saveThumbnail` writes to. A
      // theme with no picture yet is a 404 at that address, which is the
      // reader's to show or not.
      return entries.map((entry) => ({
        ...entry,
        thumbnailUrl: `${baseUrl}/api/themes/${encodeURIComponent(entry.id)}/thumbnail`,
      }));
    },

    async open(id: string): Promise<ThemeLibraryContent> {
      if (!THEME_ID_REGEX.test(id)) {
        throw new Error("Invalid theme id.");
      }
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(id)}`,
      );
      // Its own error, because the theme is there and the reason is a document
      // the author can fix — not the not-found a dead id gets. Without this the
      // two collapsed into one failure and the editor reported success over a
      // document it never opened (vg-110).
      if (response.status === 422) {
        const body = (await response.json().catch(() => undefined)) as
          | { readonly issues?: unknown }
          | undefined;
        throw new ThemeValidationError(
          id,
          Array.isArray(body?.issues)
            ? (body.issues as readonly ValidationIssue[])
            : [],
        );
      }
      // The theme is there and the reason is its size rather than its content,
      // so it gets its own error instead of the not-found a dead id gets — the
      // same half the 422 above fixed for validation (vg-409).
      if (response.status === 413) {
        throw new ThemeTooLargeError(id);
      }
      if (!response.ok) {
        throw new Error(`Could not open theme "${id}" (${response.status}).`);
      }
      return readContent(await response.json());
    },

    async save(
      id: string,
      content: ThemeLibraryContent,
      options?: { readonly overwrite?: boolean },
    ): Promise<string> {
      if (!THEME_ID_REGEX.test(id)) {
        throw new Error("Invalid theme id.");
      }
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            envelope: content.envelope,
            assets: Object.fromEntries(
              Object.entries(content.assets).map(([assetPath, bytes]) => [
                assetPath,
                toBase64(bytes),
              ]),
            ),
            ...(content.credits === undefined
              ? {}
              : { credits: content.credits }),
            ...(content.base === undefined ? {} : { base: content.base }),
            overwrite: options?.overwrite === true,
          }),
        },
      );
      // Its own error, because this is the one failure the caller can act on
      // rather than retry: the document it holds is still perfectly good.
      if (response.status === 409) {
        throw new ThemeConflictError(await response.text().catch(() => ""));
      }
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Could not save theme "${id}" (${response.status}): ${errorText}`,
        );
      }
      const saved = (await response.json()) as { readonly base?: unknown };
      // A base invented here would be refused on the next save, so a host that
      // does not report one is a failure rather than something to paper over.
      if (typeof saved.base !== "string") {
        throw new Error("The host did not report what it saved.");
      }
      return saved.base;
    },

    async saveThumbnail(id: string, png: Uint8Array): Promise<void> {
      if (!THEME_ID_REGEX.test(id)) {
        throw new Error("Invalid theme id.");
      }
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(id)}/thumbnail`,
        {
          method: "PUT",
          headers: { "content-type": "image/png" },
          body: png as unknown as BodyInit,
        },
      );
      if (!response.ok) {
        throw new Error(`Could not save the thumbnail (${response.status}).`);
      }
    },

    async remove(id: string): Promise<void> {
      if (!THEME_ID_REGEX.test(id)) {
        throw new Error("Invalid theme id.");
      }
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (response.status === 404) {
        throw new Error(await response.text().catch(() => "No such theme."));
      }
      if (!response.ok) {
        // A trash that refused says why, and that reason is the author's: the
        // theme is still in the library, so this is not a lost document but a
        // PC that cannot move one to its trash.
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Could not move "${id}" to the trash (${response.status}): ${errorText}`,
        );
      }
    },

    async assign(display: string, id: string): Promise<void> {
      if (!THEME_ID_REGEX.test(id)) {
        throw new Error("Invalid theme id.");
      }
      const response = await fetcher(`${baseUrl}/api/themes/active`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // Both keys always travel. The route reads the display from the body
        // for a loopback caller and answers 400 without one, so leaving it out
        // is a refusal rather than a write to this PC.
        body: JSON.stringify({ display, id }),
      });
      if (!response.ok) {
        // The refusal is the host's own word — "No such display." or "No such
        // theme." — and it is the one that says which of the two this was.
        throw new Error(
          (await response.text().catch(() => "")) ||
            "Could not assign the theme.",
        );
      }
    },

    async listDisplays(): Promise<{
      readonly default: string | null;
      readonly displays: readonly ThemedDisplay[];
      readonly unreadable?: boolean;
    }> {
      const response = await fetcher(`${baseUrl}/api/themes/active`);
      if (!response.ok) {
        throw new Error(
          (await response.text().catch(() => "")) ||
            "Could not list the displays.",
        );
      }
      const body = (await response.json()) as {
        readonly default?: unknown;
        readonly displays?: unknown;
        readonly displayFileUnreadable?: unknown;
      };
      return {
        // A host that names no default is one where nothing falls back, which
        // is `null` rather than a theme id invented here.
        default: typeof body?.default === "string" ? body.default : null,
        ...(body?.displayFileUnreadable === true ? { unreadable: true } : {}),
        displays: Array.isArray(body?.displays)
          ? (body.displays as readonly ThemedDisplay[]).map(
              ({ id, label, kind, theme, shape, rotation, panel }) => ({
                id,
                label,
                kind: readDisplayKind(kind),
                theme,
                ...readDisplayPresentation(shape, rotation),
                ...readPanelState(panel),
              }),
            )
          : [],
      };
    },
  };
}
