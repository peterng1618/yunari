import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, type Mock, vi } from "vitest";
import {
  type LinuxTrayChild,
  linuxMenu,
  type SpawnLinuxTrayProcess,
  startLinuxTray,
} from "./linux.js";
import type { TrayMenuItem } from "./menu.js";

interface FakeChild extends LinuxTrayChild {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  emit(event: string, ...args: unknown[]): boolean;
}

/** Records what the adapter writes and spawns while behaving like a child. */
function fakeChild(): {
  child: FakeChild;
  stdin: string[];
  kill: ReturnType<typeof vi.fn>;
  spawnProcess: Mock<SpawnLinuxTrayProcess>;
} {
  const stdin: string[] = [];
  const input = new PassThrough();
  input.on("data", (chunk: Buffer) => stdin.push(chunk.toString()));
  const kill = vi.fn(() => true);
  const child = Object.assign(new EventEmitter(), {
    stdin: input,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill,
    unref: vi.fn(),
  }) as FakeChild;
  const spawnProcess = vi.fn<SpawnLinuxTrayProcess>(() => child);
  return { child, stdin, kill, spawnProcess };
}

const fakeDeps = {
  exists: () => true,
  chmod: () => undefined,
} as const;

it("marks a checked row with the Linux check suffix and keeps ids stable", () => {
  const { menu, actions } = linuxMenu(
    [
      {
        title: "Auto start",
        enabled: true,
        checked: true,
        action: "autostart",
      },
      { separator: true, title: "", enabled: false },
      { title: "Start RTSS", enabled: true, action: "rtss" },
    ],
    "png",
  );
  expect((menu.items as readonly { title: string }[])[0]?.title).toBe(
    "Auto start (√)",
  );
  expect((menu.items as readonly { title: string }[])[1]?.title).toBe(" ");
  expect((menu.items as readonly { __id: number }[])[1]?.__id).toBe(2);
  expect(actions.get(3)).toBe("rtss");
  expect(actions.has(2)).toBe(false);
});

it("opens on ready with a bare Menu, then maps a clicked __id", async () => {
  const { child, stdin } = fakeChild();
  const onAction = vi.fn();
  const starting = startLinuxTray({
    binary: "tray",
    onAction,
    onLost: vi.fn(),
    spawnProcess: () => child,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([{ title: "Pair display", enabled: true, action: "pair" }]);
  const first = JSON.parse(stdin[0] ?? "") as {
    type?: string;
    icon: string;
    title: string;
    tooltip: string;
    items: { title: string; enabled: boolean; __id: number }[];
  };
  // The binary reads exactly one bare Menu line before it builds the tray.
  expect(first.type).toBeUndefined();
  expect(first.icon.length).toBeGreaterThan(0);
  expect(first.title).toBe("");
  expect(first.tooltip).toBe("Yunari");
  expect(first.items).toEqual([
    { title: "Pair display", enabled: true, __id: 1 },
  ]);
  child.stdout.write('{"type":"clicked","__id":1}\n');
  expect(onAction).toHaveBeenCalledWith("pair");
});

it("updates a changed row with update-item-and-menu and seq_id -1", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Auto start", enabled: true, checked: false, action: "autostart" },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Auto start", enabled: true, checked: true, action: "autostart" },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);

  expect(stdin).toHaveLength(2);
  const line = JSON.parse(stdin[1] ?? "") as {
    type: string;
    seq_id: number;
    item: { title: string; __id: number };
    menu: { tooltip: string; items: { title: string }[] };
  };
  expect(line.type).toBe("update-item-and-menu");
  expect(line.seq_id).toBe(-1);
  expect(line.item.__id).toBe(2);
  expect(line.item.title).toBe("Auto start (√)");
  expect(line.menu.tooltip).toBe("Yunari");
  expect(line.menu.items).toHaveLength(3);
});

it("maps a clicked __id to its row after the array order differs", async () => {
  const { child, spawnProcess } = fakeChild();
  const onAction = vi.fn();
  const starting = startLinuxTray({
    binary: "tray",
    onAction,
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Pair display", enabled: true, action: "pair" },
    { title: "Theme Editor", enabled: true, action: "editor" },
  ]);
  // A reordered array keeps each action row's original id, so the click still
  // resolves to the row the binary knows.
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Theme Editor", enabled: true, action: "editor" },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  child.stdout.write('{"type":"clicked","__id":2}\n');
  expect(onAction).toHaveBeenLastCalledWith("pair");
  child.stdout.write('{"type":"clicked","__id":3}\n');
  expect(onAction).toHaveBeenLastCalledWith("editor");
  child.stdout.write('{"type":"clicked","__id":99}\n');
  expect(onAction).toHaveBeenCalledTimes(2);
});

