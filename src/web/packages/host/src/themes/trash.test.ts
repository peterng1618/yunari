import { describe, expect, it } from "vitest";
import {
  moveToTrash,
  TrashRefusal,
  type TrashRoute,
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
    at = folder,
  ): readonly TrashRoute[] => {
    const plan = trashPlan(platform, at);
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

/**
 * What a refused move raises. The class is the contract `server.ts` reads: its
 * words carry the folder path, so only a typed refusal keeps them off the wire
 * (fix round 3).
 */
describe("moveToTrash", () => {
  it("refuses with a TrashRefusal, not a plain Error", async () => {
    const refused = moveToTrash(
      "/home/ada/.yunari/themes/living-room",
      // A platform `trashPlan` names but no route reaches: the cheap refusal
      // that runs no child process.
      "aix",
    );

    await expect(refused).rejects.toBeInstanceOf(TrashRefusal);
    await expect(refused).rejects.toThrow(/not implemented for aix/);
  });
});
