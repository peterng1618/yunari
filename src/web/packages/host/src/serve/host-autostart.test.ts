import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  createHostAutostart,
  hostEntry,
  linuxDesktopEntry,
  windowsVbs,
} from "./host-autostart.js";

it("starts the same host with --tray -n", () => {
  const entry = hostEntry(["--port", "5227"], "C:\\app\\dist");
  expect(entry.file).toBe(process.execPath);
  expect(entry.args.slice(-2)).toEqual(["--tray", "-n"]);
  expect(entry.args[0]).toContain("yunari.js");
});

it("writes a hidden VBS and quotes a path with spaces", () => {
  const vbs = windowsVbs({
    file: "C:\\Program Files\\node.exe",
    args: ["C:\\Yunari App\\bin\\yunari.js", "--tray"],
  });
  expect(vbs).toContain('WshShell.Run """C:\\Program Files\\node.exe""');
  expect(vbs).toContain("0, False");
});

it("writes a Linux desktop entry with Terminal=false", () => {
  const entry = linuxDesktopEntry({
    file: "/usr/bin/node",
    args: ["/home/a b/yunari.js", "--tray"],
  });
  expect(entry).toContain("Terminal=false");
  expect(entry).toContain('"/home/a b/yunari.js"');
});

it("refuses a path containing a quote instead of writing a broken VBS", () => {
  expect(() => windowsVbs({ file: 'C:\\a"b\\node.exe', args: [] })).toThrow(
    /quote/,
  );
});

it("reads and toggles a Windows entry under an injected app folder", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yunari-autostart-"));
  const autostart = createHostAutostart({
    platform: "win32",
    appData: root,
    systemRoot: path.join(root, "windows"),
  });
  expect(autostart.state()).toBe(false);
  expect(
    (
      await autostart.enable({
        file: "node.exe",
        args: ["yunari.js", "--tray"],
      })
    ).ok,
  ).toBe(true);
  expect(autostart.state()).toBe(true);
  expect((await autostart.disable()).enabled).toBe(false);
  expect(autostart.state()).toBe(false);
});

it("reads a legacy task as enabled", () => {
  const autostart = createHostAutostart({
    platform: "win32",
    appData: "C:\\Users\\a\\AppData\\Roaming",
    systemRoot: "C:\\Windows",
    exists: (file) => file.endsWith("YunariHost"),
  });
  expect(autostart.state()).toBe(true);
});

it("removes the legacy task before enabling and reports a refused deletion", async () => {
  const run = vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: Error) => void,
    ) => {
      callback(new Error("access denied"));
    },
  );
  const autostart = createHostAutostart({
    platform: "win32",
    appData: "C:\\Users\\a\\AppData\\Roaming",
    systemRoot: "C:\\Windows",
    exists: (file) => file.endsWith("YunariHost"),
    execFileImpl: run,
  });
  const result = await autostart.enable({
    file: "node.exe",
    args: ["yunari.js"],
  });
  expect(result.ok).toBe(false);
  expect(result.message).toContain("access denied");
  expect(run).toHaveBeenCalledWith(
    "schtasks",
    expect.arrayContaining(["/Delete", "/TN", "YunariHost", "/F"]),
    expect.anything(),
    expect.any(Function),
  );
});

it("writes, reads and removes a Linux desktop entry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yunari-autostart-linux-"));
  const configHome = path.join(root, "config");
  const autostart = createHostAutostart({
    platform: "linux",
    home: root,
    configHome,
  });
  expect(autostart.state()).toBe(false);
  expect(
    (
      await autostart.enable({
        file: "/usr/bin/node",
        args: ["/home/a b/yunari.js", "--tray"],
      })
    ).ok,
  ).toBe(true);
  expect(autostart.state()).toBe(true);
  const file = path.join(configHome, "autostart", "yunari.desktop");
  expect(await readFile(file, "utf8")).toContain(
    'Exec="/usr/bin/node" "/home/a b/yunari.js" "--tray"',
  );
  expect((await autostart.disable()).enabled).toBe(false);
  expect(autostart.state()).toBe(false);
});
