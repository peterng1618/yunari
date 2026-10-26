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

it("probes process presence and the web server once per 30 s", async () => {
  let clock = 0;
  const listProcesses = vi.fn(async () => false);
  const fetchImpl = vi.fn(async () => ({ ok: false }));
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    exists: () => false,
    listProcesses,
    fetchImpl,
    now: () => clock,
  });

  await apps.lhmState();
  await apps.lhmState();
  // Both halves of the state share the window: a poll inside it reads what the
  // previous one paid for, rather than downloading LHM's data again.
  expect(listProcesses).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  clock = 29_999;
  await apps.lhmState();
  expect(listProcesses).toHaveBeenCalledTimes(1);
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  clock = 30_000;
  await apps.lhmState();
  expect(listProcesses).toHaveBeenCalledTimes(2);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("asks LHM for one byte and cancels the body it does not read", async () => {
  const cancel = vi.fn(async () => undefined);
  const fetchImpl = vi.fn(async () => ({ ok: true, body: { cancel } }));
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    exists: () => false,
    listProcesses: async () => false,
    fetchImpl,
  });

  expect(await apps.lhmState()).toEqual({ installed: true, running: true });
  expect(fetchImpl).toHaveBeenCalledWith(
    "http://127.0.0.1:8085/data.json",
    expect.objectContaining({ headers: { Range: "bytes=0-0" } }),
  );
  // Reachability is the whole question; the reply is never buffered.
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("answers an explicit start or stop with a fresh probe, not the cache", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: false }));
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl,
    launchLhm: async () => ({ started: true, stop: () => undefined }),
    now: () => 0,
  });

  await apps.lhmState();
  expect(fetchImpl).toHaveBeenCalledTimes(1);

  // Start clears the cache before asking, and again once the launch settles:
  // the menu refreshed after it must see the server the launch started.
  await apps.startLhm();
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  await apps.lhmState();
  expect(fetchImpl).toHaveBeenCalledTimes(3);

  // Exit must not leave "the web server answered" behind for the next poll.
  apps.stopOwnedLhm();
  await apps.lhmState();
  expect(fetchImpl).toHaveBeenCalledTimes(4);
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
  const spawnProcess = vi.fn(() => {
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
  const listProcesses = vi.fn(async () => false);
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    rtssExecutable: "C:\\RTSS\\RTSS.exe",
    exists: () => true,
    listProcesses,
    fetchImpl: async () => ({ ok: false }),
    spawnProcess,
  });
  expect(await apps.rtssState()).toEqual({ installed: true, running: false });
  expect(await apps.startRtss()).toEqual({
    ok: true,
    message: "Started RivaTuner Statistics Server.",
  });
  expect(listProcesses).toHaveBeenCalledWith("RTSS.exe");
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

it("does not start an RTSS that is already running", async () => {
  const spawnProcess = vi.fn();
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
  expect(await apps.startRtss()).toMatchObject({
    ok: true,
    message: "RivaTuner Statistics Server is already running.",
  });
  expect(spawnProcess).not.toHaveBeenCalled();
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

it("stops an LHM launch that failed after starting a process", async () => {
  const stop = vi.fn();
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
    launchLhm: async () => ({ started: false, reason: "web server off", stop }),
  });
  expect(await apps.startLhm()).toMatchObject({
    ok: false,
    reason: "web server off",
  });
  apps.stopOwnedLhm();
  expect(stop).toHaveBeenCalledTimes(1);
});

it("starts LHM again after the owned process was stopped", async () => {
  const launchLhm = vi.fn(async () => ({
    started: true,
    stop: () => undefined,
  }));
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
    launchLhm,
  });
  await apps.startLhm();
  apps.stopOwnedLhm();
  await apps.startLhm();
  expect(launchLhm).toHaveBeenCalledTimes(2);
});

it("starts LHM again after the previous process exited on its own", async () => {
  const launchLhm = vi.fn(async () => ({
    started: true,
    stop: () => undefined,
  }));
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
    launchLhm,
  });
  expect((await apps.startLhm()).ok).toBe(true);
  expect((await apps.startLhm()).ok).toBe(true);
  expect(launchLhm).toHaveBeenCalledTimes(2);
});

it("releases the previous owned LHM before replacing its stop", async () => {
  const firstStop = vi.fn();
  const secondStop = vi.fn();
  const launchLhm = vi
    .fn()
    .mockResolvedValueOnce({ started: true, stop: firstStop })
    .mockResolvedValueOnce({ started: true, stop: secondStop });
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
    launchLhm,
  });
  expect(await apps.startLhm()).toMatchObject({ ok: true });
  expect(await apps.startLhm()).toMatchObject({ ok: true });
  expect(launchLhm).toHaveBeenCalledTimes(2);
  expect(firstStop).toHaveBeenCalledTimes(1);
  apps.stopOwnedLhm();
  expect(secondStop).toHaveBeenCalledTimes(1);
  expect(firstStop).toHaveBeenCalledTimes(1);
});

it("stops a launch that resolves after Exit", async () => {
  const stop = vi.fn();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const apps = createExternalApps({
    platform: "win32",
    lhmUrl: "http://127.0.0.1:8085",
    lhmDefaultExecutable: "C:\\app\\lhm.exe",
    exists: () => true,
    listProcesses: async () => false,
    fetchImpl: async () => ({ ok: false }),
    launchLhm: async () => {
      await gate;
      return { started: true, stop };
    },
  });
  const starting = apps.startLhm();
  apps.stopOwnedLhm();
  release?.();
  await starting;
  expect(stop).toHaveBeenCalledTimes(1);
});
