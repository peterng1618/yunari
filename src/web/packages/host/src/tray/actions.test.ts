import path from "node:path";
import { expect, it, vi } from "vitest";
import { openRequest, openTrayAction } from "./actions.js";

const CONTEXT = {
  localPlain: "http://localhost:5227",
  settingsDir: path.join("C:\\app", "settings"),
};

it("opens the folder through the directory branch, not the URL handler", () => {
  const request = openRequest("folder", CONTEXT);
  expect(request.target).toBe(path.dirname(CONTEXT.settingsDir));
  expect(request.options).toEqual({ directory: true });
  // A URL row keeps the empty options: explorer is only for the folder.
  expect(openRequest("pair", CONTEXT).options).toEqual({});
});

it("reports the opener it chose for every row", () => {
  const browser = vi.fn(() => true);
  const target = vi.fn(() => true);
  const open = { browser, target };

  expect(openTrayAction("editor", CONTEXT, open)).toEqual({
    ok: true,
    message: "Opening Theme Editor.",
  });
  expect(openTrayAction("themes", CONTEXT, open)).toEqual({
    ok: true,
    message: "Opening Theme Store.",
  });
  expect(openTrayAction("settings", CONTEXT, open)).toEqual({
    ok: true,
    message: "Opening Host Settings.",
  });
  expect(openTrayAction("pair", CONTEXT, open)).toEqual({
    ok: true,
    message: "Opening Pair display.",
  });
  expect(openTrayAction("folder", CONTEXT, open)).toEqual({
    ok: true,
    message: "Opening the Yunari folder.",
  });

  expect(browser).toHaveBeenCalledTimes(4);
  expect(target).toHaveBeenCalledWith(openRequest("folder", CONTEXT).target, {
    directory: true,
  });
});

it("reports a failed open instead of claiming success in a hidden host", () => {
  const open = { browser: () => false, target: () => false };

  expect(openTrayAction("pair", CONTEXT, open)).toEqual({
    ok: false,
    message: "Could not open Pair display.",
  });
  expect(openTrayAction("folder", CONTEXT, open)).toEqual({
    ok: false,
    message: "Could not open the Yunari folder.",
  });
});
