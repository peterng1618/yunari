import { describe, expect, it } from "vitest";
import { FOREGROUND_SCRIPT, parseForegroundLine } from "./foreground.js";
import { powershellPath, startJsonLineHelper } from "./supervisor.js";

const canRun = process.platform === "win32" && powershellPath() !== undefined;

/** One line from the real helper; a non-stop exit rejects with its reason. */
async function readOneLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    let handle: { stop(): void } | undefined;
    const timer = setTimeout(() => {
      handle?.stop();
      reject(new Error("no foreground line within 20 s"));
    }, 20_000);

    handle = startJsonLineHelper({
      id: "foreground",
      script: FOREGROUND_SCRIPT,
      onLine: (line) => {
        clearTimeout(timer);
        handle?.stop();
        resolve(line);
      },
      onExit: (reason, kind) => {
        if (kind === "stopped") return;
        clearTimeout(timer);
        reject(new Error(reason));
      },
    });
  });
}

describe.skipIf(!canRun)("foreground helper on Windows", () => {
  it("runs the script and emits a typed pid, class and window states", async () => {
    const line = await readOneLine();
    const reading = parseForegroundLine(line);
    expect(reading, line).toBeDefined();
    expect(typeof reading?.pid, line).toBe("number");
    expect(
      reading?.pid,
      `no foreground window was reported, so the window fields cannot be checked: ${line}`,
    ).not.toBe(0);

    const raw = JSON.parse(line) as Record<string, unknown>;
    expect(typeof raw["fullscreen"], line).toBe("boolean");
    expect(typeof raw["d3dFullscreen"], line).toBe("boolean");
    if (raw["class"] !== undefined) {
      expect(typeof raw["class"], line).toBe("string");
      expect(raw["class"], line).not.toBe("");
    }

    expect(typeof reading?.fullscreen, line).toBe("boolean");
    expect(typeof reading?.d3dFullscreen, line).toBe("boolean");
    if (reading?.class !== undefined) {
      expect(reading.class, line).not.toBe("");
    }
  }, 40_000);
});