it("names the missing staged binary", async () => {
  await expect(
    startLinuxTray({
      binary: "tray",
      onAction: vi.fn(),
      onLost: vi.fn(),
      exists: () => false,
    }),
  ).rejects.toThrow(/npm run vendor:tray/);
});

it("refuses an architecture the staged binary cannot run", async () => {
  await expect(
    startLinuxTray({
      binary: "tray",
      onAction: vi.fn(),
      onLost: vi.fn(),
      ...fakeDeps,
      arch: "arm64",
    }),
  ).rejects.toThrow(/x86-64 only/);
});

it("spawns the staged binary with no arguments over three pipes", async () => {
  const { child, spawnProcess } = fakeChild();
  const starting = startLinuxTray({
    binary: "/opt/yunari/tray_linux_release",
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  await starting;

  expect(spawnProcess).toHaveBeenCalledTimes(1);
  const call = spawnProcess.mock.calls[0];
  if (call === undefined) throw new Error("no spawn recorded");
  const [executable, args, options] = call;
  expect(executable).toBe("/opt/yunari/tray_linux_release");
  expect(args).toEqual([]);
  expect(options).toEqual({ stdio: ["pipe", "pipe", "pipe"] });
});

it("ignores a click whose __id is unknown or not a number", async () => {
  const { child, spawnProcess } = fakeChild();
  const onAction = vi.fn();
  const starting = startLinuxTray({
    binary: "tray",
    onAction,
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  child.stdout.write('{"type":"clicked","__id":9}\n');
  child.stdout.write('{"type":"clicked","__id":"1"}\n');
  child.stdout.write('{"type":"clicked"}\n');
  expect(onAction).not.toHaveBeenCalled();
});

it("resends the menu when only the tooltip changes", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  view.setTooltip("paused");
  const message = JSON.parse(stdin[1] ?? "") as {
    type: string;
    seq_id: number;
    menu: { tooltip: string; items: { title: string }[] };
  };
  expect(message.type).toBe("update-item-and-menu");
  expect(message.seq_id).toBe(-1);
  expect(message.menu.tooltip).toBe("paused");
  expect(message.menu.items[0]?.title).toBe("status");
});

it("warns instead of sending rows the tray binary cannot add", async () => {
  const warn = vi
    .spyOn(process, "emitWarning")
    .mockImplementation(() => undefined);
  const { child, stdin, spawnProcess } = fakeChild();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Pair display", enabled: true, action: "pair" },
    { title: "Exit", enabled: true, action: "exit" },
  ]);
  expect(warn).toHaveBeenCalledTimes(1);
  // The known rows did not change, so nothing is written for the extra row.
  expect(stdin).toHaveLength(1);
});

it("rejects when ready never arrives and kills the child", async () => {
  const { kill, spawnProcess } = fakeChild();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
    readyTimeoutMs: 10,
    ...fakeDeps,
  });
  await expect(starting).rejects.toThrow(/did not start within 10 ms/);
  expect(kill).toHaveBeenCalled();
});

it("never reports onLost after a rejected start", async () => {
  const { child, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost,
    spawnProcess,
    ...fakeDeps,
  });
  child.emit("exit", 1);
  await expect(starting).rejects.toThrow(
    /exited with code 1 before it started/,
  );
  child.emit("exit", 1);
  expect(onLost).not.toHaveBeenCalled();
});

it("reports onLost once for an error followed by an exit", async () => {
  const { child, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost,
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  await starting;
  child.emit("error", new Error("EPIPE"));
  child.emit("exit", 1);
  expect(onLost).toHaveBeenCalledTimes(1);
});

it("sends exit on close, kills after the grace and stays silent", async () => {
  const { child, stdin, kill, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost,
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;

  vi.useFakeTimers();
  try {
    view.close();
    expect(JSON.parse(stdin[0] ?? "")).toEqual({ type: "exit" });
    vi.advanceTimersByTime(299);
    expect(kill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(kill).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
  child.emit("exit", 0);
  expect(onLost).not.toHaveBeenCalled();
});

it("stops writing once lost but still kills the process on close", async () => {
  const { child, stdin, kill, spawnProcess } = fakeChild();
  const starting = startLinuxTray({
    binary: "tray",
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  child.emit("exit", 1);

  const written = stdin.length;
  const menu: readonly TrayMenuItem[] = [{ title: "Pair", enabled: true }];
  view.setMenu(menu);
  view.setTooltip("x");
  expect(stdin).toHaveLength(written);

  vi.useFakeTimers();
  try {
    view.close();
    vi.advanceTimersByTime(300);
    expect(kill).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
