// @vitest-environment jsdom
/**
 * The library half's submission flow, without a surface: what the host is
 * asked, when the sign-in window is opened, and what the author is told.
 *
 * **The transport and the window are injected**, so every case here is the
 * flow's own decisions rather than a DOM's, and a poll is advanced with fake
 * timers rather than waited for.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { uiCopy } from "../ui-copy.js";
import { DARK_GROUND, fixtureItem } from "./item-fixture.js";
import type { StoreItem } from "./local-source.js";
import { useSubmit } from "./use-submit.js";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ITEM: StoreItem = fixtureItem({
  id: "living-room",
  name: "Living room",
  ground: DARK_GROUND,
});

const SIGN_IN_URL = "https://store.test/auth/start?provider=github";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A transport answering in call order; the last answer repeats, so a poll can
 *  be advanced past the number of answers a case wrote. */
function sequenceFetch(
  answers: readonly Response[],
): typeof fetch & { readonly calls: string[] } {
  const queue = [...answers];
  const calls: string[] = [];
  const stub = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    return answer?.clone() ?? new Response("", { status: 500 });
  }) as typeof fetch & { calls: string[] };
  Object.defineProperty(stub, "calls", { value: calls });
  return stub;
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

async function unmount(): Promise<void> {
  const mounted = root;
  root = undefined;
  host?.remove();
  host = undefined;
  if (mounted !== undefined) await act(async () => mounted.unmount());
}

afterEach(async () => {
  await unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The hook, mounted under a probe and read back after every act. */
function mount(options: Parameters<typeof useSubmit>[0]) {
  let latest: ReturnType<typeof useSubmit> | undefined;
  function Probe(): null {
    latest = useSubmit(options);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  host = container;
  root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
  return (): ReturnType<typeof useSubmit> => {
    if (latest === undefined) throw new Error("the probe did not render");
    return latest;
  };
}

/** Four microtask turns: enough for the fetch promise chain to land. */
async function flush(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
}

function popup(): { readonly close: ReturnType<typeof vi.fn> } {
  return { close: vi.fn() };
}

/**
 * **A 401 starts the host's sign-in, and the poll's truth is the popup's close.**
 * The window's address is the host's answer rather than a hardcoded page, the
 * flow retries the submission exactly once, and the author is told which state
 * the store put the item in.
 */
it("opens the host's sign-in window, retries once, and reports pending", async () => {
  vi.useFakeTimers();
  const window = popup();
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in to the Yunari store first." }, 401),
    json({ url: SIGN_IN_URL }),
    json({ signedIn: true, email: "author@example.test" }),
    json({
      ok: true,
      status: "pending",
      version: { from: null, to: "1.0.0", level: "initial" },
    }),
  ]);
  const openWindow = vi.fn(() => window as never);
  const submit = mount({ fetch, openWindow });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();

  expect(submit().control.state, "the flow is not authorising").toBe(
    "authorising",
  );
  expect(
    openWindow.mock.calls,
    "the popup did not open at the address the host answered",
  ).toEqual([[SIGN_IN_URL]]);
  expect(fetch.calls, "the host was not asked for a sign-in").toEqual([
    "/api/themes/submit",
    "/api/store/auth/start",
  ]);

  await advance(1_000);

  expect(
    window.close,
    "the popup was left open after the session landed",
  ).toHaveBeenCalledTimes(1);
  expect(submit().control.state, "the retry did not land").toBe("submitted");
  expect(submit().control.status, "the status word is not the host's").toBe(
    "pending",
  );
  expect(
    submit().control.version,
    "the published version is not the host's",
  ).toEqual({ from: null, to: "1.0.0", level: "initial" });
  expect(
    fetch.calls.filter((call) => call === "/api/themes/submit"),
    "the poll's sign-in did not retry the submission exactly once",
  ).toHaveLength(2);
  expect(
    openWindow,
    "a second sign-in window was opened",
  ).toHaveBeenCalledTimes(1);
});

/**
 * **The poll gives up after five minutes**, and the author is told the store
 * never confirmed the sign-in rather than being left waiting.
 */
it("refuses when the sign-in is never confirmed", async () => {
  vi.useFakeTimers();
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in." }, 401),
    json({ url: SIGN_IN_URL }),
    json({ signedIn: false }),
  ]);
  const submit = mount({ fetch, openWindow: () => popup() as never });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();
  await advance(300_000);

  expect(submit().control.state, "the five-minute cap was not reached").toBe(
    "refused",
  );
  expect(submit().control.refusal, "the cap stated no sentence").toBe(
    uiCopy.store.submit.noSignIn,
  );
  expect(
    fetch.calls.filter((call) => call === "/api/store/session"),
    "the poll did not run for the whole five minutes",
  ).toHaveLength(300);
});

