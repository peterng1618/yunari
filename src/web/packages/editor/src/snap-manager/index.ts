import type { Canvas, FabricObject } from "fabric/es";
import { ActiveSelection } from "fabric/es";
import type { ErrorManager } from "../error-manager/index.js";
import { moveObjectByCanvasDelta } from "../object-plane.js";
import { getObjectExactBounds, type ObjectBounds } from "./bounds.js";
import {
  collectExcludedObjects,
  partsOf,
  shouldIgnoreObject,
} from "./excluded-objects.js";
import { renderSnappingGuides } from "./guide-renderer.js";
import {
  createMovementSnapEnvironment,
  type MovementSnapCandidateSource,
} from "./movement-snap-candidates.js";
import {
  createMovementGestureBaseline,
  createMovementGuideLines,
  type FinalMovementGeometry,
} from "./movement-snapping-resolver.js";
import { MovementSnappingRuntime } from "./movement-snapping-runtime.js";
import {
  createScaleSnappingController,
  type ScaleSnappingEvent,
} from "./scaling/scale-snapping-controller.js";
import {
  createTextWidthResizeController,
  type TextWidthResizeEvent,
} from "./scaling/text-width-resize-controller.js";
import { isSupportedActiveSelection } from "./selection-eligibility.js";
import type { GuideLine } from "./types.js";

export interface SnapManager {
  destroy(): void;
}

interface SnapManagerOptions {
  readonly canvas: Canvas;
  /** Artboard extent; replaces the fork's montage area. */
  readonly bounds: () => ObjectBounds;
  readonly errors: ErrorManager;
}

/** Alignable content, following the fork's object filter: visibility and
 * explicit exclusion decide, not lock. Locking prevents moving an object, not
 * aligning to it. */
function isSnapTarget(
  object: FabricObject,
  excluded: Set<FabricObject>,
): boolean {
  return !shouldIgnoreObject({ object, excluded });
}

/** Builds one candidate source from an eligible neighbour object. */
function toSnapSource(
  object: FabricObject,
  index: number,
  excluded: Set<FabricObject>,
  bounds: ObjectBounds | null,
): MovementSnapCandidateSource | undefined {
  if (!isSnapTarget(object, excluded)) return undefined;
  if (bounds === null) return undefined;
  return {
    id: object.get("id") ?? `snap-source-${index}`,
    bounds,
    useForSpacing: true,
  };
}

/** Tolerance for "this box is the box already offered above it", which absorbs
 * the float drift between a group's laid-out box and its child's own. */
const SNAP_SOURCE_BOUNDS_EPSILON = 0.000000001;

/** Whether a nested object repeats every line its enclosing box already offers.
 *
 * **This fires when the enclosing box equals the child's, which depends on
 * whether the group was fitted or declared.** Fabric fits a group around its
 * children, so `new Group([sole])` takes the child's own box — stroke included,
 * `strokeWidth` 1 and 81×81 on both sides — and the dedupe fires. A group that
 * *declares* a `width`/`height` keeps that box, while a child's
 * `getBoundingRect()` still includes its own stroke, so the two differ and the
 * part *is* offered. Measured on the nested fixture's card: the group's declared
 * box is its 400×200, its `left-card-part` child is 61×81 at 360…421, and the
 * starter's card is the same story with a 2-unit stroke.
 *
 * The narrow scope is a standing gap rather than a settled question, and it is
 * shape-dependent: a stroke-carrying part repeats its group's line exactly on
 * `snapping.spec.ts`'s own `source("group", …)` shape, as a shared left/top edge
 * on the starter's cards, and not at all on the nested fixture's (`vg-526`).
 * Widening the epsilon to absorb the stroke would be the other choice and is not
 * this task's. */
function repeatsEnclosingBounds(
  bounds: ObjectBounds,
  enclosing: ObjectBounds | null,
): boolean {
  if (enclosing === null) return false;
  return (
    Math.max(
      Math.abs(bounds.left - enclosing.left),
      Math.abs(bounds.right - enclosing.right),
      Math.abs(bounds.top - enclosing.top),
      Math.abs(bounds.bottom - enclosing.bottom),
    ) <= SNAP_SOURCE_BOUNDS_EPSILON
  );
}

