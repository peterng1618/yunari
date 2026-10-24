import { afterEach, expect, it, vi } from "vitest";
import { startTrayController } from "./controller.js";
import type { TrayAction, TraySnapshot, TrayView } from "./menu.js";

const BASE: TraySnapshot = { port: 5227, lan: false, autostart: false };
const STATUS = "Yunari — localhost:5227 · local only";

function fakeView() {
  return { setMenu: vi.fn(), setTooltip: vi.fn(), close: vi.fn() };
}

type OpenView = (
  onAction: (action: TrayAction) => void,
  onLost: (reason: string) => void,
) => Promise<TrayView>;

afterEach(() => {
  vi.useRealTimers();
});

it("sends the menu once and only resends when it changes", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  const onLost = vi.fn();
  const openView = vi.fn<OpenView>(async () => view);
  const controller = await startTrayController({
    readSnapshot: async () => BASE,
    act: async () => ({ ok: true, message: "" }),
    openView,
    onLost,
    pollMs: 1000,
  });
  expect(view.setMenu).toHaveBeenCalledTimes(1);
  expect(openView.mock.calls[0]?.[1]).toBe(onLost);
  await vi.advanceTimersByTimeAsync(1000);
  expect(view.setMenu).toHaveBeenCalledTimes(1);
  controller.stop();
  expect(view.close).toHaveBeenCalled();
});

it("shows a failed action as a notice and clears it", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  let onAction: ((action: TrayAction) => void) | undefined;
  await startTrayController({
    readSnapshot: async () => BASE,
    act: async () => ({ ok: false, message: "permission denied" }),
    openView: async (handler) => {
      onAction = handler;
      return view;
    },
    onLost: vi.fn(),
    pollMs: 1000,
    noticeMs: 5000,
  });
  onAction?.("autostart");
  await vi.advanceTimersByTimeAsync(0);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe(
    "permission denied",
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).not.toBe(
    "permission denied",
  );
});

it("clears a notice when an action succeeds", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  let onAction: ((action: TrayAction) => void) | undefined;
  const act = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, message: "permission denied" })
    .mockResolvedValue({ ok: true, message: "" });
  const controller = await startTrayController({
    readSnapshot: async () => BASE,
    act,
    openView: async (handler) => {
      onAction = handler;
      return view;
    },
    onLost: vi.fn(),
    pollMs: 1000,
    noticeMs: 5000,
  });
  onAction?.("autostart");
  await vi.advanceTimersByTimeAsync(0);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe(
    "permission denied",
  );
  onAction?.("pair");
  await vi.advanceTimersByTimeAsync(0);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe(STATUS);
  controller.stop();
});

it("stops on exit without acting or polling again", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  let onAction: ((action: TrayAction) => void) | undefined;
  const act = vi.fn(async () => ({ ok: true, message: "" }));
  await startTrayController({
    readSnapshot: async () => BASE,
    act,
    openView: async (handler) => {
      onAction = handler;
      return view;
    },
    onLost: vi.fn(),
    pollMs: 1000,
  });
  onAction?.("exit");
  await vi.advanceTimersByTimeAsync(0);
  expect(act).not.toHaveBeenCalled();
  expect(view.close).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(view.setMenu).toHaveBeenCalledTimes(1);
});

it("shows a snapshot failure as a notice and keeps polling", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  const readSnapshot = vi
    .fn()
    .mockRejectedValueOnce(new Error("host is busy"))
    .mockResolvedValue(BASE);
  const controller = await startTrayController({
    readSnapshot,
    act: async () => ({ ok: true, message: "" }),
    openView: async () => view,
    onLost: vi.fn(),
    pollMs: 1000,
    noticeMs: 3000,
  });
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe("host is busy");
  await vi.advanceTimersByTimeAsync(1000);
  expect(readSnapshot).toHaveBeenCalledTimes(2);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe("host is busy");
  await vi.advanceTimersByTimeAsync(2000);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe(STATUS);
  controller.stop();
});

it("resends the menu and tooltip when the snapshot changes", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  const readSnapshot = vi
    .fn()
    .mockResolvedValueOnce(BASE)
    .mockResolvedValue({ ...BASE, port: 5228, lan: true });
  const controller = await startTrayController({
    readSnapshot,
    act: async () => ({ ok: true, message: "" }),
    openView: async () => view,
    onLost: vi.fn(),
    pollMs: 1000,
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(view.setMenu).toHaveBeenCalledTimes(2);
  expect(view.setTooltip).toHaveBeenCalledTimes(2);
  controller.stop();
});

it("ignores a refresh while one is in flight", async () => {
  const view = fakeView();
  let release: (snapshot: TraySnapshot) => void = () => undefined;
  const gate = new Promise<TraySnapshot>((resolve) => {
    release = resolve;
  });
  const readSnapshot = vi
    .fn()
    .mockResolvedValueOnce(BASE)
    .mockReturnValueOnce(gate);
  const controller = await startTrayController({
    readSnapshot,
    act: async () => ({ ok: true, message: "" }),
    openView: async () => view,
    onLost: vi.fn(),
    pollMs: 60_000,
  });
  const first = controller.refresh();
  await controller.refresh();
  expect(readSnapshot).toHaveBeenCalledTimes(2);
  release(BASE);
  await first;
  controller.stop();
});

it("stops once and never reports the loss itself", async () => {
  const view = fakeView();
  const onLost = vi.fn();
  const controller = await startTrayController({
    readSnapshot: async () => BASE,
    act: async () => ({ ok: true, message: "" }),
    openView: async () => view,
    onLost,
  });
  controller.stop();
  controller.stop();
  expect(view.close).toHaveBeenCalledTimes(1);
  expect(onLost).not.toHaveBeenCalled();
});

it("replaces the notice timer instead of letting the older one clear it", async () => {
  vi.useFakeTimers();
  const view = fakeView();
  let onAction: ((action: TrayAction) => void) | undefined;
  let attempts = 0;
  const act = vi.fn(async () => {
    attempts += 1;
    return { ok: false, message: attempts === 1 ? "first" : "second" };
  });
  const controller = await startTrayController({
    readSnapshot: async () => BASE,
    act,
    openView: async (handler) => {
      onAction = handler;
      return view;
    },
    onLost: vi.fn(),
    pollMs: 1000,
    noticeMs: 5000,
  });
  onAction?.("pair");
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(4000);
  onAction?.("pair");
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe("second");
  await vi.advanceTimersByTimeAsync(4000);
  expect(view.setMenu.mock.calls.at(-1)?.[0][0].title).toBe(STATUS);
  controller.stop();
});
