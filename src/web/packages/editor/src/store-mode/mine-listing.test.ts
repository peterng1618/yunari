// @vitest-environment jsdom
/**
 * The online half's session probe, without a surface: the toggle is offered only
 * when the host holds a session, and the answer is asked again when the window
 * regains focus — which is when the sign-in flow in another window lands.
 *
 * **The transport is injected**, so every case here is the probe's own decisions
 * rather than a network's.
 */

import { catalogueIndexUrl } from "@yunari/renderer-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useMineListing } from "./mine-listing.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** The catalogue half reads the index through the global transport; an empty
 *  valid index keeps this test about the probe. */
const EMPTY_INDEX = JSON.stringify({
  generatedAt: "2026-10-21T00:00:00.000Z",
  entries: [],
});

/** Answers the session probe in call order; the last answer repeats. */
function probeFetch(
  answers: readonly boolean[],
): typeof fetch & { readonly calls: string[] } {
  const queue = [...answers];
  const calls: string[] = [];
  const stub = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const signedIn = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify({ signedIn }), { status: 200 });
  }) as typeof fetch & { readonly calls: string[] };
  Object.defineProperty(stub, "calls", { value: calls });
  return stub;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
  vi.unstubAllGlobals();
});

/** The hook, mounted under a probe and read back after every act. */
function mount(options: Parameters<typeof useMineListing>[1] = {}) {
  let latest: ReturnType<typeof useMineListing> | undefined;
  function Probe(): null {
    latest = useMineListing(undefined, options);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
  return (): ReturnType<typeof useMineListing> => {
    if (latest === undefined) throw new Error("the probe did not render");
    return latest;
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

it("re-probes the session when the window regains focus", async () => {
  vi.stubGlobal(
    "fetch",
    async () => new Response(EMPTY_INDEX, { status: 200 }),
  );
  const fetcher = probeFetch([false, true]);
  const read = mount({ fetch: fetcher });

  await flush();
  expect(read().offered).toBe(false);

  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(fetcher.calls).toEqual(["/api/store/session", "/api/store/session"]);
  expect(read().offered).toBe(true);
});

it("does not read the catalogue until its half is chosen", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return String(input).endsWith("/api/store/session")
      ? new Response(JSON.stringify({ signedIn: false }), { status: 200 })
      : new Response(EMPTY_INDEX, { status: 200 });
  });

  function Probe(props: { readonly enabled: boolean }): null {
    useMineListing(undefined, { enabled: props.enabled });
    return null;
  }

  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  root = createRoot(container);
  act(() => root?.render(createElement(Probe, { enabled: false })));
  await flush();

  // The region mounts on Themes' local half, so the remote catalogue must not
  // be on the path of that first paint.
  expect(calls).toEqual(["/api/store/session"]);

  act(() => root?.render(createElement(Probe, { enabled: true })));
  await flush();

  expect(calls).toEqual(["/api/store/session", catalogueIndexUrl()]);
});
