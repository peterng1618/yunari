// @vitest-environment jsdom

import type {
  AssetPage,
  AssetResult,
  AssetSourceListing,
} from "@yunari/renderer-core";
import type * as React from "react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as client from "./client.js";
import { FinderBody } from "./finder-body.js";
import { PLUGIN_BODY_REFUSAL, PluginBody } from "./plugin-body.js";

vi.mock("./client.js", () => ({
  searchAssets: vi.fn(),
  assetBytes: vi.fn(),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const searchAssets = vi.mocked(client.searchAssets);
const assetBytes = vi.mocked(client.assetBytes);

const SOURCE: AssetSourceListing = {
  id: "melody",
  label: "Melody",
  category: "audio",
  body: "melody",
  plugin: { key: "local/acme", ui: "ui/index.html" },
  requires: null,
  configurable: false,
  presetKind: null,
  host: null,
};

const RESULT: AssetResult = {
  id: "melody:1",
  name: "Blue",
  kind: "audio",
  preview: "",
  subtitle: undefined,
  licence: "unknown",
  sourceUrl: "https://api.acme.test/blue",
};

const PAGE: AssetPage = {
  source: "melody",
  results: [RESULT],
  totalPages: 2,
  failure: undefined,
};

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  searchAssets.mockReset();
  assetBytes.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

function render(element: ReactNode): void {
  act(() => root?.render(element));
}

function body(source: AssetSourceListing, plugin: boolean): React.JSX.Element {
  return (
    <FinderBody
      active={source.category}
      grid
      local={false}
      localUnavailable={undefined}
      library={undefined}
      libraryCount={0}
      localItems={[]}
      localSelection={undefined}
      localBusyId={undefined}
      localFailedId={undefined}
      localDone={new Set()}
      onSelectLocal={() => {}}
      onPreviewLocal={() => {}}
      onApplyLocal={() => {}}
      notice={undefined}
      empty={null}
      shownCount={0}
      loading={false}
      query=""
      cards={[]}
      selectedId={undefined}
      busyId={undefined}
      failedId={undefined}
      onSelect={() => {}}
      onPreview={() => {}}
      onApply={() => {}}
      onNeedMore={() => {}}
      canLoadMore={false}
      appending={false}
      {...(plugin
        ? {
            plugin: {
              source,
              page: PAGE,
              query: "",
              onQuery: () => {},
              onPage: () => {},
              onPick: () => {},
            },
          }
        : {})}
    />
  );
}

/** The frame's window and the messages the editor posted to it. */
function frame(): { readonly win: Window; readonly posted: unknown[] } {
  const element = container.querySelector("iframe");
  if (element === null) throw new Error("no frame");
  const win = element.contentWindow;
  if (win === null) throw new Error("no frame window");
  const posted: unknown[] = [];
  vi.spyOn(win, "postMessage").mockImplementation((message: unknown) => {
    posted.push(message);
  });
  return { win, posted };
}

async function ready(win: Window, posted: unknown[]): Promise<string> {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "yunari.frame.event", event: "ready" },
        source: win,
      }),
    );
  });
  const init = posted.find(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { type?: unknown }).type === "yunari.frame.init",
  ) as { nonce: string } | undefined;
  if (init === undefined) throw new Error("no init");
  return init.nonce;
}

async function request(
  win: Window,
  message: Readonly<Record<string, unknown>>,
): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", { data: message, source: win }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the plugin asset body", () => {
  it("renders the plugin frame for a custom body with ui:frame", () => {
    render(body(SOURCE, true));

    const element = container.querySelector("iframe");
    expect(element?.title).toBe("Melody");
    expect(element?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(element?.getAttribute("src")).toBe(
      "/api/extensions/local/acme/ui/ui/index.html",
    );
  });

  it("shows the refusal for a custom body without ui:frame", () => {
    render(body({ ...SOURCE, plugin: null }, true));

    expect(container.textContent).toContain(PLUGIN_BODY_REFUSAL);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("answers asset.search from the host and reports the question", async () => {
    const seen: { query?: string; page?: number; results?: AssetPage } = {};
    searchAssets.mockResolvedValue({ pages: [PAGE] });
    render(
      <PluginBody
        source={SOURCE}
        page={PAGE}
        query=""
        onQuery={(query) => {
          seen.query = query;
        }}
        onPage={(page) => {
          seen.page = page;
        }}
        onPick={() => {}}
        onResults={(page) => {
          seen.results = page;
        }}
      />,
    );

    const { win, posted } = frame();
    const nonce = await ready(win, posted);
    await request(win, {
      type: "yunari.frame.request",
      nonce,
      id: "r1",
      method: "asset.search",
      params: { query: "jazz", page: 2 },
    });

    expect(searchAssets).toHaveBeenCalledWith({
      query: "jazz",
      enabled: ["melody"],
      pages: { melody: 2 },
    });
    expect(seen).toEqual({ query: "jazz", page: 2, results: PAGE });
    expect(posted).toContainEqual({
      type: "yunari.frame.result",
      id: "r1",
      ok: true,
      value: { results: [RESULT], totalPages: 2 },
    });
  });

  it("answers asset.bytes as base64 and picks the chosen result", async () => {
    const picked: AssetResult[] = [];
    assetBytes.mockResolvedValue({
      bytes: new TextEncoder().encode("hi"),
      filename: "blue.mp3",
    });
    render(
      <PluginBody
        source={SOURCE}
        page={PAGE}
        query=""
        onQuery={() => {}}
        onPage={() => {}}
        onPick={(result) => picked.push(result)}
      />,
    );

    const { win, posted } = frame();
    const nonce = await ready(win, posted);
    await request(win, {
      type: "yunari.frame.request",
      nonce,
      id: "r2",
      method: "asset.bytes",
      params: { id: RESULT.id },
    });

    expect(assetBytes).toHaveBeenCalledWith("melody", RESULT.id);
    expect(picked).toEqual([RESULT]);
    expect(posted).toContainEqual({
      type: "yunari.frame.result",
      id: "r2",
      ok: true,
      value: { bytes: "aGk=", filename: "blue.mp3" },
    });
  });
});
