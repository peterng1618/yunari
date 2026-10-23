import { useSyncExternalStore } from "react";
import { presetLibrary, type PresetLibrary } from "./index.js";

export function usePresetLibrary(): PresetLibrary {
  return useSyncExternalStore(
    presetLibrary.subscribe,
    presetLibrary.getSnapshot,
    presetLibrary.getSnapshot,
  );
}
