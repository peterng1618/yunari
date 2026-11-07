/**
 * The admin chooser's only two calls: the display map it draws and the writes
 * its rows make.
 *
 * It lives in the host package because the host serves this bundle, and it is
 * bundled into `dist-admin` rather than the player: the player stays React-free
 * and size-budgeted, and this page is served to a display over the LAN.
 */

/** One saved theme, as `/api/themes/active` lists it. A thumbnail is a
 *  boolean, not a URL: the picture's route is derived from the id. */
export interface ChooserTheme {
  readonly id: string;
  readonly name?: string;
  readonly author?: string;
  readonly costs?: readonly string[];
  readonly thumbnail?: boolean;
}

/** One display row, in the order the host draws it. */
export interface ChooserDisplay {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
  readonly theme: string | null;
}

/** A template the product ships: listed, never chosen as what a display shows. */
export interface ChooserTemplate {
  readonly id: string;
  readonly name: string;
}

/** What the chooser reads before it can draw anything. */
export interface ChooserData {
  readonly themes: readonly ChooserTheme[];
  readonly templates: readonly ChooserTemplate[];
  readonly displays: readonly ChooserDisplay[];
  readonly default: string | null;
}

/** The page's one dependency, so a DOM test can answer without a host. */
export interface ChooserClient {
  read(): Promise<ChooserData>;
  choose(display: string, id: string): Promise<void>;
  /** Moves the theme's folder to the host's trash. Recoverable, so this is a
   *  removal and not an unlink. */
  remove(id: string): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): readonly string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : undefined;
}

function readThemes(value: unknown): readonly ChooserTheme[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChooserTheme[] => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    const costs = strings(entry.costs);
    return [
      {
        id: entry.id,
        ...(typeof entry.name === "string" ? { name: entry.name } : {}),
        ...(typeof entry.author === "string" ? { author: entry.author } : {}),
        ...(costs === undefined ? {} : { costs }),
        ...(typeof entry.thumbnail === "boolean"
          ? { thumbnail: entry.thumbnail }
          : {}),
      },
    ];
  });
}

function readTemplates(value: unknown): readonly ChooserTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChooserTemplate[] => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    return [
      {
        id: entry.id,
        name: typeof entry.name === "string" ? entry.name : entry.id,
      },
    ];
  });
}

function readDisplays(value: unknown): readonly ChooserDisplay[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ChooserDisplay[] => {
    if (!isRecord(entry) || typeof entry.id !== "string") return [];
    return [
      {
        id: entry.id,
        label: typeof entry.label === "string" ? entry.label : entry.id,
        ...(typeof entry.kind === "string" ? { kind: entry.kind } : {}),
        theme: typeof entry.theme === "string" ? entry.theme : null,
      },
    ];
  });
}

/** Reads the map, refusing a body that is not an object rather than inventing
 *  an empty library — a host that answered nonsense is not a host with none. */
export function readChooserData(value: unknown): ChooserData {
  if (!isRecord(value)) throw new Error("The host answered no theme map.");
  return {
    themes: readThemes(value.themes),
    templates: readTemplates(value.templates),
    displays: readDisplays(value.displays),
    default: typeof value.default === "string" ? value.default : null,
  };
}

/** The host's own reason for a refusal, in the words it sent. */
async function refusal(response: Response, fallback: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  try {
    const message = (JSON.parse(body) as { error?: unknown }).error;
    if (typeof message === "string" && message !== "")
      return new Error(message);
  } catch {
    // Not JSON: the plain text already is the host's reason.
  }
  return new Error(body || `${fallback} (${response.status}).`);
}

export function createChooserClient(
  fetcher: typeof fetch = fetch,
  baseUrl = "",
): ChooserClient {
  return {
    async read() {
      const response = await fetcher(`${baseUrl}/api/themes/active`);
      if (!response.ok) {
        throw await refusal(response, "The saved themes could not be read");
      }
      return readChooserData(await response.json());
    },

    async choose(display, id) {
      const response = await fetcher(`${baseUrl}/api/themes/active`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ display, id }),
      });
      if (!response.ok) {
        throw await refusal(response, "Could not save");
      }
    },

    async remove(id) {
      const response = await fetcher(
        `${baseUrl}/api/themes/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        throw await refusal(response, "The host refused to remove it");
      }
    },
  };
}
