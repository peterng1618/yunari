// @vitest-environment jsdom
/**
 * `<Chooser />` with no client prop: the default client the page builds for
 * itself is created once, so the read effect runs once.
 *
 * The bug this guards: a client rebuilt on every render gave the effect a new
 * dependency each pass, and its own `setData` re-ran it forever.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ count: 0 }));

const DATA = {
  default: null,
  displays: [{ id: "this-pc", label: "Host", theme: null }],
  templates: [],
  themes: [{ id: "living-room", name: "Living Room" }],
};

vi.mock("./client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client.js")>();
  return {
    ...actual,
    createChooserClient: () => ({
      read: async () => {
        reads.count += 1;
        return DATA;
      },
      choose: async () => undefined,
      remove: async () => undefined,
    }),
  };
});

import { Chooser } from "./chooser.js";

beforeAll(() => {
  // React 19 reads this global in a test environment; without it every `act`
  // warns and the render is reported as untracked.
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  reads.count = 0;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root !== undefined) {
    const current = root;
    await act(async () => current.unmount());
  }
  root = undefined;
  container?.remove();
  container = undefined;
});

it("reads the host once when it builds its own client", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(<Chooser />);
  });

  expect(reads.count).toBe(1);
});
