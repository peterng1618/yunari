// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { EXPORT_POLL_MS, type WallpaperEngineItem } from "./client.js";
import { ExportSheet, exportSettingsOf } from "./export-sheet.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const still: WallpaperEngineItem = {
  workshopId: "301",
  title: "Still lake",
  kind: "scene",
  previewUrl: undefined,
  filesize: 8_388_608,
  tags: [],
  stillAtRest: true,
  hasText: true,
  attribution: undefined,
};

const animated: WallpaperEngineItem = {
  ...still,
  workshopId: "302",
  title: "Neon loop",
  stillAtRest: false,
  hasText: undefined,
};

/** Which routes answer what; every other call is a 404. */
interface Routes {
  readonly project?: () => Response;
  readonly exports?: () => Response;
  readonly bytes?: () => Response;
}

interface Call {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function routedFetch(routes: Routes): {
  readonly fetch: typeof fetch;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes("/project")) {
      return routes.project?.() ?? new Response("", { status: 404 });
    }
    if (url.includes("/exports?")) {
      return (
        routes.exports?.() ??
        new Response(JSON.stringify({ files: [] }), { status: 200 })
      );
    }
    if (url.includes("/export?")) {
      return routes.bytes?.() ?? new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetcher, calls };
}

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  await act(async () => {
    mounted?.unmount();
  });
  host?.remove();
  host = undefined;
  vi.useRealTimers();
});

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mount(
  props: Parameters<typeof ExportSheet>[0],
): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ExportSheet {...props} />);
  });
  await flush();
  return host;
}

function press(rendered: HTMLDivElement, selector: string): void {
  rendered.querySelector<HTMLButtonElement>(selector)?.click();
}

describe("exportSettingsOf", () => {
  it("exports a still scene as a PNG and holds no motion keys", () => {
    expect(exportSettingsOf(still)).toEqual({
      format: "png",
      width: 1920,
      height: 1080,
    });
  });

  it("exports an animated scene as a five-second MP4", () => {
    expect(exportSettingsOf({ ...animated, stillAtRest: false })).toEqual({
      format: "mp4",
      width: 1920,
      height: 1080,
      fps: 30,
      durationSeconds: 5,
      blendSeconds: 1,
    });
  });

  it("never guesses a still for an unclassified scene", () => {
    expect(exportSettingsOf({ ...still, stillAtRest: undefined }).format).toBe(
      "mp4",
    );
  });
});