/**
 * Picks the browser event as the step marker, exactly as the fork does. Fabric
 * reuses one marker per native pointer event, so the runtime can tell a repeat
 * of the same event (a target and its selection both moving) from a new step.
 */
export function readMovementMarker({
  event,
}: {
  event: { readonly e?: unknown } | undefined;
}): object {
  const browserEvent = event?.e;
  if (
    (typeof browserEvent === "object" && browserEvent !== null) ||
    typeof browserEvent === "function"
  ) {
    return browserEvent;
  }
  return event ?? {};
}

/** Ctrl escapes snapping on both paths; Shift constrains a resize. One reader
 * for both so the scale path cannot read Shift from a helper that omits it. */
export function readMovementModifiers({
  event,
}: {
  event: { readonly e?: unknown } | undefined;
}): { readonly ctrlKey: boolean; readonly shiftKey: boolean } {
  const browserEvent = event?.e;
  const isBrowserEvent =
    typeof browserEvent === "object" && browserEvent !== null;
  return {
    ctrlKey:
      isBrowserEvent &&
      (browserEvent as { ctrlKey?: unknown }).ctrlKey === true,
    shiftKey:
      isBrowserEvent &&
      (browserEvent as { shiftKey?: unknown }).shiftKey === true,
  };
}

/**
 * Snap sources for one gesture: every eligible neighbour, then the artboard as
 * a domain-boundary line set. Shared by the movement and resize paths so both
 * see the same candidates.
 *
 * Candidates come from the whole scene, not its roots (`vg-123`): roots-only
 * was every object while the scene was flat, and once cards are groups a part
 * inside one is content an author can align against now that selection can
 * enter a group. A nested part that adds no line of its own — a group wrapped
 * around a single part — is not offered a second time; see
 * `repeatsEnclosingBounds` for how rarely that actually holds.
 */
export function collectSnapSources({
  canvas,
  bounds,
  activeObject,
}: {
  canvas: Canvas;
  bounds: () => ObjectBounds;
  activeObject: FabricObject;
}): MovementSnapCandidateSource[] {
  const excluded = collectExcludedObjects({ activeObject });
  const sources: MovementSnapCandidateSource[] = [];
  let index = 0;

  /** Offers one object and then its own parts, in scene order. `enclosing` is
   * the nearest box already offered above it, so a part repeating that box is
   * skipped rather than doubling every one of its lines. */
  const visit = (
    object: FabricObject,
    enclosing: ObjectBounds | null,
  ): void => {
    const objectBounds = getObjectExactBounds({ object });
    const source = toSnapSource(object, index, excluded, objectBounds);
    index += 1;
    if (
      source !== undefined &&
      !repeatsEnclosingBounds(source.bounds, enclosing)
    )
      sources.push(source);
    for (const part of partsOf(object)) visit(part, objectBounds);
  };

  canvas.forEachObject((object) => visit(object, null));
  const artboard = bounds();
  sources.push({
    id: "artboard",
    bounds: {
      ...artboard,
      centerX: artboard.left + (artboard.right - artboard.left) / 2,
      centerY: artboard.top + (artboard.bottom - artboard.top) / 2,
    },
    edgeCategory: "domain-boundary",
    useForSpacing: false,
  });

  return sources;
}

