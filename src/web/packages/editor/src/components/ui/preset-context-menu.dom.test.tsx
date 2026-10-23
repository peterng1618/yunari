// @vitest-environment jsdom
/**
 * The preset library's delete menu: a controlled `ContextMenu.Root` anchored to
 * a pointer rect, with no `Trigger` of its own — the shape
 * `editor-shell/canvas-context-menu.tsx` uses.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { uiCopy } from "../../ui-copy.js";
import {
  PresetContextMenu,
  type PresetMenuTarget,
} from "./preset-context-menu.js";

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as never;
Element.prototype.getAnimations ??= (): never[] => [];
window.PointerEvent ??= MouseEvent as never;
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  const matches = Element.prototype.matches;
  Element.prototype.matches = Object.assign(function (
    this: Element,
    selector: string,
  ): boolean {
    if (selector === ":modal" || selector === ":popover-open") return false;
    return matches.call(this, selector);
  }, matches);
});

afterEach(() => {
  document.body.replaceChildren();
});

const TARGET: PresetMenuTarget = {
  kind: "colour",
  id: "probe-preset",
  name: "Probe",
  x: 12,
  y: 34,
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 3; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function mount(target: PresetMenuTarget | undefined): Promise<{
  readonly onClose: ReturnType<typeof vi.fn>;
  readonly onDelete: ReturnType<typeof vi.fn>;
}> {
  const host = document.createElement("div");
  document.body.append(host);
  const onClose = vi.fn();
  const onDelete = vi.fn();
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <PresetContextMenu
        target={target}
        onClose={onClose}
        onDelete={onDelete}
      />,
    );
  });
  await flush();
  return { onClose, onDelete };
}

it("renders one destructive delete row when given a target, and calls onDelete with it", async () => {
  const { onDelete } = await mount(TARGET);

  const item = document.body.querySelector<HTMLElement>(
    '[data-testid="preset-menu-delete"]',
  );
  if (item === null) throw new Error("The menu rendered no delete row.");
  expect(item.getAttribute("role")).toBe("menuitem");
  expect(item.textContent?.trim()).toBe(uiCopy.panels.presetDelete);

  await act(async () => {
    item.click();
  });

  expect(onDelete).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledWith(TARGET);
});

it("renders nothing without a target", async () => {
  await mount(undefined);

  expect(
    document.body.querySelector('[data-testid="preset-menu-delete"]'),
  ).toBeNull();
});