/**
 * **A 401 after the sign-in is the same refusal**, because the host holds no
 * session it can use and a second authorisation would loop.
 */
it("refuses when the retry is still unauthorised", async () => {
  vi.useFakeTimers();
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in." }, 401),
    json({ url: SIGN_IN_URL }),
    json({ signedIn: true }),
    json({ ok: false, message: "Sign in." }, 401),
  ]);
  const submit = mount({ fetch, openWindow: () => popup() as never });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();
  await advance(1_000);

  expect(submit().control.state, "the unauthorised retry was not refused").toBe(
    "refused",
  );
  expect(submit().control.refusal, "the retry stated the wrong sentence").toBe(
    uiCopy.store.submit.noSignIn,
  );
  expect(
    fetch.calls.filter((call) => call === "/api/themes/submit"),
    "the retry was attempted more than once",
  ).toHaveLength(2);
});

/** **The host's own sentence is the refusal**, wherever it is a non-2xx. */
it("states the host's refusal for an unexpected answer", async () => {
  const fetch = sequenceFetch([
    json({ ok: false, message: "That theme has no picture." }, 422),
  ]);
  const submit = mount({ fetch, openWindow: () => popup() as never });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();

  expect(submit().control.state, "the refusal did not land").toBe("refused");
  expect(submit().control.refusal, "the refusal is not the host's").toBe(
    "That theme has no picture.",
  );
});

/**
 * **A 2xx this surface cannot draw is named, not dumped.** A state outside the
 * two a footer shows leaves the author with a sentence about the store, never
 * the answer's JSON.
 */
it("names an unexpected status instead of drawing the answer's body", async () => {
  const fetch = sequenceFetch([
    json({
      ok: true,
      status: "draft",
      version: { from: null, to: "1.0.0", level: "initial" },
    }),
  ]);
  const submit = mount({ fetch, openWindow: () => popup() as never });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();

  expect(submit().control.state, "the odd answer was not refused").toBe(
    "refused",
  );
  expect(submit().control.refusal, "the odd answer's body was drawn").toBe(
    uiCopy.store.submit.unexpectedState("draft"),
  );
});

/** **A thrown transport is a refusal with its message**, not a stuck control. */
it("refuses with a thrown transport's message", async () => {
  const failingFetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const submit = mount({
    fetch: failingFetch,
    openWindow: () => popup() as never,
  });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();

  expect(submit().control.state, "a thrown fetch left the flow alive").toBe(
    "refused",
  );
  expect(submit().control.refusal).toBe("Failed to fetch");
});

/** **One flow at a time**: a second press meets the guard and asks nothing. */
it("ignores a second press while a flow is live", async () => {
  vi.useFakeTimers();
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in." }, 401),
    json({ url: SIGN_IN_URL }),
    json({ signedIn: false }),
  ]);
  const submit = mount({ fetch, openWindow: () => popup() as never });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();
  await act(async () => submit().control.onSubmit(ITEM));
  await flush();

  expect(
    fetch.calls.filter((call) => call === "/api/themes/submit"),
    "a second press sent a second submission",
  ).toHaveLength(1);
  expect(
    fetch.calls.filter((call) => call === "/api/store/auth/start"),
    "a second press started a second sign-in",
  ).toHaveLength(1);
});

/** **A blocked window is named**, the control becomes pressable again, and no
 *  poll is scheduled for a window that was never made. */
it("refuses when the browser blocks the sign-in window", async () => {
  vi.useFakeTimers();
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in." }, 401),
    json({ url: SIGN_IN_URL }),
  ]);
  const submit = mount({ fetch, openWindow: () => null });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();
  await advance(2_000);

  expect(submit().control.state).toBe("refused");
  expect(submit().control.refusal).toBe(uiCopy.store.submit.blocked);
  expect(
    fetch.calls.filter((call) => call === "/api/store/session"),
    "a poll ran for a window that never opened",
  ).toHaveLength(0);
});

/** **An address this surface may not open is not one it claims**, so a `http`
 *  answer or an absent one refuses before any window is made. */
