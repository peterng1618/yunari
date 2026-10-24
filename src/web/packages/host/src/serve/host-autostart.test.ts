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

it("doubles a trailing backslash so the closing quote survives", () => {
  // CommandLineToArgvW reads the backslash before a closing quote as escaping
  // that quote; undoubled, it swallows the "--tray -n" the entry appends.
  const vbs = windowsVbs({ file: "node.exe", args: ["C:\\My Themes\\"] });
  expect(vbs).toContain('""C:\\My Themes\\\\""');
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

it("writes the VBS as UTF-16LE with a BOM, which is what WSH reads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yunari-autostart-bom-"));
  const autostart = createHostAutostart({
    platform: "win32",
    appData: root,
    systemRoot: path.join(root, "windows"),
  });
  expect(
    (
      await autostart.enable({
        file: "node.exe",
        args: ["yunari.js", "C:\\Users\\Zoë\\Yunari"],
      })
    ).ok,
  ).toBe(true);

  const file = path.join(
    root,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Yunari.vbs",
  );
  const bytes = await readFile(file);
  // WSH reads a BOM-less script as ANSI, so a non-ASCII path would be mojibake
  // and the entry would start nothing.
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xfe]);
  expect(bytes.toString("utf16le").slice(1)).toContain(
    "C:\\Users\\Zoë\\Yunari",
  );
});

it("toggles on, then off, reading the same state the menu shows", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "yunari-autostart-toggle-"),
  );
  const autostart = createHostAutostart({
    platform: "win32",
    appData: root,
    systemRoot: path.join(root, "windows"),
  });
  const command = { file: "node.exe", args: ["yunari.js"] };

  expect(autostart.state()).toBe(false);
  expect((await autostart.toggle(command)).enabled).toBe(true);
  expect(autostart.state()).toBe(true);
  expect((await autostart.toggle(command)).enabled).toBe(false);
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
  const root = await mkdtemp(
    path.join(os.tmpdir(), "yunari-autostart-legacy-"),
  );
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
    appData: root,
    systemRoot: path.join(root, "windows"),
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
  // A failed deletion writes nothing: the machine keeps the entry it had.
  const file = path.join(
    root,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "Yunari.vbs",
  );
  await expect(readFile(file, "utf8")).rejects.toThrow();
});

it("refuses to register on macOS with the pinned message", async () => {
  const autostart = createHostAutostart({ platform: "darwin" });
  const result = await autostart.enable({ file: "node", args: [] });
  expect(result.ok).toBe(false);
  expect(result.enabled).toBe(false);
  expect(result.message).toBe(
    "Yunari registers start-at-sign-in on Windows and Linux only; " +
      "this host is on darwin.",
  );
});

it("treats an empty XDG_CONFIG_HOME as unset and falls back to ~/.config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "yunari-autostart-env-"));
  const previous = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CONFIG_HOME"] = "";
  try {
    const autostart = createHostAutostart({ platform: "linux", home: root });
    expect(
      (await autostart.enable({ file: "/usr/bin/node", args: [] })).ok,
    ).toBe(true);
    expect(autostart.state()).toBe(true);
    expect(
      await readFile(
        path.join(root, ".config", "autostart", "yunari.desktop"),
        "utf8",
      ),
    ).toContain("Terminal=false");
  } finally {
    restore("XDG_CONFIG_HOME", previous);
  }
});

it("treats a whitespace APPDATA as absent, never a relative path", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "yunari-autostart-env-win-"),
  );
  const previous = process.env["APPDATA"];
  process.env["APPDATA"] = "   ";
  try {
    const autostart = createHostAutostart({
      platform: "win32",
      systemRoot: path.join(root, "windows"),
    });
    expect(autostart.state()).toBe(false);
    const result = await autostart.enable({ file: "node.exe", args: [] });
    expect(result.ok).toBe(false);
    expect(result.enabled).toBe(false);
  } finally {
    restore("APPDATA", previous);
  }
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

/** Puts an environment variable back the way the run found it. */
function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
