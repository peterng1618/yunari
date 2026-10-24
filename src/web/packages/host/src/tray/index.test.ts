import { beforeEach, expect, it, vi } from "vitest";
import { startTray, type TraySpawnProcess } from "./index.js";

const mocks = vi.hoisted(() => ({
  startWindowsTray: vi.fn(),
  startLinuxTray: vi.fn(),
}));

vi.mock("./windows.js", () => ({
  startWindowsTray: mocks.startWindowsTray,
}));
vi.mock("./linux.js", () => ({
  startLinuxTray: mocks.startLinuxTray,
}));

const base = {
  linuxBinary: "tray",
  readSnapshot: async () => ({ port: 5227, lan: false, autostart: false }),
  act: async () => ({ ok: true, message: "" }),
  onLost: vi.fn(),
};

function fakeView() {
  return { setMenu: vi.fn(), setTooltip: vi.fn(), close: vi.fn() };
}

beforeEach(() => {
  mocks.startWindowsTray.mockReset();
  mocks.startLinuxTray.mockReset();
});

it("refuses macOS and a headless Linux session before opening a view", async () => {
  await expect(startTray({ ...base, platform: "darwin" })).rejects.toThrow(
    /Windows and Linux only/,
  );
  await expect(
    startTray({ ...base, platform: "linux", env: {} }),
  ).rejects.toThrow(/graphical session/);
  await expect(
    startTray({ ...base, platform: "linux", env: { DISPLAY: "" } }),
  ).rejects.toThrow(/graphical session/);
  expect(mocks.startWindowsTray).not.toHaveBeenCalled();
  expect(mocks.startLinuxTray).not.toHaveBeenCalled();
});

it("selects the Windows adapter, ignores the Linux binary and forwards the spawner", async () => {
  const view = fakeView();
  mocks.startWindowsTray.mockResolvedValue(view);
  const spawnProcess = vi.fn() as unknown as TraySpawnProcess;
  const controller = await startTray({
    ...base,
    platform: "win32",
    spawnProcess,
  });
  expect(mocks.startLinuxTray).not.toHaveBeenCalled();
  expect(mocks.startWindowsTray).toHaveBeenCalledTimes(1);
  const options = mocks.startWindowsTray.mock.calls[0]?.[0] as {
    spawnProcess?: unknown;
    onLost?: unknown;
    binary?: unknown;
  };
  expect(options.spawnProcess).toBe(spawnProcess);
  expect(options.onLost).toBe(base.onLost);
  expect(options.binary).toBeUndefined();
  controller.stop();
  expect(view.close).toHaveBeenCalled();
});

it("selects the Linux adapter with the staged binary", async () => {
  const view = fakeView();
  mocks.startLinuxTray.mockResolvedValue(view);
  const controller = await startTray({
    ...base,
    platform: "linux",
    env: { WAYLAND_DISPLAY: "wayland-1" },
  });
  expect(mocks.startWindowsTray).not.toHaveBeenCalled();
  const options = mocks.startLinuxTray.mock.calls[0]?.[0] as {
    binary?: unknown;
    spawnProcess?: unknown;
  };
  expect(options.binary).toBe("tray");
  expect(options.spawnProcess).toBeUndefined();
  controller.stop();
});