export function createSnapManager(options: SnapManagerOptions): SnapManager {
  const { canvas, bounds, errors } = options;
  const runtime = new MovementSnappingRuntime();
  const scaleController = createScaleSnappingController({ canvas, bounds });
  // A Textbox's `ml`/`mr` are Fabric `changeWidth` controls, so that gesture
  // arrives as `object:resizing` and never reaches the scale path's binding.
  const textWidthController = createTextWidthResizeController({
    canvas,
    bounds,
  });

  let target: FabricObject | undefined;
  /** The dragged object's exact start bounds, cached at gesture start. */
  let targetStartBounds: ObjectBounds | undefined;
  /** Guides from the last verified step, painted on after:render. */
  let lastGuides: readonly GuideLine[] = [];
  let lastSpacingGuides: readonly unknown[] = [];
  let gestureActive = false;
  /** The drag that owns the gesture; a second object's move must not join it. */
  let gestureTarget: FabricObject | undefined;

  const stopGesture = (): void => {
    if (gestureActive) runtime.finishSession();
    // Idempotent: both return without a session when the gesture was a resize.
    scaleController.finishGesture();
    textWidthController.finishGesture();
    gestureActive = false;
    target = undefined;
    targetStartBounds = undefined;
    gestureTarget = undefined;
    lastGuides = [];
    lastSpacingGuides = [];
    canvas.requestRenderAll();
  };

  // The resize path owns its own session: `mouse:down` never starts it, because
  // Fabric fires `object:scaling` for a handle grab the movement path never saw.
  const scaleRunStep = (event: { readonly e?: unknown } | undefined): void => {
    lastGuides = scaleController.runStep(
      event as ScaleSnappingEvent | undefined,
    );
    if (lastGuides.length > 0) canvas.requestRenderAll();
  };

  const textWidthRunStep = (
    event: { readonly e?: unknown } | undefined,
  ): void => {
    lastGuides = textWidthController.runStep(
      event as TextWidthResizeEvent | undefined,
    );
    if (lastGuides.length > 0) canvas.requestRenderAll();
  };

  const startGesture = (event: { readonly e?: unknown } | undefined): void => {
    // Fabric has already built the transform for this pointerdown; the resize
    // path needs that start geometry, which `object:scaling` no longer carries.
    scaleController.startGesture(event as ScaleSnappingEvent | undefined);
    textWidthController.startGesture(event as TextWidthResizeEvent | undefined);
    const active = canvas.getActiveObject();
    if (active === undefined) return;
    // A composed selection the fork declined must not join a gesture: a scaled
    // text selection would let the movement path be reinterpreted as an
    // unfinished scale.
    if (
      active instanceof ActiveSelection &&
      !isSupportedActiveSelection({ selection: active })
    )
      return;
    const startBounds = getObjectExactBounds({ object: active });
    if (startBounds === null) return;

    const sources = collectSnapSources({
      canvas,
      bounds,
      activeObject: active,
    });

    const startPosition = active.getXY();
    runtime.startSession({
      baseline: createMovementGestureBaseline({
        bounds: startBounds,
        // The canvas plane, matching `bounds`: a group member's own `left`/`top`
        // are group-local, so using them here would make the plan's delta a
        // different vector from the world bounds' and the raw intent would be
        // refused as "not a translation of the gesture baseline".
        position: {
          left: startPosition.x,
          top: startPosition.y,
        },
        environment: createMovementSnapEnvironment({
          sources,
          zoom: canvas.getZoom() || 1,
        }),
      }),
    });
    target = active;
    targetStartBounds = startBounds;
    gestureTarget = active;
    gestureActive = true;
  };

  const runStep = (event: { readonly e?: unknown } | undefined): void => {
    const moved = target;
    const startBounds = targetStartBounds;
    if (
      !gestureActive ||
      moved === undefined ||
      startBounds === undefined ||
      moved !== gestureTarget
    )
      return;

    // One marker per native pointer event, as in the fork: Fabric delivers
    // several object:moving events for one pointer move (target plus any
    // active selection), and the runtime's duplicate detection is keyed on
    // marker identity. The browser event is a fresh object per pointermove,
    // so each real movement step re-plans; a repeat of the same event is
    // recognised as a duplicate instead of being re-applied.
    const marker = readMovementMarker({ event });

    const rawBounds = getObjectExactBounds({ object: moved });
    if (rawBounds === null) return;
    // Fabric has already applied the drag to the object; the raw intent is the
    // gesture-start geometry translated by the drag's current offset.
    const offsetLeft = rawBounds.left - startBounds.left;
    const offsetTop = rawBounds.top - startBounds.top;
    const currentPosition = moved.getXY();

    const step = runtime.resolveMovementPlan({
      marker,
      intent: {
        bounds: {
          ...startBounds,
          left: startBounds.left + offsetLeft,
          right: startBounds.right + offsetLeft,
          centerX: startBounds.centerX + offsetLeft,
          top: startBounds.top + offsetTop,
          bottom: startBounds.bottom + offsetTop,
          centerY: startBounds.centerY + offsetTop,
        },
        // Canvas coordinates, like `bounds`; `left`/`top` are group-local.
        position: {
          left: currentPosition.x,
          top: currentPosition.y,
        },
        axes: {
          x: moved.lockMovementX !== true,
          y: moved.lockMovementY !== true,
        },
        modifiers: readMovementModifiers({ event }),
      },
    });
    if (step.kind !== "planned") return;

    const { plan } = step;
    const deltaX = plan.nextPosition.left - currentPosition.x;
    const deltaY = plan.nextPosition.top - currentPosition.y;

    // A zero-delta plan is still a plan: the object already sits at
    // nextPosition, so the current bounds are the final geometry and the
    // pending token must be verified — leaving it pending would wedge every
    // later step of the gesture.
    if (deltaX !== 0 || deltaY !== 0) {
      // The plan is in canvas coordinates; `left`/`top` are the parent's
      // plane, so a group member's delta is converted rather than written.
      moveObjectByCanvasDelta({
        object: moved,
        delta: { x: deltaX, y: deltaY },
      });
    }
    const finalBounds =
      deltaX === 0 && deltaY === 0
        ? rawBounds
        : getObjectExactBounds({ object: moved });
    if (finalBounds !== null) {
      const verification = runtime.verifyMovementPlan({
        token: step.token,
        finalGeometry: {
          bounds: finalBounds,
          position: {
            left: plan.nextPosition.left,
            top: plan.nextPosition.top,
          },
        } satisfies FinalMovementGeometry,
      });
      lastGuides = createMovementGuideLines({ guides: verification.guides });
      lastSpacingGuides = verification.spacingGuides;
    }
    if (deltaX !== 0 || deltaY !== 0) canvas.requestRenderAll();
  };

  const beforeRender = (): void => {
    const context = canvas.contextTop;
    context?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const afterRender = (): void => {
    if (lastGuides.length === 0 && lastSpacingGuides.length === 0) return;
    renderSnappingGuides({
      canvas,
      guideBounds: bounds(),
      guides: lastGuides,
      spacingGuides: lastSpacingGuides as never,
    });
  };

  const bindings = [
    ["mouse:down", startGesture],
    ["object:moving", runStep],
    ["object:scaling", scaleRunStep],
    ["object:resizing", textWidthRunStep],
    ["mouse:up", stopGesture],
    ["selection:created", stopGesture],
    ["selection:updated", stopGesture],
    ["selection:cleared", stopGesture],
    ["object:removed", stopGesture],
    ["before:render", beforeRender],
    ["after:render", afterRender],
  ] as const;

  const guard = (step: (event?: never) => void): ((event?: never) => void) => {
    return (event?: never) => {
      try {
        step(event);
      } catch (error) {
        errors.error("snapping", "A snapping step failed.", error);
      }
    };
  };

  const windowCancel = (): void => {
    try {
      stopGesture();
    } catch (error) {
      errors.error("snapping", "Cancelling a snapping gesture failed.", error);
    }
  };

  // A throw inside object:moving would otherwise leave a drag wedged.
  // One guarded handler per binding so off() removes the bound function.
  const guarded = bindings.map(([event, step]) => {
    const handler = guard(step);
    return [event, handler] as const;
  });

  for (const [event, handler] of guarded)
    canvas.on(event as never, handler as never);
  window.addEventListener("pointercancel", windowCancel);
  window.addEventListener("touchcancel", windowCancel);
  window.addEventListener("blur", windowCancel);

  return {
    destroy(): void {
      for (const [event, handler] of guarded)
        canvas.off(event as never, handler as never);
      window.removeEventListener("pointercancel", windowCancel);
      window.removeEventListener("touchcancel", windowCancel);
      window.removeEventListener("blur", windowCancel);
      // Always: a resize session is owned by the scale controller, not by
      // `gestureActive`, and finishGesture is idempotent when none is active.
      stopGesture();
    },
  };
}
