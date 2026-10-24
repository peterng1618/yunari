import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, type Mock, vi } from "vitest";
import type { TrayMenuItem } from "./menu.js";
import {
  powershellEncodedCommand,
  type SpawnTrayProcess,
  startWindowsTray,
  type TrayChild,
  WINDOWS_TRAY_SCRIPT,
  windowsMenuMessage,
} from "./windows.js";

interface FakeChild extends TrayChild {
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
  spawnProcess: Mock<SpawnTrayProcess>;
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
  const spawnProcess = vi.fn<SpawnTrayProcess>(() => child);
  return { child, stdin, kill, spawnProcess };
}

const menu: readonly TrayMenuItem[] = [
  { title: "status", enabled: false },
  { title: "Auto start", enabled: true, checked: true, action: "autostart" },
  { title: "Pair display", enabled: true, action: "pair" },
];

it("encodes a PowerShell script as base64 UTF-16LE", () => {
  expect(powershellEncodedCommand("x")).toBe(
    Buffer.from("x", "utf16le").toString("base64"),
  );
});

it("serialises only the fields the tray renders", () => {
  const message = JSON.parse(windowsMenuMessage(menu, 7)) as {
    action: string;
    generation: number;
    items: { title: string; checked?: boolean; action?: string }[];
  };
  expect(message.action).toBe("menu");
  expect(message.generation).toBe(7);
  expect(message.items).toHaveLength(3);
  expect(message.items[1]).toMatchObject({
    title: "Auto start",
    checked: true,
  });
  expect(message.items[1]?.action).toBeUndefined();
});

it("spawns a hidden PowerShell with the encoded script", async () => {
  const { child, spawnProcess } = fakeChild();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
  });
  child.stdout.write('{"type":"started"}\n');
  await starting;

  expect(spawnProcess).toHaveBeenCalledTimes(1);
  const call = spawnProcess.mock.calls[0];
  if (call === undefined) throw new Error("no spawn recorded");
  const [executable, args, options] = call;
  expect(executable).toBe("powershell.exe");
  expect(args.slice(0, 6)).toEqual([
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-WindowStyle",
    "Hidden",
    "-EncodedCommand",
  ]);
  expect(Buffer.from(args[6] ?? "", "base64").toString("utf16le")).toBe(
    WINDOWS_TRAY_SCRIPT,
  );
  expect(options).toEqual({
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
});

it("sends a menu and dispatches a click by its current index", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const onAction = vi.fn();
  const onLost = vi.fn();
  const starting = startWindowsTray({ onAction, onLost, spawnProcess });
  child.stdout.write('{"type":"started"}\n');
  const view = await starting;
  view.setMenu(menu);
  expect(JSON.parse(stdin[0] ?? "")).toMatchObject({
    action: "menu",
    items: [
      { title: "status" },
      { title: "Auto start", checked: true },
      { title: "Pair display" },
    ],
  });
  const sent = JSON.parse(stdin[0] ?? "") as { generation: number };
  child.stdout.write(
    `{"type":"click","generation":${sent.generation},"index":2}\n`,
  );
  expect(onAction).toHaveBeenCalledWith("pair");

  view.close();
  child.emit("exit", 0);
  expect(onLost).not.toHaveBeenCalled();
});

it("resolves a click against the generation the user actually saw", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const onAction = vi.fn();
  const starting = startWindowsTray({
    onAction,
    onLost: vi.fn(),
    spawnProcess,
  });
  child.stdout.write('{"type":"started"}\n');
  const view = await starting;
  const displayed = [
    { title: "Pair display", enabled: true, action: "pair" as const },
    { title: "Theme Editor", enabled: true, action: "editor" as const },
  ];
  const replacement = [
    { title: "Theme Editor", enabled: true, action: "editor" as const },
    { title: "Pair display", enabled: true, action: "pair" as const },
  ];
  view.setMenu(displayed);
  view.setMenu(replacement);
  const first = JSON.parse(stdin[0] ?? "") as { generation: number };
  const second = JSON.parse(stdin[1] ?? "") as { generation: number };
  expect(second.generation).toBe(first.generation + 1);

  // The left menu was still on screen; its index 0 is the old row, not the new.
  child.stdout.write(
    `{"type":"click","generation":${first.generation},"index":0}\n`,
  );
  expect(onAction).toHaveBeenCalledWith("pair");
});

it("ignores a click on a missing or disabled item", async () => {
  const { child, spawnProcess } = fakeChild();
  const onAction = vi.fn();
  const starting = startWindowsTray({
    onAction,
    onLost: vi.fn(),
    spawnProcess,
  });
  child.stdout.write('{"type":"started"}\n');
  const view = await starting;
  view.setMenu([
    { title: "status", enabled: false, action: "editor" },
    { title: "Pair display", enabled: true, action: "pair" },
  ]);
  child.stdout.write('{"type":"click","index":0}\n');
  child.stdout.write('{"type":"click","index":9}\n');
  expect(onAction).not.toHaveBeenCalled();
});

it("caps a tooltip at the NotifyIcon limit", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
  });
  child.stdout.write('{"type":"started"}\n');
  const view = await starting;
  view.setTooltip("y".repeat(100));
  const message = JSON.parse(stdin[0] ?? "") as {
    action: string;
    text: string;
  };
  expect(message.action).toBe("tooltip");
  expect(message.text).toHaveLength(63);
});

it("reports an unexpected tray exit", async () => {
  const { child, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost,
    spawnProcess,
  });
  child.stdout.write('{"type":"started"}\n');
  await starting;
  child.emit("exit", 1);
  expect(onLost).toHaveBeenCalledWith(expect.stringContaining("1"));
});

it("includes the stderr tail in an exit before started", async () => {
  const { child, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost,
    spawnProcess,
  });
  child.stderr.write("Add-Type : cannot add type\n");
  child.emit("exit", 1);
  await expect(starting).rejects.toThrow(/Add-Type : cannot add type/);
  expect(onLost).not.toHaveBeenCalled();
});

it("rejects with an error line that arrives before started", async () => {
  const { child, spawnProcess } = fakeChild();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess,
  });
  child.stdout.write('{"type":"error","message":"no desktop"}\n');
  await expect(starting).rejects.toThrow("no desktop");
});

it("never reports onLost after a rejected start", async () => {
  const { child, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost,
    spawnProcess,
  });
  child.stdout.write('{"type":"error","message":"no desktop"}\n');
  await expect(starting).rejects.toThrow("no desktop");
  child.emit("exit", 1);
  expect(onLost).not.toHaveBeenCalled();
});

it("reports onLost once for an error followed by an exit and then stops writing", async () => {
  const { child, stdin, spawnProcess } = fakeChild();
  const onLost = vi.fn();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost,
    spawnProcess,
  });
  child.stdout.write('{"type":"started"}\n');
  const view = await starting;
  child.stdout.write('{"type":"error","message":"the menu is gone"}\n');
  child.emit("exit", 1);
  expect(onLost).toHaveBeenCalledTimes(1);
  expect(onLost).toHaveBeenCalledWith("the menu is gone");

  const written = stdin.length;
  view.setMenu(menu);
  view.setTooltip("x");
  expect(stdin).toHaveLength(written);
});

it("rejects when started never arrives and kills the child", async () => {
  const { kill, spawnProcess } = fakeChild();
  await expect(
    startWindowsTray({
      onAction: vi.fn(),
      onLost: vi.fn(),
      spawnProcess,
      readyTimeoutMs: 10,
    }),
  ).rejects.toThrow(/did not start within 10 ms/);
  expect(kill).toHaveBeenCalled();
});
