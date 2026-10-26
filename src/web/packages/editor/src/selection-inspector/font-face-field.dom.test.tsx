// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { FontFaceField } from "./font-face-field.js";
import type { FontFaceEdits } from "./view.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const edits: FontFaceEdits = {
  applyFace: async () => undefined,
  applyTrio: async () => undefined,
  listFavorites: async () => [],
  saveFavorites: async () => [],
};

let host: HTMLDivElement | undefined;

afterEach(() => {
  host?.remove();
  host = undefined;
});

/**
 * The field's whole contract: it is a button, and pressing it asks for the
 * finder that owns the catalogue.
 */
it("is a button that asks for the finder", async () => {
  const onOpenFontPicker = vi.fn();
  host = document.createElement("div");
  document.body.append(host);

  const root = createRoot(host);
  await act(async () => {
    root.render(
      <FontFaceField
        view={{ presetId: "body" }}
        edits={edits}
        onOpenFontPicker={onOpenFontPicker}
      />,
    );
  });

  const button = host.querySelector<HTMLButtonElement>(
    "[data-yunari-open-font-picker]",
  );
  expect(button?.textContent).toBe(uiCopy.assets.openFontPicker);
  await act(async () => button?.click());

  expect(onOpenFontPicker).toHaveBeenCalledTimes(1);
  root.unmount();
});
