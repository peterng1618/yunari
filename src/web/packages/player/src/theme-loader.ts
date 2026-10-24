import {
  createAssetResolver,
  DEFAULT_UNIT_PREFERENCES,
  type FabricThemeEnvelope,
  isMeasurementSystem,
  normalizeUnitPreferences,
  readFabricThemeEnvelope,
  type UnitPreferences,
} from "@yunari/renderer-core";

/**
 * Why a theme could not be loaded, in a vocabulary the failure page can speak.
 *
 * The page shows a sentence, not an exception. A caught `Error`'s `message` is
 * written by whatever threw it — V8, undici, a JSON parser — and V8's text for
 * an HTML page arriving where a theme was expected says the theme file is
 * corrupt when the likeliest cause by far is that nothing is serving at all.
 * So the cause is named here, and `ui-copy.ts` owns what a reader is told.
 */
export type ThemeLoadCode =
  | "missing-id"
  | "invalid-id"
  | "not-found"
  | "host-failed"
  | "not-a-theme"
  | "invalid-theme"
  | "font-unavailable";

export class ThemeLoadError extends Error {
  /** Which sentence the failure page shows. One owner: `ui-copy.ts`. */
  readonly code: ThemeLoadCode;
  /** The one short token that sentence may name — an HTTP status, a validator
   *  code, an asset id. Nothing else reaches a display. */
  readonly detail: string | undefined;

  constructor(code: ThemeLoadCode, message: string, detail?: string) {
    super(message);
    this.name = "ThemeLoadError";
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The consumer's preferences for this PC: what a display obeys rather than
 * authors. A host that cannot answer, or answers with something this build
 * cannot display, leaves the display on what providers report.
 */
export async function loadDisplayPreferences(
  fetcher: typeof fetch,
): Promise<UnitPreferences> {
  try {
    const response = await fetcher("/api/display");
    if (!response.ok) {
      return { ...DEFAULT_UNIT_PREFERENCES };
    }

    const body = (await response.json()) as {
      settings?: { measurement?: unknown; units?: unknown };
    };
    // A stored value this build cannot display refuses the whole set rather
    // than being silently dropped: the reading then shows what every other
    // display shows, which is the one answer nobody chose but everyone shares.
    const units = normalizeUnitPreferences(body.settings?.units ?? {});
    const measurement = body.settings?.measurement;

    return {
      ...DEFAULT_UNIT_PREFERENCES,
      ...units,
      // The top-level field is the older spelling of the same choice; it only
      // answers where the newer bag says nothing.
      ...(units.measurement === undefined && isMeasurementSystem(measurement)
        ? { measurement }
        : {}),
    };
  } catch {
    return { ...DEFAULT_UNIT_PREFERENCES };
  }
}

export async function loadHostedTheme(
  id: string,
  fetcher: typeof fetch,
): Promise<FabricThemeEnvelope> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new ThemeLoadError("invalid-id", "Invalid theme id.");
  }

  const response = await fetcher(
    `/api/themes/${encodeURIComponent(id)}/document`,
  );
  if (!response.ok) {
    throw new ThemeLoadError(
      // 404 is the wrong-id case, which the reader can fix; every other
      // status is the host's problem and theirs is to fix it.
      response.status === 404 ? "not-found" : "host-failed",
      `Could not load theme (${response.status}).`,
      String(response.status),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // The likeliest cause by far is that nothing is serving this path: a host
    // that is not running, or a dev server or proxy in front of one, answers a
    // theme request with an HTML page. V8 calls that a malformed theme file,
    // so the cause is named here rather than letting the parser describe itself.
    throw new ThemeLoadError(
      "not-a-theme",
      `The host answered ${response.status} with ${
        response.headers.get("content-type") ?? "no content type"
      }, not a theme document.`,
    );
  }

  const result = readFabricThemeEnvelope(body);
  if (!result.ok) {
    const issue = result.issues[0];
    throw new ThemeLoadError(
      "invalid-theme",
      issue?.message ?? "Invalid hosted theme.",
      issue?.code,
    );
  }

  return result.envelope;
}

/** Downloads only declared packaged font bytes; other assets remain renderer-owned URLs. */
export async function loadHostedFontAssets(
  id: string,
  theme: FabricThemeEnvelope,
  fetcher: typeof fetch,
): Promise<Readonly<Record<string, Uint8Array>>> {
  // The resolver owns how a declared path becomes a URL, so a font and an
  // image cannot end up asking the host for the same asset two different ways.
  const resolve = createAssetResolver(theme.assets, {
    baseUrl: `/api/themes/${encodeURIComponent(id)}/`,
  });
  const fonts = (theme.assets ?? []).filter((asset) => asset.kind === "font");
  const entries = await Promise.all(
    fonts.map(async (asset) => {
      const url = resolve(asset.id);

      if (url === undefined) {
        throw new ThemeLoadError(
          "font-unavailable",
          `Font asset "${asset.id}" has no loadable path.`,
          asset.id,
        );
      }

      const response = await fetcher(url);
      if (!response.ok)
        throw new ThemeLoadError(
          "font-unavailable",
          `Could not load font asset "${asset.id}" (${response.status}).`,
          asset.id,
        );
      return [
        asset.path,
        new Uint8Array(await response.arrayBuffer()),
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
