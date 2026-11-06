import type { ArtboardTransform } from "../artboard.js";
import type { ScenePlan } from "./plan.js";

/**
 * The handle a mounted scene exposes.
 *
 * It outlived `mount.ts`, the legacy DOM `ScenePlan` applier that was retired
 * with the line clamp: `scene-fabric`'s `FabricSceneHandle` extends it
 * and the player types against it, so the applier goes and the contract stays.
 * The file is its own home because no applier owns it any more.
 */
export interface SceneHandle {
  /** Renderer-owned artboard element; geometry consumers should use transform(). */
  readonly artboard: HTMLElement;
  transform(): ArtboardTransform;
  update(plan: ScenePlan): void;
  resize(): void;
  dispose(): void;
}
