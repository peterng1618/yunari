import type { Canvas } from "fabric/es";

/** Groups a diagnostic by the editor surface that raised it. */
type EditorErrorCategory =
  | "clipboard"
  | "grouping"
  | "controls"
  | "toolbar"
  | "snapping"
  | "crop"
  | "image"
  | "background-media"
  | "theme-library"
  | "paint"
  | "glass"
  /** A text object that could not be frozen into vector paths. */
  | "outline"
  /** The unsaved document the browser kept, and the boot that could not read
   *  it (`draft-store.ts`). */
  | "draft";

export interface EditorDiagnostic {
  readonly category: EditorErrorCategory;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ErrorManager {
  error(category: EditorErrorCategory, message: string, cause?: unknown): void;
  warn(category: EditorErrorCategory, message: string, cause?: unknown): void;
}

/** Fabric's typed event map does not declare Yunari's own event names. */
function emit(
  canvas: Canvas,
  event: "editor:error" | "editor:warning",
  diagnostic: EditorDiagnostic,
): void {
  canvas.fire(event as never, diagnostic as never);
}

export function createErrorManager(canvas: Canvas): ErrorManager {
  const build = (
    category: EditorErrorCategory,
    message: string,
    cause: unknown,
  ): EditorDiagnostic => ({
    category,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

  return {
    error(category, message, cause) {
      console.error(`[yunari:${category}] ${message}`, cause);
      emit(canvas, "editor:error", build(category, message, cause));
    },
    warn(category, message, cause) {
      console.warn(`[yunari:${category}] ${message}`, cause);
      emit(canvas, "editor:warning", build(category, message, cause));
    },
  };
}
