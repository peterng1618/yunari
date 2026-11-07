import { isLocked } from "@yunari/scene-fabric";
import type { Canvas, FabricObject } from "fabric/es";
import { IndicatorStore } from "./store.js";

const SIZE_FORMAT_EPSILON = 0.000001;

/** Minus is kept for negatives; no plus is prepended for positives. */
export function formatAngle(angle: number): string {
  let normalised = angle % 360;
  if (normalised > 180) normalised -= 360;
  if (normalised < -180) normalised += 360;
  return `${Math.round(normalised)}°`;
}

/** The epsilon forces a .5 boundary up despite floating-point error. */
function formatDimension(value: number): string {
  return Math.round(Math.abs(value) + SIZE_FORMAT_EPSILON)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function formatSize(size: {
  readonly width: number;
  readonly height: number;
}): string | undefined {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) {
    return undefined;
  }
  return `${formatDimension(size.width)} × ${formatDimension(size.height)}`;
}

export interface IndicatorManager {
  destroy(): void;
}

interface IndicatorManagerOptions {
  readonly canvas: Canvas;
  /** Where the readings go. The overlay is React's and the shell renders it,
   *  so the manager publishes; it draws no element of its own. */
  readonly store: IndicatorStore;
  readonly showRotationAngle?: boolean;
  readonly showObjectSizeOnScale?: boolean;
}

/** A transform event carries the dragged object and the pointer event. */
type TransformEvent = {
  readonly transform: { readonly target?: FabricObject };
  readonly e: MouseEvent | TouchEvent;
};

/** A pointer event that exposes a screen position, in the viewport's
 *  coordinates — which is the space the readouts are placed in. */
function resolveClientPoint(
  event: MouseEvent | TouchEvent,
): { readonly x: number; readonly y: number } | null {
  if (
    "clientX" in event &&
    typeof event.clientX === "number" &&
    "clientY" in event &&
    typeof event.clientY === "number"
  ) {
    return { x: event.clientX, y: event.clientY };
  }

  const touches = "touches" in event ? event.touches : undefined;
  const changedTouches =
    "changedTouches" in event ? event.changedTouches : undefined;
  const touch = touches?.item(0) ?? changedTouches?.item(0);

  if (!touch) return null;

  return { x: touch.clientX, y: touch.clientY };
}

export function createIndicatorManager(
  options: IndicatorManagerOptions,
): IndicatorManager {
  const { canvas, store } = options;
  const showRotationAngle = options.showRotationAngle ?? true;
  const showObjectSizeOnScale = options.showObjectSizeOnScale ?? true;

  const show = (
    kind: "angle" | "size",
    text: string,
    event: MouseEvent | TouchEvent,
  ): void => {
    const point = resolveClientPoint(event);
    if (point === null) {
      store.publish(kind, undefined);
      return;
    }
    store.publish(kind, text);
    store.place(kind, point);
  };

  const hideAngle = (): void => store.publish("angle", undefined);
  const hideSize = (): void => store.publish("size", undefined);

  const onRotating = (event: TransformEvent): void => {
    const target = event.transform.target;
    if (
      !showRotationAngle ||
      target === undefined ||
      target.lockRotation === true ||
      target.lockMovementX === true ||
      target.lockMovementY === true
    ) {
      hideAngle();
      return;
    }
    show("angle", formatAngle(target.angle ?? 0), event.e);
  };

  const onScaling = (event: TransformEvent): void => {
    const target = event.transform.target;
    if (
      !showObjectSizeOnScale ||
      target === undefined ||
      isLocked(target) ||
      (target.lockScalingX === true && target.lockScalingY === true)
    ) {
      hideSize();
      return;
    }
    const sizeLabel = formatSize({
      width: target.getScaledWidth(),
      height: target.getScaledHeight(),
    });
    if (sizeLabel === undefined) {
      hideSize();
      return;
    }
    show("size", sizeLabel, event.e);
  };

  const angleBindings = [
    ["object:rotating", onRotating],
    ["mouse:up", hideAngle],
    ["object:modified", hideAngle],
    ["selection:cleared", hideAngle],
  ] as const;

  const sizeBindings = [
    ["object:scaling", onScaling],
    ["object:resizing", onScaling],
    ["mouse:up", hideSize],
    ["object:modified", hideSize],
    ["selection:cleared", hideSize],
  ] as const;

  for (const [event, handler] of angleBindings)
    canvas.on(event as never, handler as never);
  for (const [event, handler] of sizeBindings)
    canvas.on(event as never, handler as never);

  return {
    destroy(): void {
      for (const [event, handler] of angleBindings)
        canvas.off(event as never, handler as never);
      for (const [event, handler] of sizeBindings)
        canvas.off(event as never, handler as never);
      // The store outlives this session: a reading left behind would describe a
      // gesture that is over.
      store.reset();
    },
  };
}
