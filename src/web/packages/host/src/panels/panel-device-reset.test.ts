import { describe, expect, it } from "vitest";
import { resetPanelDevice, type ScriptResult } from "./panel-device-reset.js";

const CHILD = "USB\\VID_1D6B&PID_0106&MI_00\\6&E9576A&5&0000";
const PARENT = "USB\\VID_1D6B&PID_0106\\20080411";

const ok = (stdout: string): ScriptResult => ({ code: 0, stdout, stderr: "" });

/** Records every script and answers the lookup with `parent`. */
function recorder(parent = PARENT) {
  const scripts: string[] = [];
  return {
    scripts,
    run: async (script: string): Promise<ScriptResult> => {
      scripts.push(script);
      return scripts.length === 1 ? ok(`${parent}\r\n`) : ok("");
    },
  };
}

describe("resetPanelDevice", () => {
  it("refuses a value that is not a USB instance id before running anything", async () => {
    const { scripts, run } = recorder();

    await expect(
      resetPanelDevice("COM5'; Remove-Item C:\\ -Recurse", {
        run,
        platform: "win32",
      }),
    ).rejects.toThrow("not a USB instance id");
    expect(scripts).toEqual([]);
  });

  it("restarts the parent composite device, not the COM interface", async () => {
    const { scripts, run } = recorder();

    await resetPanelDevice(CHILD, { run, platform: "win32" });

    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain(CHILD);
    expect(scripts[0]).toContain("DEVPKEY_Device_Parent");
    // A child restart leaves the wedge; the parent is the device to restart.
    expect(scripts[1]).toContain(PARENT);
    expect(scripts[1]).not.toContain(CHILD);
    expect(scripts[1]).toContain("RunAs");
  });

  it("reports a device Windows cannot name, and does not restart anything", async () => {
    const scripts: string[] = [];
    const run = async (script: string): Promise<ScriptResult> => {
      scripts.push(script);
      return {
        code: 1,
        stdout: "",
        stderr: "No matching MSFT_PnPDevice object found.\r\n",
      };
    };

    await expect(
      resetPanelDevice(CHILD, { run, platform: "win32" }),
    ).rejects.toThrow(
      "Windows could not name the USB device to restart: No matching MSFT_PnPDevice object found.",
    );
    expect(scripts).toHaveLength(1);
  });

  it("refuses a parent Windows reported in a shape it does not accept", async () => {
    const { scripts, run } = recorder("ROOT\\SYSTEM\\0000");

    await expect(
      resetPanelDevice(CHILD, { run, platform: "win32" }),
    ).rejects.toThrow("parent that is not a USB device");
    expect(scripts).toHaveLength(1);
  });

  it("reports a declined elevation prompt", async () => {
    const scripts: string[] = [];
    const run = async (script: string): Promise<ScriptResult> => {
      scripts.push(script);
      return scripts.length === 1
        ? ok(PARENT)
        : {
            code: 1,
            stdout: "",
            stderr: "The operation was canceled by the user.\r\n",
          };
    };

    await expect(
      resetPanelDevice(CHILD, { run, platform: "win32" }),
    ).rejects.toThrow(
      "Windows refused the restart: The operation was canceled by the user.",
    );
  });

  it("is a Windows action only", async () => {
    const { scripts, run } = recorder();

    await expect(
      resetPanelDevice(CHILD, { run, platform: "linux" }),
    ).rejects.toThrow("Windows action");
    expect(scripts).toEqual([]);
  });
});
