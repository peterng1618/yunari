import { describe, expect, it } from "vitest";
import {
  runTrashRoutes,
  type TrashRoute,
  type TrashTarget,
  trashPlan,
} from "./trash.js";

/**
 * What each platform's trash is reached by, without running any of them. The
 * decision note (`docs/decisions/0021`) records why there is no dependency and
 * no native binary; these are the claims that note makes, as assertions.
 */
describe("trashPlan", () => {
  const folder = "/home/ada/.yunari/themes/living-room";
  const routesOf = (
    platform: NodeJS.Platform,
    at: string | readonly string[] = folder,
    kind?: TrashTarget,
  ): readonly TrashRoute[] => {
    const plan = trashPlan(platform, at, kind);
    if (!plan.ok) throw new Error(`${platform} has no trash route`);
    return plan.routes;
  };

  it("reaches the Windows recycle bin through the PowerShell VisualBasic runtime", () => {
    // `RecycleBinOption` does not exist — the enum is `RecycleOption` — and the
    // wrong name fails at run time, on the author's folder, rather than at load.
    const [route] = routesOf("win32");
    expect(route?.command).toBe("powershell.exe");
    const script = route?.args.at(-1) ?? "";
    expect(script).toContain("Add-Type -AssemblyName Microsoft.VisualBasic");
    expect(script).toContain("RecycleOption]::SendToRecycleBin");
    expect(script).toContain(folder);

    // Two statements, and ONE separator between them. A `;` inside the argument
    // list makes PowerShell read the next fragment as a statement of its own
    // and fail to parse the whole command, so the Windows route never ran at
    // all — three `toContain` assertions all passed while the command was
    // unparseable, because none of them looked at where the semicolons were.
    const statements = script.split(";");
    expect(statements).toHaveLength(2);
    expect(statements[1]).toContain("DeleteDirectory(");
    expect(statements[1]).toContain(folder);
  });

  it("builds a file trash route per platform", () => {
    // The folder route's `DeleteDirectory` is wrong for a file: the VisualBasic
    // call names the kind it takes, and the other two platforms already take
    // either. This is the one platform fact a file adds.
    const [windows] = routesOf("win32", "C:/yunari/inter-400.woff2", "file");
    const script = windows?.args.at(-1) ?? "";
    expect(script).toContain("DeleteFile(");
    expect(script).not.toContain("DeleteDirectory(");

    const [mac] = routesOf("darwin", "/home/ada/inter-400.woff2", "file");
    expect(mac?.args).toContain(
      'tell application "Finder" to delete POSIX file "/home/ada/inter-400.woff2"',
    );

    const linuxRoutes = routesOf("linux", "/home/ada/inter-400.woff2", "file");
    expect(linuxRoutes.map((route) => route.command)).toEqual([
      "gio",
      "trash-put",
    ]);
  });

  it("sends a list of files as one route per platform", () => {
    // One invocation for the whole list: a refusal on the second file must not
    // leave the first already moved, with the caller never pruning its own
    // declarations.
    const files = ["/home/ada/a.woff2", "/home/ada/b.woff2"];
    const [windows] = routesOf("win32", files, "file");
    const script = windows?.args.at(-1) ?? "";
    expect(script.match(/DeleteFile\(/g)).toHaveLength(2);
    expect(script).toContain("/home/ada/a.woff2");
    expect(script).toContain("/home/ada/b.woff2");
    // The one `Add-Type` statement, then one statement per file.
    expect(script.split(";")).toHaveLength(3);

    const [mac] = routesOf("darwin", files, "file");
    expect(mac?.args.at(-1)).toBe(
      'tell application "Finder" to delete {POSIX file "/home/ada/a.woff2", POSIX file "/home/ada/b.woff2"}',
    );

    const linuxRoutes = routesOf("linux", files, "file");
    expect(linuxRoutes[0]?.args).toEqual(["trash", ...files]);
    expect(linuxRoutes[1]?.args).toEqual(["--", ...files]);
  });

  it("writes a long Windows list to a file instead of the command line", () => {
    // 200 paths, past the store's own 128-asset cap for good measure. Inline
    // they measured ~55,000 characters against Windows' 32,767 limit, so
    // `execFile` would throw `spawn ENAMETOOLONG` and a full theme's cleanup
    // would fail. The paths travel one per line in a file the runner writes.
    const files = Array.from(
      { length: 200 },
      (_unused, index) => `C:/yunari/assets/file-${index}.woff2`,
    );
    const [route] = routesOf("win32", files, "file");
    const script = route?.args.at(-1) ?? "";

    for (const arg of route?.args ?? []) {
      expect(arg.length).toBeLessThan(4_000);
    }
    expect(script).toContain("Get-Content -LiteralPath");
    expect(script).toContain(route?.listPath ?? "\u0000");
    for (const file of files) expect(script).not.toContain(file);
    expect(route?.list).toEqual(files);
  });

  it("tries the next route when a command is not installed", async () => {
    // The runner is injected because "is gio installed" is not something a test
    // can arrange. Only `ENOENT` may advance: a plain refusal must stop here.
    const calls: string[] = [];
    const routes: readonly TrashRoute[] = [
      { command: "gio", args: ["trash", "/a"] },
      { command: "trash-put", args: ["--", "/a"] },
    ];

    await runTrashRoutes(routes, "file", async (route) => {
      calls.push(route.command);
      if (route.command === "gio") {
        throw Object.assign(new Error("spawn gio ENOENT"), { code: "ENOENT" });
      }
    });

    expect(calls).toEqual(["gio", "trash-put"]);
  });

  it("keeps the missing-command code through the real runner", async () => {
    // The Linux fallback was dead because `run()` rebuilt the rejection as a
    // plain Error and lost `code`; then every missing command looked like a
    // refusal. This is the real executor, so a dropped code reddens it.
    const routes: readonly TrashRoute[] = [
      { command: "yunari-definitely-not-a-trash-command", args: [] },
      { command: process.execPath, args: ["-e", ""] },
    ];

    await expect(runTrashRoutes(routes, "file")).resolves.toBeUndefined();
  });

  it("escapes an apostrophe in the path for PowerShell's single-quoted literal", () => {
    // Doubling is how a PowerShell single-quoted string carries a quote. Left
    // as one, the literal ends early and the path the operator sees is not the
    // path the author named.
    const [route] = routesOf("win32", "C:/them'es/kit'chen");
    expect(route?.args.at(-1)).toContain("'C:/them''es/kit''chen'");
  });

  it("reaches the macOS trash through Finder, which is what gives Put Back", () => {
    const [route] = routesOf("darwin");
    expect(route?.command).toBe("osascript");
    expect(route?.args).toContain(
      `tell application "Finder" to delete POSIX file "${folder}"`,
    );
  });

  it("escapes a quote in the path for the AppleScript string", () => {
    const [route] = routesOf("darwin", '/home/ada/kit"chen');
    expect(route?.args.at(-1)).toBe(
      'tell application "Finder" to delete POSIX file "/home/ada/kit\\"chen"',
    );
  });

  it("tries gio then trash-put on Linux, in that order", () => {
    // Both implement the freedesktop.org specification. `gio` is the desktop's
    // own; `trash-put` is the only route on a machine with no desktop session.
    const routes = routesOf("linux");
    expect(routes.map((route) => route.command)).toEqual(["gio", "trash-put"]);
    expect(routes[0]?.args).toEqual(["trash", folder]);
    // `--` so a `--themes-dir` beginning with a dash is a path, not an option.
    expect(routes[1]?.args).toEqual(["--", folder]);
  });

  it("names the platform it cannot serve instead of falling back to a delete", () => {
    const plan = trashPlan("aix", folder);
    expect(plan.ok).toBe(false);
    if (plan.ok) throw new Error("aix unexpectedly has a trash route");
    // The message is the author's: it has to say the theme is still there.
    expect(plan.reason).toContain("aix");
    expect(plan.reason).toContain("left alone");
  });
});
