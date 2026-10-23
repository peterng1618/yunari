import { memberBytes, readScenePackage } from "./pkg.js";

/**
 * "Still at rest" (§4.1): a scene whose picture does not change without input.
 * Text, sound, parallax and LED content are part of a still theme; anything
 * that moves by itself is not. A keyframed property is the exception that
 * matters — it sits under `origin`, `alpha`, shader constants and even inside a
 * sound object, so the walk looks for the key anywhere in the tree rather than
 * on named properties.
 */

export interface SceneFacts {
  readonly atRest: boolean;
  readonly hasText: boolean;
}

const SCENE_MEMBER = "scene.json";
const ANIMATION_KEY = "animation";
const MODEL_KEY = "model";

type UnknownRecord = Record<string, unknown>;

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when `key` appears anywhere in the parsed tree. */
function hasKeyAnywhere(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasKeyAnywhere(item, key));
  }
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).some(
    ([name, child]) => name === key || hasKeyAnywhere(child, key),
  );
}

export function readSceneFacts(bytes: Uint8Array): SceneFacts | undefined {
  const pkg = readScenePackage(bytes);
  if (pkg === undefined) {
    return undefined;
  }

  const sceneBytes = memberBytes(pkg, SCENE_MEMBER);
  if (sceneBytes === undefined) {
    return undefined;
  }

  const scene = parseJson(sceneBytes);
  if (!isRecord(scene) || !Array.isArray(scene.objects)) {
    return undefined;
  }

  let moves = hasKeyAnywhere(scene, ANIMATION_KEY);
  let hasText = false;

  for (const object of scene.objects) {
    if (!isRecord(object)) {
      continue;
    }

    if ("particle" in object || "animationlayers" in object) {
      moves = true;
    }
    if ("text" in object) {
      hasText = true;
    }

    // A model's own member can carry keyframes the scene tree does not, and a
    // failure is never guessed away: a referenced model that cannot be read
    // means the scene cannot be classified, so it is never assumed still.
    const model = object[MODEL_KEY];
    if (typeof model === "string") {
      const modelBytes = memberBytes(pkg, model);
      const parsed =
        modelBytes === undefined ? undefined : parseJson(modelBytes);
      if (parsed === undefined) {
        return undefined;
      }
      if (hasKeyAnywhere(parsed, ANIMATION_KEY)) {
        moves = true;
      }
    }
  }

  return { atRest: !moves, hasText };
}
