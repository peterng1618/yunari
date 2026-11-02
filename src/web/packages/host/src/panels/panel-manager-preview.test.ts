import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  managerOver as createManagerOver,
  deviceOver,
  type FakeBrowser,
  familyOver,
  RECORD,
  storeOver,
} from "./panel-manager.fixtures.js";
import type { PanelManagerOptions } from "./panel-manager.js";

/**
 * A preview renders through the manager's shared browser at the family's
 * declared size and never opens the panel. The device lifecycle cases live in
 * `panel-manager.test.ts`; these are the preview's own seams.
 */

const h = vi.hoisted(() => ({
  family: undefined as unknown,
  rasterizer: (): unknown => ({
    capture: async () => new Uint8Array([1]),
    captureOverlay: async () => new Uint8Array([2]),
    close: async () => {},
  }),
  browsers: [] as unknown[],
  events: [] as string[],
}));

vi.mock("./panel-families.js", () => ({ familyFor: () => h.family }));
vi.mock("../serve/display-launcher.js", () => ({
  findBrowser: () => "C:/fake/chrome.exe",
}));

beforeEach(() => {
  h.browsers = [];
  h.events = [];
  h.rasterizer = () => ({
    capture: async () => new Uint8Array([1]),
    captureOverlay: async () => new Uint8Array([2]),
    close: async () => {},
  });
});

function managerOver(
  overrides: Partial<PanelManagerOptions> = {},
): ReturnType<typeof createManagerOver> {
  return createManagerOver(h, overrides);
}

describe("panel manager preview", () => {
  it("renders at the family's geometry with the theme on the page", async () => {
    const open = vi.fn(async () => deviceOver());
    const capture = vi.fn(async () => Uint8Array.of(9));
    const close = vi.fn(async () => {});

    h.family = familyOver(open);
    h.rasterizer = () => ({ capture, captureOverlay: vi.fn(), close });

    const pageFor = vi.fn(
      (displayId: string, clip: boolean, themeId?: string) =>
        `http://127.0.0.1:1/?display=${displayId}&clip=${clip}&theme=${themeId ?? ""}`,
    );
    const manager = managerOver({ pageFor });

    const bytes = await manager.capturePreview("strip", "night", true);

    expect(bytes).toEqual(Uint8Array.of(9));
    expect(pageFor).toHaveBeenLastCalledWith("strip", true, "night");
    expect((h.browsers[0] as FakeBrowser).create).toHaveBeenCalledWith({
      url: "http://127.0.0.1:1/?display=strip&clip=true&theme=night",
      geometry: { width: 464, height: 1920 },
      stillFormat: "png",
    });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    // A preview must not take the panel away from the theme it is showing.
    expect(open).not.toHaveBeenCalled();
  });

  it("closes the target when the capture fails", async () => {
    const open = vi.fn(async () => deviceOver());
    const close = vi.fn(async () => {});

    h.family = familyOver(open);
    h.rasterizer = () => ({
      capture: vi.fn(async () => {
        throw new Error("the page stopped composing");
      }),
      captureOverlay: vi.fn(),
      close,
    });
    const manager = managerOver();

    await expect(
      manager.capturePreview("strip", "night", false),
    ).rejects.toThrow(/stopped composing/);

    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses a display that is not a claimed panel", async () => {
    h.family = familyOver(async () => deviceOver());

    const paired = managerOver({
      displays: storeOver([
        {
          id: RECORD.id,
          label: RECORD.label,
          kind: "paired",
          createdAt: RECORD.createdAt,
          lastSeenAt: RECORD.lastSeenAt,
          shape: RECORD.shape,
        },
      ]),
    });
    await expect(
      paired.capturePreview("strip", "night", false),
    ).rejects.toThrow(/not a panel/);

    const absent = managerOver({ displays: storeOver([]) });
    await expect(
      absent.capturePreview("strip", "night", false),
    ).rejects.toThrow(/not a panel/);

    h.family = undefined;
    await expect(
      managerOver().capturePreview("strip", "night", false),
    ).rejects.toThrow(/No driver on this host claims/);
  });
});
