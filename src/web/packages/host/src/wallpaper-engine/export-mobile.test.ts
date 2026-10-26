import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLICK_HELPER,
  type PowerShellRunner,
  requestMobileExport,
} from "./export-mobile.js";

/** A runner that answers one result line after the given noise. */
function runnerOf(line: string, noise = ""): PowerShellRunner {
  return async () => ({
    timedOut: false,
    code: 0,
    stdout: `${noise}\n${line}\n`,
  });
}

describe("mobile export", () => {
  it("answers ok when the engine reached its Save dialog", async () => {
    const result = await requestMobileExport({
      title: "Full Moon [FHD]",
      runner: runnerOf('YUNARI_WE:{"ok":true}'),
    });

    expect(result).toEqual({ ok: true });
  });

  it("answers the agreement refusal by name", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: runnerOf('YUNARI_WE:{"ok":false,"reason":"agreement"}'),
    });

    expect(result).toEqual({ ok: false, reason: "agreement" });
  });

  it("answers an unknown reason as failed rather than inventing one", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: runnerOf('YUNARI_WE:{"ok":false,"reason":"gremlins"}'),
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("answers a killed run as failed", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: async () => ({ timedOut: true, code: -1, stdout: "" }),
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("answers a script that printed no result as failed", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: runnerOf("Traceback"),
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("answers a result line that is not JSON as failed", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: runnerOf("YUNARI_WE:{oops"),
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("answers a runner that threw as failed", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: async () => {
        throw new Error("no powershell");
      },
    });

    expect(result).toEqual({ ok: false, reason: "failed" });
  });

  it("takes the last result line, not an earlier one", async () => {
    const result = await requestMobileExport({
      title: "四月",
      runner: runnerOf(
        'YUNARI_WE:{"ok":false,"reason":"agreement"}',
        'YUNARI_WE:{"ok":false,"reason":"no-tile"}',
      ),
    });

    expect(result).toEqual({ ok: false, reason: "agreement" });
  });

  // A C# error is invisible to the PowerShell parser, and only surfaces when an
  // author presses the button, so the helper is compiled here.
  it.runIf(process.platform === "win32")(
    "compiles the C# click helper",
    async () => {
      const file = path.join(os.tmpdir(), `yunari-csharp-${process.pid}.cs`);
      await fs.writeFile(file, CLICK_HELPER, "utf8");
      const check = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Add-Type -TypeDefinition (Get-Content -Raw -LiteralPath '${file}')`,
        ],
        { encoding: "utf8" },
      );
      await fs.rm(file, { force: true });

      expect(check.stderr).toBe("");
      expect(check.status).toBe(0);
    },
  );

  // The script is a string and never runs in any other test; a syntax error in
  // it would only surface on an author's machine, at export time.
  it.runIf(process.platform === "win32")(
    "generates a script Windows PowerShell parses",
    async () => {
      let script = "";
      await requestMobileExport({
        title: "Bob's Scene",
        runner: async (written) => {
          script = written;
          return {
            timedOut: false,
            code: 0,
            stdout: 'YUNARI_WE:{"ok":false,"reason":"refused"}',
          };
        },
      });

      const file = path.join(os.tmpdir(), `yunari-parse-${process.pid}.ps1`);
      await fs.writeFile(file, script, "utf8");
      const check = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `[void][ScriptBlock]::Create((Get-Content -Raw -LiteralPath '${file}'))`,
        ],
        { encoding: "utf8" },
      );
      await fs.rm(file, { force: true });

      expect(check.stderr).toBe("");
      expect(check.status).toBe(0);
    },
  );

  // The Source filter is persisted in the engine's own config, so a run that
  // changed it would leave the author's library filtered after the export, and
  // the author would have to notice and undo it.
  it("never touches the engine's Source filter", async () => {
    let script = "";

    await requestMobileExport({
      title: "四月",
      runner: async (written) => {
        script = written;
        return {
          timedOut: false,
          code: 0,
          stdout: 'YUNARI_WE:{"ok":false,"reason":"refused"}',
        };
      },
    });

    expect(script).not.toContain("My Wallpapers");
    expect(script).not.toContain("Set-Local-Source");
  });

  it("quotes a title containing a single quote", async () => {
    let script = "";

    await requestMobileExport({
      title: "Bob's Scene",
      runner: async (written) => {
        script = written;
        return {
          timedOut: false,
          code: 0,
          stdout: 'YUNARI_WE:{"ok":false,"reason":"refused"}',
        };
      },
    });

    expect(script).toContain("$Title = 'Bob''s Scene'");
  });
});
