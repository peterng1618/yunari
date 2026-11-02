// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EditorSessionOptions } from "./editor-session-options.js";
import { registerSessionShortcuts } from "./editor-session-shortcuts.js";
import type { ShortcutManager } from "./shortcut-manager/index.js";

/**
 * Escape is the one chord that unselects without a surface: a layer, then a
 * token, and a group the author had entered leaves first. The shell's own
 * integration is covered elsewhere; this pins the order, because the handlers
 * share one chord and a later branch that ran first would clear the object
 * selection a group exit still needed.
 */
function harness(options: {
  readonly active: readonly object[];
  readonly exited?: readonly object[];
  readonly tokenSelected?: boolean;
}) {
  const handlers = new Map<string, () => void>();
  const discardActiveObject = vi.fn();
  const requestRenderAll = vi.fn();
  const exitGroup = vi.fn(() => options.exited);
  const clearToken = vi.fn();
  const canvas = {
    getActiveObjects: () => options.active,
    discardActiveObject,
    requestRenderAll,
    getActiveObject: () => options.active[0],
    fire: vi.fn(),
  };
  const shortcuts = {
    register: (id: string, handler: () => void) => {
      handlers.set(id, handler);
    },
  } as unknown as ShortcutManager;
  const deps = {
    shortcuts,
    options: {
      shell: {
        editor: {
          canvas,
          historyManager: { suspend: () => () => {}, saveState: vi.fn() },
          groupingManager: { exitGroup },
        },
      },
      tokenSelection:
        options.tokenSelected === true ? { clear: clearToken } : undefined,
    } as unknown as EditorSessionOptions,
    document: {} as never,
  };

  registerSessionShortcuts(deps);
  return {
    escape: () => handlers.get("view.exit-group")?.(),
    discardActiveObject,
    requestRenderAll,
    exitGroup,
    clearToken,
  };
}

describe("Escape unselects the innermost thing", () => {
  it("leaves an entered group before touching the selection or a token", () => {
    const shell = harness({
      active: [{}],
      exited: [{}],
      tokenSelected: true,
    });
    shell.escape();
    expect(shell.exitGroup).toHaveBeenCalled();
    expect(shell.discardActiveObject).not.toHaveBeenCalled();
    expect(shell.clearToken).not.toHaveBeenCalled();
  });

  it("drops the canvas selection and the token selection together", () => {
    const shell = harness({ active: [{}], tokenSelected: true });
    shell.escape();
    expect(shell.exitGroup).toHaveBeenCalled();
    expect(shell.discardActiveObject).toHaveBeenCalledTimes(1);
    expect(shell.requestRenderAll).toHaveBeenCalled();
    expect(shell.clearToken).toHaveBeenCalledTimes(1);
  });

  it("clears a selected token when the canvas is already empty", () => {
    const shell = harness({ active: [], tokenSelected: true });
    shell.escape();
    expect(shell.discardActiveObject).not.toHaveBeenCalled();
    expect(shell.clearToken).toHaveBeenCalledTimes(1);
  });
});
