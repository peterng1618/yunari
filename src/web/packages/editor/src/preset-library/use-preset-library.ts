import { useSyncExternalStore } from "react";
import { type PresetLibrary, presetLibrary } from "./index.js";

export function usePresetLibrary(): PresetLibrary {
  return useSyncExternalStore(
    presetLibrary.subscribe,
    presetLibrary.getSnapshot,
    presetLibrary.getSnapshot,
  );
}
