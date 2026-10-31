import type { FabricObject } from "fabric/es";

/** A previewed value the gesture has neither committed nor cancelled. */
export interface PendingPreview {
  readonly object: FabricObject;
  readonly fieldId: string;
  readonly value: string | number | boolean;
}

/**
 * The one preview in flight, held by the inspector that owns the write funnel.
 *
 * A slider preview writes the document and records nothing; the release
 * commits, Escape cancels, and both clear this. A gesture can end neither way —
 * the selection moves under a held press, and the field it started on is gone —
 * and the previewed value then sits in the document with no history entry. This
 * remembers the preview so a republish or a different field's edit can settle
 * it as the one edit the gesture made.
 *
 * **Settling records history for the document as it stands** rather than
 * rewriting the value: the preview already wrote it, and a value that matches
 * the last saved state records nothing (the history's fingerprint dedupe).
 *
 * One instance per inspector, not module state: two editors in one process must
 * not settle each other's gestures.
 */
export function createPendingPreview(): {
  record(
    object: FabricObject,
    fieldId: string,
    value: string | number | boolean,
  ): void;
  /**
   * Ends the gesture `fieldId` names: its preview is dropped whether it was
   * committed or cancelled.
   */
  discard(fieldId: string): void;
  /** Ends a preview belonging to another field, saying whether one was in
   *  flight: that gesture ended too, so the caller owes it one history entry. */
  settleOther(fieldId: string): boolean;
  /** Drops any preview: a history restore replaced the document it described. */
  clear(): void;
  /**
   * Ends whichever gesture is in flight and says whether one was: a republish
   * replaced the control that owned it, so the caller owes it one history entry.
   */
  settle(): boolean;
  /** The preview in flight, for tests and for the caller's own reasoning. */
  readonly current: PendingPreview | undefined;
} {
  let pending: PendingPreview | undefined;

  return {
    record(object, fieldId, value) {
      pending = { object, fieldId, value };
    },
    discard(fieldId) {
      if (pending !== undefined && pending.fieldId === fieldId) {
        pending = undefined;
      }
    },
    settleOther(fieldId) {
      if (pending === undefined || pending.fieldId === fieldId) return false;
      pending = undefined;
      return true;
    },
    clear() {
      pending = undefined;
    },
    settle() {
      if (pending === undefined) return false;
      pending = undefined;
      return true;
    },
    get current() {
      return pending;
    },
  };
}
