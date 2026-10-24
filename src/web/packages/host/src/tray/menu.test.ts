import { expect, it } from "vitest";
import { buildTrayMenu, type TraySnapshot, trayTooltip } from "./menu.js";

const base: TraySnapshot = { port: 5227, lan: false, autostart: false };

it("hides both external rows when neither program is installed", () => {
  const menu = buildTrayMenu({
    ...base,
    lhm: { installed: false, running: false },
    rtss: { installed: false, running: false },
  });
  expect(menu.some((item) => item.action === "lhm")).toBe(false);
  expect(menu.some((item) => item.action === "rtss")).toBe(false);
});

it("shows Start for an installed stopped program and disables a running one", () => {
  const menu = buildTrayMenu({
    ...base,
    rtss: { installed: true, running: false },
  });
  const row = menu.find((item) => item.action === "rtss");
  expect(row).toMatchObject({
    title: "Start RivaTuner Statistics Server",
    enabled: true,
  });
});

it("reports a running LHM whose web server is off", () => {
  const menu = buildTrayMenu({
    ...base,
    lhm: { installed: true, running: true, detail: "web server off" },
  });
  expect(menu.find((item) => item.action === "lhm")).toMatchObject({
    title: "LibreHardwareMonitor — running (web server off)",
    enabled: false,
  });
});

it("checks Auto start and puts the status line first", () => {
  const menu = buildTrayMenu({ ...base, autostart: true, lan: true });
  expect(menu[0]).toMatchObject({
    title: "Yunari — localhost:5227 · LAN on",
    enabled: false,
  });
  expect(menu.find((item) => item.action === "autostart")).toMatchObject({
    checked: true,
  });
});

it("uses a notice instead of the address line", () => {
  expect(
    buildTrayMenu({ ...base, notice: "Auto start failed: denied" })[0]?.title,
  ).toBe("Auto start failed: denied");
});

it("emits separators only between two non-empty groups", () => {
  const none = buildTrayMenu({
    ...base,
    lhm: { installed: false, running: false },
    rtss: { installed: false, running: false },
  });
  expect(none.filter((item) => item.separator === true)).toHaveLength(1);
  const one = buildTrayMenu({
    ...base,
    rtss: { installed: true, running: false },
  });
  expect(one.filter((item) => item.separator === true)).toHaveLength(2);
});

it("keeps the tooltip short and local", () => {
  expect(trayTooltip({ ...base })).toBe("Yunari — localhost:5227 · local only");
});

it("caps the tooltip at Windows' 63 characters", () => {
  const text = trayTooltip({ ...base, notice: "x".repeat(100) });
  expect(text).toHaveLength(63);
  expect(text.endsWith("…")).toBe(true);
});
