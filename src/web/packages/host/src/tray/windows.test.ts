import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import type { TrayMenuItem } from "./menu.js";
import {
  powershellEncodedCommand,
  startWindowsTray,
  type TrayChild,
  windowsMenuMessage,
} from "./windows.js";

interface FakeChild extends TrayChild {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  emit(event: string, ...args: unknown[]): boolean;
}

/** Records what the adapter writes while still behaving like a child pipe. */
function fakeChild(): {
  child: FakeChild;
  stdin: string[];
  kill: ReturnType<typeof vi.fn>;
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
  return { child, stdin, kill };
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
  const message = JSON.parse(windowsMenuMessage(menu)) as {
    action: string;
    items: { title: string; checked?: boolean; action?: string }[];
  };
  expect(message.action).toBe("menu");
  expect(message.items).toHaveLength(3);
  expect(message.items[1]).toMatchObject({
    title: "Auto start",
    checked: true,
  });
  expect(message.items[1]?.action).toBeUndefined();
});

it("sends a menu and dispatches a click by its current index", async () => {
  const { child, stdin } = fakeChild();
  const onAction = vi.fn();
  const onLost = vi.fn();
  const starting = startWindowsTray({
    onAction,
    onLost,
    spawnProcess: () => child,
  });
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
  child.stdout.write('{"type":"click","index":2}\n');
  expect(onAction).toHaveBeenCalledWith("pair");

  view.close();
  child.emit("exit", 0);
  expect(onLost).not.toHaveBeenCalled();
});

it("ignores a click on a missing or disabled item", async () => {
  const { child } = fakeChild();
  const onAction = vi.fn();
  const starting = startWindowsTray({
    onAction,
    onLost: vi.fn(),
    spawnProcess: () => child,
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
  const { child, stdin } = fakeChild();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess: () => child,
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
  const { child } = fakeChild();
  const onLost = vi.fn();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost,
    spawnProcess: () => child,
  });
  child.stdout.write('{"type":"started"}\n');
  await starting;
  child.emit("exit", 1);
  expect(onLost).toHaveBeenCalledWith(expect.stringContaining("1"));
});

it("rejects with an error line that arrives before started", async () => {
  const { child } = fakeChild();
  const starting = startWindowsTray({
    onAction: vi.fn(),
    onLost: vi.fn(),
    spawnProcess: () => child,
  });
  child.stdout.write('{"type":"error","message":"no desktop"}\n');
  await expect(starting).rejects.toThrow("no desktop");
});

it("rejects when started never arrives and kills the child", async () => {
  const { child, kill } = fakeChild();
  await expect(
    startWindowsTray({
      onAction: vi.fn(),
      onLost: vi.fn(),
      spawnProcess: () => child,
      readyTimeoutMs: 10,
    }),
  ).rejects.toThrow(/did not start within 10 ms/);
  expect(kill).toHaveBeenCalled();
});
