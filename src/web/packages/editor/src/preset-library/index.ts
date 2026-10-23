import { formatColor, parseColor } from "@yunari/renderer-core";
import {
  DEFAULT_COLOUR_PRESETS,
  DEFAULT_GRADIENT_PRESETS,
} from "./defaults.js";

/**
 * The editor-local colour and gradient preset library. It is not theme data and
 * not part of document undo: the asset finder's palettes-and-gradients surface
 * calls `addColours`/`addGradient`, the picker and the gradient editor read the
 * snapshot, and deletion is the surfaces' own context menu.
 */

export interface ColourPreset {
  readonly id: string;
  readonly name: string;
  readonly value: string;
}

export interface GradientPreset {
  readonly id: string;
  readonly name: string;
  readonly angle: number;
  readonly stops: readonly {
    readonly offset: number;
    readonly color: string;
  }[];
}

export interface PresetLibrary {
  readonly colours: readonly ColourPreset[];
  readonly gradients: readonly GradientPreset[];
}

export interface PresetLibraryStore {
  getSnapshot(): PresetLibrary;
  subscribe(listener: () => void): () => void;
  addColours(
    entries: readonly { readonly name: string; readonly value: string }[],
  ): { readonly added: number; readonly library: PresetLibrary };
  addGradient(entry: {
    readonly name: string;
    readonly angle: number;
    readonly stops: readonly {
      readonly offset: number;
      readonly color: string;
    }[];
  }): { readonly added: boolean; readonly library: PresetLibrary };
  deletePreset(kind: "colour" | "gradient", id: string): void;
  reload(): void;
}

const STORAGE_KEY = "yunari.editor.presets";
const VERSION = 1;

/** Seeds are normalised once; their authored `rgb()` strings become stored hex. */
const SEEDED: PresetLibrary = {
  colours: DEFAULT_COLOUR_PRESETS.map(normaliseColour).filter(
    (preset): preset is ColourPreset => preset !== undefined,
  ),
  gradients: DEFAULT_GRADIENT_PRESETS.map(normaliseGradient).filter(
    (preset): preset is GradientPreset => preset !== undefined,
  ),
};

export function createPresetLibrary(
  storage: Storage | undefined,
): PresetLibraryStore {
  let library = read(storage);
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const publish = (next: PresetLibrary): void => {
    library = next;
    write(storage, next);
    notify();
  };

  const reload = (): void => {
    library = read(storage);
    notify();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_KEY) reload();
    });
  }

  return {
    getSnapshot: () => library,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    addColours: (entries) => {
      const colours = [...library.colours];
      const seen = new Set(colours.map((preset) => preset.value));
      let added = 0;

      for (const entry of entries) {
        const rgba = parseColor(entry.value);
        if (rgba === undefined) continue;
        const value = formatColor(rgba);
        if (seen.has(value)) continue;

        seen.add(value);
        colours.push({ id: crypto.randomUUID(), name: entry.name, value });
        added++;
      }

      if (added > 0) publish({ ...library, colours });
      return { added, library };
    },
    addGradient: (entry) => {
      const gradient = normaliseGradient({ ...entry, id: crypto.randomUUID() });
      if (gradient === undefined) return { added: false, library };

      const key = gradientKey(gradient);
      if (library.gradients.some((preset) => gradientKey(preset) === key)) {
        return { added: false, library };
      }

      publish({ ...library, gradients: [...library.gradients, gradient] });
      return { added: true, library };
    },
    deletePreset: (kind, id) => {
      if (kind === "colour") {
        const colours = library.colours.filter((preset) => preset.id !== id);
        if (colours.length !== library.colours.length) {
          publish({ ...library, colours });
        }
        return;
      }

      const gradients = library.gradients.filter((preset) => preset.id !== id);
      if (gradients.length !== library.gradients.length) {
        publish({ ...library, gradients });
      }
    },
    reload,
  };
}

/** The editor's own library. Storage is optional so a host that refuses it still renders. */
export const presetLibrary = createPresetLibrary(browserStorage());

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function read(storage: Storage | undefined): PresetLibrary {
  if (storage === undefined) return SEEDED;

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return SEEDED;
  }
  if (raw === null) return SEEDED;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return SEEDED;
  }
  if (!isRecord(payload) || payload.version !== VERSION) return SEEDED;
  if (!Array.isArray(payload.colours) || !Array.isArray(payload.gradients)) {
    return SEEDED;
  }

  // A malformed entry is dropped, not replaced by a seed: the key's presence
  // says the author owns this list.
  return {
    colours: payload.colours.flatMap((entry) => {
      const colour = normaliseColour(entry);
      return colour === undefined ? [] : [colour];
    }),
    gradients: payload.gradients.flatMap((entry) => {
      const gradient = normaliseGradient(entry);
      return gradient === undefined ? [] : [gradient];
    }),
  };
}

function write(storage: Storage | undefined, library: PresetLibrary): void {
  if (storage === undefined) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: VERSION,
        colours: library.colours,
        gradients: library.gradients,
      }),
    );
  } catch {
    // A refused write keeps the in-memory change for the session.
  }
}

function normaliseColour(entry: unknown): ColourPreset | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry.id !== "string" || entry.id === "") return undefined;
  if (typeof entry.name !== "string" || entry.name === "") return undefined;
  if (typeof entry.value !== "string") return undefined;

  const rgba = parseColor(entry.value);
  if (rgba === undefined) return undefined;

  return { id: entry.id, name: entry.name, value: formatColor(rgba) };
}

function normaliseGradient(entry: unknown): GradientPreset | undefined {
  if (!isRecord(entry)) return undefined;
  if (typeof entry.id !== "string" || entry.id === "") return undefined;
  if (typeof entry.name !== "string" || entry.name === "") return undefined;
  if (typeof entry.angle !== "number" || !Number.isFinite(entry.angle)) {
    return undefined;
  }
  if (!Array.isArray(entry.stops) || entry.stops.length < 2) return undefined;

  const stops: { offset: number; color: string }[] = [];
  for (const stop of entry.stops) {
    if (!isRecord(stop)) return undefined;
    if (
      typeof stop.offset !== "number" ||
      !Number.isFinite(stop.offset) ||
      stop.offset < 0 ||
      stop.offset > 1
    ) {
      return undefined;
    }
    if (typeof stop.color !== "string") return undefined;

    const rgba = parseColor(stop.color);
    if (rgba === undefined) return undefined;
    stops.push({ offset: stop.offset, color: formatColor(rgba) });
  }

  return { id: entry.id, name: entry.name, angle: entry.angle, stops };
}

function gradientKey(gradient: GradientPreset): string {
  return JSON.stringify({ angle: gradient.angle, stops: gradient.stops });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