it("refuses a sign-in address that is not https", async () => {
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in." }, 401),
    json({ url: "http://store.test/auth" }),
  ]);
  const openWindow = vi.fn(() => popup() as never);
  const submit = mount({ fetch, openWindow });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();

  expect(submit().control.state).toBe("refused");
  expect(
    openWindow,
    "an insecure address opened a window",
  ).not.toHaveBeenCalled();
});

/** **Unmount clears the poll**: a timer scheduled before the surface is gone
 *  does not fire against a hook that no longer exists. */
it("stops polling after unmount", async () => {
  vi.useFakeTimers();
  const fetch = sequenceFetch([
    json({ ok: false, message: "Sign in." }, 401),
    json({ url: SIGN_IN_URL }),
    json({ signedIn: false }),
  ]);
  const submit = mount({ fetch, openWindow: () => popup() as never });

  await act(async () => submit().control.onSubmit(ITEM));
  await flush();
  await unmount();
  await advance(5_000);

  expect(
    fetch.calls.filter((call) => call === "/api/store/session"),
    "a poll fired after the hook unmounted",
  ).toHaveLength(0);
});

const INCLUDE_ID = "3f2a1c9e-8b7d-4c6a-9e0f-1a2b3c4d5e6f";

const DRAFT = {
  name: "Acme Kit",
  description: "Two walls",
  includes: [{ id: INCLUDE_ID, optional: true }],
} as const;

/** A transport that keeps each request's URL and parsed body. */
function recordingFetch(answers: readonly Response[]): typeof fetch & {
  readonly calls: readonly {
    readonly url: string;
    readonly body: unknown;
  }[];
} {
  const queue = [...answers];
  const calls: { url: string; body: unknown }[] = [];
  const stub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const answer = queue.length > 1 ? queue.shift() : queue[0];
    return answer?.clone() ?? new Response("", { status: 500 });
  }) as typeof fetch & { calls: typeof calls };
  Object.defineProperty(stub, "calls", { value: calls });
  return stub;
}

/**
 * **A collection is submitted as its draft**: the host packages it with the
 * format's one writer and holds the store token, so the browser posts no bytes,
 * no digest and no listing id of its own.
 */
it("submits a collection draft for the host to package", async () => {
  const fetch = recordingFetch([
    json({
      ok: true,
      status: "published",
      version: { from: null, to: "1.0.0", level: "initial" },
    }),
  ]);
  const submit = mount({ fetch });

  await act(async () => submit().collection.onSubmit({ draft: DRAFT }));
  await vi.waitFor(() =>
    expect(fetch.calls.length, "the hook posted nothing").toBe(1),
  );
  await flush();

  const [call, ...extra] = fetch.calls;
  if (call === undefined) throw new Error("the hook posted nothing");
  expect(extra, "the hook posted more than once").toHaveLength(0);
  expect(call.url).toBe("/api/themes/submit");
  expect(call.body).toEqual({
    kind: "collection",
    name: DRAFT.name,
    description: DRAFT.description,
    includes: [{ id: INCLUDE_ID, optional: true }],
  });
  expect(submit().collection.state).toBe("submitted");
  expect(submit().collection.status).toBe("published");
});

/** **A draft is refused before the host is asked**, with the reader's own
 *  sentence, so a missing include costs no request. */
it("refuses a collection draft locally, naming the field", async () => {
  const fetch = recordingFetch([
    json({
      ok: true,
      status: "published",
      version: { from: null, to: "1.0.0", level: "initial" },
    }),
  ]);
  const submit = mount({ fetch });

  await act(async () =>
    submit().collection.onSubmit({
      draft: { name: "Acme Kit", description: "", includes: [] },
    }),
  );
  await flush();

  expect(fetch.calls, "a refused draft reached the host").toHaveLength(0);
  expect(submit().collection.state).toBe("refused");
  expect(submit().collection.refusal).toMatch(/include/);
});

/** **Self-reference is its own check, because only the listing's own id can
 *  answer it.** A new collection has no id yet, so nothing is compared; a draft
 *  that names the existing listing it publishes to is refused here. */
it("refuses a collection that includes its own listing", async () => {
  const fetch = recordingFetch([
    json({
      ok: true,
      status: "published",
      version: { from: null, to: "1.0.0", level: "initial" },
    }),
  ]);
  const submit = mount({ fetch });

  await act(async () =>
    submit().collection.onSubmit({
      listingId: INCLUDE_ID,
      draft: DRAFT,
    }),
  );
  await flush();

  expect(fetch.calls, "a self-referencing draft reached the host").toHaveLength(
    0,
  );
  expect(submit().collection.refusal).toMatch(/itself/);
});
