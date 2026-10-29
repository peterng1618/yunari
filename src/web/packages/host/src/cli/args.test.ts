import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LHM_URL } from "../providers/lhm.js";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SETTINGS_DIR,
  DEFAULT_THEMES_DIR,
  HELP_TEXT,
  isLoopbackHost,
  parseArgs,
} from "./args.js";

const VERSION = "1.2.3";

function run(...argv: string[]) {
  return parseArgs(argv, VERSION);
}

describe("parseArgs", () => {
  it("defaults to loopback, the documented port, opening a browser, and default themes dir", () => {
    expect(run()).toEqual({
      kind: "run",
      options: {
        port: DEFAULT_PORT,
        host: DEFAULT_HOST,
        hostGiven: false,
        openBrowser: true,
        tray: false,
        themesDir: DEFAULT_THEMES_DIR,
        settingsDir: DEFAULT_SETTINGS_DIR,
        lhmUrl: DEFAULT_LHM_URL,
      },
    });
  });

  it("is loopback by default, not a wildcard bind (§7)", () => {
    const result = run();

    expect(result).toMatchObject({ options: { host: "127.0.0.1" } });
    expect(isLoopbackHost(DEFAULT_HOST)).toBe(true);
  });

  it.each([
    ["--port", "8080"],
    ["-p", "8080"],
  ])("reads a port from %s", (flag, value) => {
    expect(run(flag, value)).toMatchObject({ options: { port: 8080 } });
  });

  it.each([
    ["--host", "0.0.0.0"],
    ["-H", "192.168.1.10"],
  ])("reads an address from %s", (flag, value) => {
    expect(run(flag, value)).toMatchObject({ options: { host: value } });
  });

  it("says whether the address was asked for or defaulted", () => {
    expect(run()).toMatchObject({ options: { hostGiven: false } });
    expect(run("--host", "0.0.0.0")).toMatchObject({
      options: { hostGiven: true },
    });
  });

  it("reads a themes directory from --themes-dir", () => {
    expect(run("--themes-dir", "custom-themes")).toMatchObject({
      options: { themesDir: path.resolve("custom-themes") },
    });
  });

  it("reads an LHM endpoint from --lhm-url and trims a trailing slash", () => {
    expect(run("--lhm-url", "http://127.0.0.1:9000/")).toMatchObject({
      options: { lhmUrl: "http://127.0.0.1:9000" },
    });
  });

  it("reads an LHM executable from --lhm-exe", () => {
    expect(run("--lhm-exe", "C:/tools/LibreHardwareMonitor.exe")).toMatchObject(
      {
        options: {
          lhmExecutable: path.resolve("C:/tools/LibreHardwareMonitor.exe"),
        },
      },
    );
  });

  it("refuses an LHM flag with no value rather than defaulting it", () => {
    expect(run("--lhm-url")).toMatchObject({ kind: "error" });
    expect(run("--lhm-exe")).toMatchObject({ kind: "error" });
  });

  it("runs a tray host without opening a browser", () => {
    expect(run("--tray")).toMatchObject({
      options: { tray: true, openBrowser: false },
    });
  });

  it("reads a custom RTSS executable", () => {
    expect(run("--rtss-exe", "C:\\Games\\RTSS.exe")).toMatchObject({
      options: { rtssExecutable: path.resolve("C:\\Games\\RTSS.exe") },
    });
  });

  it("refuses --rtss-exe with no path", () => {
    expect(run("--rtss-exe")).toEqual({
      kind: "error",
      message: "--rtss-exe needs a path to RTSS.exe.",
    });
  });

  it("documents the tray flags", () => {
    const help = run("--help");
    expect(help.kind === "message" ? help.text : "").toContain("--tray");
    expect(help.kind === "message" ? help.text : "").toContain("--rtss-exe");
  });

  it.each(["--no-browser", "-n"])("%s suppresses the browser", (flag) => {
    expect(run(flag)).toMatchObject({ options: { openBrowser: false } });
  });

  it.each(["--help", "-h"])("%s prints help and runs nothing", (flag) => {
    expect(run(flag)).toEqual({ kind: "message", text: HELP_TEXT });
  });

  it.each(["--version", "-v"])("%s prints the injected version", (flag) => {
    expect(run(flag)).toEqual({ kind: "message", text: VERSION });
  });

  it("combines flags", () => {
    expect(
      run("-p", "9000", "-H", "0.0.0.0", "-n", "--themes-dir", "my-themes"),
    ).toEqual({
      kind: "run",
      options: {
        port: 9000,
        host: "0.0.0.0",
        hostGiven: true,
        openBrowser: false,
        tray: false,
        themesDir: path.resolve("my-themes"),
        settingsDir: DEFAULT_SETTINGS_DIR,
        lhmUrl: DEFAULT_LHM_URL,
      },
    });
  });

  /**
   * The settings moved out of the themes directory, so `--app-dir`
   * is how a private install is made: one flag relocates the library *and* the
   * state, rather than a library that writes into the real settings.
   */
  it("relocates the library and the settings together for --app-dir", () => {
    const app = path.resolve("my-app");
    for (const argv of [
      ["--app-dir", "my-app"],
      // Order-independent, because the second flag must not be read as
      // "explicitly left at the default" by the first.
      ["--app-dir", "my-app", "--app-dir", "my-app"],
    ]) {
      expect(run(...argv)).toMatchObject({
        kind: "run",
        options: {
          themesDir: path.join(app, "themes"),
          settingsDir: path.join(app, "settings"),
        },
      });
    }
  });

  it("lets --themes-dir override the library inside a relocated app", () => {
    expect(
      run("--app-dir", "my-app", "--themes-dir", "elsewhere"),
    ).toMatchObject({
      kind: "run",
      options: {
        themesDir: path.resolve("elsewhere"),
        settingsDir: path.join(path.resolve("my-app"), "settings"),
      },
    });
    // And the other way round, so neither order reads as the default.
    expect(
      run("--themes-dir", "elsewhere", "--app-dir", "my-app"),
    ).toMatchObject({
      kind: "run",
      options: {
        themesDir: path.resolve("elsewhere"),
        settingsDir: path.join(path.resolve("my-app"), "settings"),
      },
    });
  });

  it("refuses --app-dir without a directory", () => {
    expect(run("--app-dir").kind).toBe("error");
    expect(run("--app-dir", "-n").kind).toBe("error");
  });

  describe("refusing bad input rather than coercing it", () => {
    it.each(["0", "65536", "8080abc", "abc", "-1"])(
      "refuses the port %s",
      (value) => {
        expect(run("--port", value).kind).toBe("error");
      },
    );

    it("refuses a port with no value", () => {
      expect(run("--port")).toMatchObject({ kind: "error" });
    });

    it("refuses a host with no value, and does not eat the next flag", () => {
      expect(run("--host", "-n")).toMatchObject({ kind: "error" });
    });

    it("refuses --themes-dir with no value, and does not eat the next flag", () => {
      expect(run("--themes-dir")).toMatchObject({ kind: "error" });
      expect(run("--themes-dir", "-n")).toMatchObject({ kind: "error" });
    });

    it("refuses an unknown option and points at --help", () => {
      const result = run("--turbo");

      expect(result.kind).toBe("error");
      expect(result).toMatchObject({
        message: expect.stringContaining("--help"),
      });
    });
  });
});

describe("isLoopbackHost", () => {
  it.each([
    "127.0.0.1",
    "localhost",
    "::1",
    "[::1]",
    "LOCALHOST",
    " 127.0.0.1 ",
  ])("treats %s as reachable only from this machine", (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(["0.0.0.0", "::", "192.168.1.10", "10.0.0.5"])(
    "treats %s as network-reachable, so the warning fires",
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
    },
  );
});