describe("ExportSheet", () => {
  it("guides a still scene with text as PNG at 1920 × 1080", async () => {
    vi.useFakeTimers();
    const rendered = await mount({
      item: still,
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch: routedFetch({}).fetch },
    });

    expect(
      rendered.querySelector("[data-yunari-export-text-step]"),
    ).not.toBeNull();
    expect(rendered.textContent).toContain("PNG");
    expect(rendered.textContent).toContain("1920 × 1080");
    expect(rendered.querySelector("[data-yunari-export-duration]")).toBeNull();
    expect(rendered.textContent).toContain(
      uiCopy.assets.wallpaperEngine.scene.projectNotice,
    );
    expect(
      rendered.querySelector("[data-yunari-export-elsewhere]")?.textContent,
    ).toBe(uiCopy.assets.wallpaperEngine.scene.elsewhere);
  });

  it("guides an animated scene with text as a five-second MP4 at 30 fps", async () => {
    vi.useFakeTimers();
    const rendered = await mount({
      item: { ...animated, hasText: true },
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch: routedFetch({}).fetch },
    });

    expect(
      rendered.querySelector("[data-yunari-export-text-step]"),
    ).not.toBeNull();
    expect(rendered.textContent).toContain("MP4");
    expect(rendered.textContent).toContain("30 fps");
    expect(rendered.textContent).toContain("5 s");
    expect(rendered.textContent).toContain("1 s");
  });

  it("draws the text step only when the scene is known to hold text", async () => {
    vi.useFakeTimers();
    const rendered = await mount({
      item: { ...animated, hasText: undefined },
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch: routedFetch({}).fetch },
    });

    expect(rendered.querySelector("[data-yunari-export-text-step]")).toBeNull();
  });

  it("draws no text step for a still scene without text", async () => {
    vi.useFakeTimers();
    const rendered = await mount({
      item: { ...still, hasText: false },
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch: routedFetch({}).fetch },
    });

    expect(rendered.querySelector("[data-yunari-export-text-step]")).toBeNull();
  });

  it("unpacks on one press and prints the project name the host returned", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = routedFetch({
      project: () =>
        new Response(
          JSON.stringify({
            ok: true,
            name: "Neon loop",
            reused: false,
            launched: true,
          }),
          { status: 200 },
        ),
    });
    const rendered = await mount({
      item: animated,
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch },
    });

    press(rendered, "[data-yunari-export-open]");
    await flush();

    expect(calls.filter((call) => call.url.includes("/project"))).toHaveLength(
      1,
    );
    expect(
      calls.find((call) => call.url.includes("/project"))?.init?.method,
    ).toBe("POST");
    expect(rendered.textContent).toContain("Neon loop");
    expect(rendered.textContent).toContain(
      uiCopy.assets.wallpaperEngine.scene.launched("Neon loop"),
    );
  });

  it("says the project is ready when the editor did not launch", async () => {
    vi.useFakeTimers();
    const { fetch } = routedFetch({
      project: () =>
        new Response(
          JSON.stringify({
            ok: true,
            name: "Neon loop",
            reused: true,
            launched: false,
          }),
          { status: 200 },
        ),
    });
    const rendered = await mount({
      item: animated,
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch },
    });

    press(rendered, "[data-yunari-export-open]");
    await flush();

    expect(rendered.textContent).toContain(
      uiCopy.assets.wallpaperEngine.scene.ready("Neon loop"),
    );
    expect(rendered.textContent).not.toContain(
      uiCopy.assets.wallpaperEngine.scene.launched("Neon loop"),
    );
  });

  it("renders a refusal's reason and never retries by itself", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = routedFetch({
      project: () =>
        new Response(JSON.stringify({ ok: false, reason: "no-install" }), {
          status: 200,
        }),
    });
    const rendered = await mount({
      item: animated,
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch },
    });

    press(rendered, "[data-yunari-export-open]");
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS * 3);
    });

    expect(rendered.textContent).toContain("no-install");
    expect(calls.filter((call) => call.url.includes("/project"))).toHaveLength(
      1,
    );
  });

  it("offers the newest matching export and imports it on a press", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const { fetch } = routedFetch({
      exports: () => {
        polls += 1;
        return new Response(
          JSON.stringify({
            files:
              polls < 2
                ? []
                : [
                    {
                      name: "loop.mp4",
                      format: "mp4",
                      modified: 1_700_000_000_000,
                      size: 2_048,
                    },
                  ],
          }),
          { status: 200 },
        );
      },
      bytes: () =>
        new Response("mp4-bytes", {
          status: 200,
          headers: { "content-type": "video/mp4" },
        }),
    });
    const onImportFile = vi.fn(async (_file: File) => ({
      ok: true as const,
      assetId: "a1",
    }));
    const onImported = vi.fn();
    const rendered = await mount({
      item: animated,
      onImportFile,
      onImported,
      onDone: vi.fn(),
      client: { fetch },
    });

    expect(rendered.querySelector("[data-yunari-export-import]")).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    });
    expect(
      rendered.querySelector("[data-yunari-export-import]"),
    ).not.toBeNull();

    press(rendered, "[data-yunari-export-import]");
    await flush();

    expect(onImportFile).toHaveBeenCalledTimes(1);
    expect(onImportFile.mock.calls[0]?.[0]?.name).toBe("loop.mp4");
    expect(onImported).toHaveBeenCalledWith("a1");
  });

  it("stops watching once the sheet unmounts", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = routedFetch({});
    await mount({
      item: animated,
      onImportFile: vi.fn(async () => ({ ok: true as const, assetId: "a1" })),
      onImported: vi.fn(),
      onDone: vi.fn(),
      client: { fetch },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS);
    });
    const watched = calls.length;
    expect(watched).toBeGreaterThan(1);

    const mounted = root;
    root = undefined;
    await act(async () => {
      mounted?.unmount();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORT_POLL_MS * 3);
    });
    expect(calls.length).toBe(watched);
  });
});
