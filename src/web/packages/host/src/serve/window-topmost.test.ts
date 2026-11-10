import { describe, expect, it } from "vitest";
import {
  LIVE_WAIT_MS,
  setWindowTopmost,
  topmostScript,
} from "./window-topmost.js";

/**
 * What the native call is asked to do, and what its absence means.
 *
 * The call itself needs a Windows window, so these pin the script's facts: the
 * profile path is the identity, the style-only flags leave geometry and focus
 * alone, and "off" is the other constant rather than an absence of a call.
 */

describe("the topmost script", () => {
  it("identifies the window by the display's profile path", () => {
    const script = topmostScript("C:\\Temp\\yunari profiles\\left", true, 1000);

    // A quoted literal, so a path with a space is one argument and an
    // apostrophe in it is escaped rather than ending the string.
    expect(script).toContain("'C:\\Temp\\yunari profiles\\left'");
    expect(script).toContain(".CommandLine.Contains($yunariProfile)");
  });

  it("changes the style only, so geometry and focus stay put", () => {
    const script = topmostScript("p", true, 1000);

    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE
    expect(script).toContain("0x0002u | 0x0001u | 0x0010u");
    expect(script).toContain("SetWindowPos");
    expect(script).toContain("IsWindowVisible");
  });

  it("raises with HWND_TOPMOST and lowers with HWND_NOTOPMOST", () => {
    expect(topmostScript("p", true, 0)).toContain("Apply([int[]]@($tree), -1)");
    expect(topmostScript("p", false, 0)).toContain(
      "Apply([int[]]@($tree), -2)",
    );
  });

  it("waits no longer than the caller allowed", () => {
    expect(topmostScript("p", true, 15_000)).toContain(
      ".AddMilliseconds(15000)",
    );
  });
});

describe("raising a window", () => {
  it("is reported when the native call changed a window", async () => {
    const scripts: string[] = [];
    const applied = await setWindowTopmost("p", true, {
      platform: "win32",
      waitMs: 10,
      run: (script) => {
        scripts.push(script);
        return Promise.resolve("2");
      },
    });

    expect(applied).toBe(true);
    expect(scripts).toHaveLength(1);
  });

  it("is not reported when no window was found", async () => {
    const applied = await setWindowTopmost("p", true, {
      platform: "win32",
      waitMs: 10,
      run: () => Promise.resolve("0"),
    });

    expect(applied).toBe(false);
  });

  it("does not run a native call on another platform", async () => {
    let ran = false;
    const applied = await setWindowTopmost("p", true, {
      platform: "darwin",
      run: () => {
        ran = true;
        return Promise.resolve("1");
      },
    });

    // A reported no-op rather than a claimed success.
    expect(applied).toBe(false);
    expect(ran).toBe(false);
  });

  it("does not report success when the run failed", async () => {
    const applied = await setWindowTopmost("p", false, {
      platform: "win32",
      run: () => Promise.resolve(undefined),
    });

    expect(applied).toBe(false);
  });

  it("defaults a live toggle to the short wait", async () => {
    let waited = -1;
    await setWindowTopmost("p", true, {
      platform: "win32",
      run: (script) => {
        waited = Number(/AddMilliseconds\((\d+)\)/.exec(script)?.[1] ?? -1);
        return Promise.resolve("1");
      },
    });

    expect(waited).toBe(LIVE_WAIT_MS);
  });
});
