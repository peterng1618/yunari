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
  child.stdout.write(
    '{"type":"clicked","seq_id":0,"__id":1,"item":{"title":"Pair display"}}\n',
  );
  expect(onAction).toHaveBeenCalledWith("pair");
});

it("updates one row in place by its slot, and every slot routes its action", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
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
    menu: { tooltip: string };
  };
  expect(line.type).toBe("update-item-and-menu");
  expect(line.seq_id).toBe(1);
  // The slot's init id: the binary never rewrites its click table.
  expect(line.item.__id).toBe(2);
  expect(line.item.title).toBe("Auto start (√)");
  expect(line.menu.tooltip).toBe("Yunari");

  // tray.go echoes the slot as `seq_id` and the init id as `__id`.
  child.stdout.write(
    '{"type":"clicked","seq_id":1,"__id":2,"item":{"title":"Auto start (√)"}}\n',
  );
  expect(onAction).toHaveBeenLastCalledWith("autostart");
  child.stdout.write(
    '{"type":"clicked","seq_id":2,"__id":3,"item":{"title":"Pair display"}}\n',
  );
  expect(onAction).toHaveBeenLastCalledWith("pair");
  // The status slot has no action, and an out-of-range slot is not guessed.
  child.stdout.write('{"type":"clicked","seq_id":0,"__id":1}\n');
  child.stdout.write('{"type":"clicked","seq_id":9,"__id":9}\n');
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
    item: { __id: number };
    menu: { tooltip: string; items: { title: string }[] };
  };
  expect(message.type).toBe("update-item-and-menu");
  expect(message.seq_id).toBe(0);
  expect(message.item.__id).toBe(1);
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

it("writes nothing on a changed row count, so a click still routes the row seen", async () => {
  const warn = vi
    .spyOn(process, "emitWarning")
    .mockImplementation(() => undefined);
  const { child, stdin, spawnProcess } = fakeChild();
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
    { title: "Auto start", enabled: true, checked: false, action: "autostart" },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  // A row disappears, so every later row shifts by one. Writing the new titles
  // would put "Pair display" under the slot that routes `autostart`.
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(stdin).toHaveLength(1);

  // The screen still shows the pre-mismatch rows, and routing agrees with it.
  child.stdout.write(
    '{"type":"clicked","seq_id":2,"__id":3,"item":{"title":"Pair display"}}\n',
  );
  expect(onAction).toHaveBeenLastCalledWith("pair");
  child.stdout.write(
    '{"type":"clicked","seq_id":1,"__id":2,"item":{"title":"Auto start"}}\n',
  );
  expect(onAction).toHaveBeenLastCalledWith("autostart");
});

it("treats a write that reports backpressure as delivered", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  // `write()` returning false means "buffered, do not write more yet", not
  // "failed"; only a thrown EPIPE is a failed write.
  vi.spyOn(child.stdin, "write").mockImplementationOnce((() => false) as never);
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
  ]);
  view.setMenu([
    { title: "status", enabled: false },
    { title: "Auto start", enabled: true, checked: true, action: "autostart" },
  ]);
  // The backpressured first write never reached the pipe, but it still latched
  // the rows: the next write is an update, not a second bare init menu.
  expect(stdin).toHaveLength(1);
  expect(JSON.parse(stdin[0] ?? "")).toMatchObject({
    type: "update-item-and-menu",
    seq_id: 1,
  });
});

it("latches the row set on the first non-empty menu", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
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
  view.setMenu([]);
  expect(stdin).toHaveLength(0);
  view.setMenu([{ title: "Pair display", enabled: true, action: "pair" }]);
  expect(stdin).toHaveLength(1);
  const first = JSON.parse(stdin[0] ?? "") as {
    type?: string;
    items: { __id: number }[];
  };
  expect(first.type).toBeUndefined();
  expect(first.items).toHaveLength(1);
  child.stdout.write(`{"type":"clicked","__id":${first.items[0]?.__id}}\n`);
  expect(onAction).toHaveBeenCalledWith("pair");
});

it("reports a later empty menu as a mismatch and keeps the known rows", async () => {
  const warn = vi
    .spyOn(process, "emitWarning")
    .mockImplementation(() => undefined);
  const { child, stdin, spawnProcess } = fakeChild();
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
  view.setMenu([]);
  expect(warn).toHaveBeenCalledTimes(1);
  expect(stdin).toHaveLength(1);
  child.stdout.write('{"type":"clicked","__id":2}\n');
  expect(onAction).toHaveBeenCalledWith("pair");
});

it("retries the bare init menu when the first write fails", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const onAction = vi.fn();
  vi.spyOn(child.stdin, "write").mockImplementationOnce(() => {
    throw new Error("EPIPE");
  });
  const starting = startLinuxTray({
    binary: "tray",
    onAction,
    onLost: vi.fn(),
    spawnProcess,
    ...fakeDeps,
  });
  child.stdout.write('{"type":"ready"}\n');
  const view = await starting;
  view.setMenu([{ title: "Pair display", enabled: true, action: "pair" }]);
  expect(stdin).toHaveLength(0);
  view.setMenu([{ title: "Pair display", enabled: true, action: "pair" }]);
  expect(stdin).toHaveLength(1);
  const first = JSON.parse(stdin[0] ?? "") as {
    type?: string;
    items: { __id: number }[];
  };
  expect(first.type).toBeUndefined();
  child.stdout.write(`{"type":"clicked","__id":${first.items[0]?.__id}}\n`);
  expect(onAction).toHaveBeenCalledWith("pair");
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
