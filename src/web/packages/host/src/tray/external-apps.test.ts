import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createExternalApps, parseTasklistImage } from "./external-apps.js";

it("matches a process by image name, not localized prose", () => {
  expect(
    parseTasklistImage(
      '"RTSS.exe","1234","Console","1","12,345 K"\r\n',
      "RTSS.exe",
    ),
  ).toBe(true);
  expect(
    parseTasklistImage(
      "INFO: No tasks are running which match the specified criteria.",
      "RTSS.exe",
    ),
  ).toBe(false);
});

it("prefers an explicit executable, then the vendored default", () => {
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    lhmExecutable: "C:\\custom\\lhm.exe",
    exists: (file) => file === "C:\\custom\\lhm.exe",
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
  });
  expect(apps.findLhmExecutable()).toBe("C:\\custom\\lhm.exe");
});

it("hides both programs on a non-Windows host", async () => {
  const apps = createExternalApps({
    platform: "linux",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "/opt/lhm/LibreHardwareMonitor.exe",
    exists: () => true,
    listProcesses: async () => true,
    fetchImpl: async () => ({ ok: true }),
  });
  expect(await apps.lhmState()).toEqual({ installed: false, running: false });
  expect(await apps.rtssState()).toEqual({ installed: false, running: false });
});

it("reports both programs absent when no path or process answers", async () => {
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => false,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
  });
  expect(await apps.lhmState()).toEqual({ installed: false, running: false });
  expect(await apps.rtssState()).toEqual({ installed: false, running: false });
});

it("reports an installed program as stopped when the process probe fails", async () => {
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: (file) => file === "C:\\app\\lhm.exe",
    listProcesses: async () => {
      throw new Error("denied");
    },
    fetchImpl: async () => ({ ok: false }),
  });
  expect(await apps.lhmState()).toEqual({ installed: true, running: false });
});

it("calls the process probe for RTSS and starts only the installed executable", async () => {
  const unref = vi.fn();
  const child = Object.assign(new EventEmitter(), { unref });
  const spawnProcess = vi.fn(() => child);
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    rtssExecutable: "C:\\RTSS\\RTSS.exe",
    exists: () => true,
    listProcesses: async (image) => image === "RTSS.exe",
    fetchImpl: async () => ({ ok: false }),
    spawnProcess,
  });
  expect(await apps.rtssState()).toEqual({ installed: true, running: true });
  const started = apps.startRtss();
  child.emit("spawn");
  expect(await started).toEqual({
    ok: true,
    message: "Started RivaTuner Statistics Server.",
  });
  expect(spawnProcess).toHaveBeenCalledWith(
    "C:\\RTSS\\RTSS.exe",
    [],
    expect.objectContaining({
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }),
  );
  expect(unref).toHaveBeenCalled();
});

it("does not launch an LHM that is already running with its web server off", async () => {
  const launchLhm = vi.fn();
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async (image) => image === "LibreHardwareMonitor.exe",
    fetchImpl: async () => ({ ok: false }),
    launchLhm,
  });
  expect(await apps.lhmState()).toEqual({
    installed: true,
    running: true,
    detail: "web server off",
  });
  expect(await apps.startLhm()).toMatchObject({
    ok: false,
    message: "LibreHardwareMonitor is running but its web server is off.",
  });
  expect(launchLhm).not.toHaveBeenCalled();
});

it("stops the LHM this run started and has no RTSS stop", async () => {
  const stop = vi.fn();
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
    launchLhm: async () => ({ started: true, stop }),
  });
  await apps.startLhm();
  apps.stopOwnedLhm();
  expect(stop).toHaveBeenCalledTimes(1);
  expect("stopRtss" in apps).toBe(false);
});
