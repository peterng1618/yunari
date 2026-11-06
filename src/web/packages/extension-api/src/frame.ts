import type { Capability } from "./capabilities";

/**
 * The editor/plugin frame protocol.
 *
 * The frame is a `sandbox="allow-scripts"` document with an opaque origin, so
 * `postMessage` is the only channel. Every request names its method, and the
 * method table below is the one owner of what that method may reach. Write
 * methods also carry a gesture token the editor minted from a host control; a
 * frame can never mint one itself.
 */
export type FrameMethod =
  | "settings.get"
  | "settings.set"
  | "asset.search"
  | "asset.bytes"
  | "ui.resize";

export interface FrameMethodEntry {
  /** The capability a request for this method must prove, or `null` when the
   *  method reaches nothing the plugin's consent must cover. */
  readonly capability: Capability | null;
  /** Whether the method changes state and therefore needs a gesture token. */
  readonly write: boolean;
}

export const FRAME_METHODS: Readonly<Record<FrameMethod, FrameMethodEntry>> = {
  "settings.get": { capability: "settings:own", write: false },
  "settings.set": { capability: "settings:own", write: true },
  "asset.search": { capability: "asset:provide", write: false },
  "asset.bytes": { capability: "asset:provide", write: false },
  "ui.resize": { capability: null, write: false },
};

/** Host-to-plugin: the initial settings and theme, once per frame load. A
 *  later `setSettings` re-sends the same event, never a second one. */
export interface FrameInit {
  readonly type: "yunari.frame.init";
  readonly nonce: string;
  readonly pluginKey: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly theme: {
    readonly palette: Readonly<Record<string, unknown>>;
    readonly typeTokens: Readonly<Record<string, unknown>>;
  };
}

/** Host-to-plugin: the one-use gesture token for the next write request. Sent
 *  only to the frame's own window, never broadcast. */
export interface FrameGesture {
  readonly type: "yunari.frame.gesture";
  readonly nonce: string;
  readonly token: string;
}

/** Plugin-to-host: one request for the editor to answer. */
export interface FrameRequest {
  readonly type: "yunari.frame.request";
  readonly nonce: string;
  readonly id: string;
  readonly method: FrameMethod;
  readonly params: unknown;
  readonly gestureToken?: string;
}

/** Editor-to-plugin: the answer to one request id. */
export interface FrameResult {
  readonly type: "yunari.frame.result";
  readonly id: string;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly reason?: string;
}

/** Plugin-to-editor: frame lifecycle. */
export interface FrameEvent {
  readonly type: "yunari.frame.event";
  readonly event: "resize" | "ready";
  readonly height?: number;
}

export type EditorFrameMessage = FrameInit | FrameGesture | FrameResult;
export type PluginFrameMessage = FrameRequest | FrameEvent;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  required: readonly string[],
): boolean {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) if (!known.has(key)) return false;
  for (const key of required) {
    if (!Object.hasOwn(value, key)) return false;
  }
  return true;
}

function readRequest(value: Readonly<Record<string, unknown>>): FrameRequest | undefined {
  if (
    !hasExactKeys(
      value,
      ["type", "nonce", "id", "method", "params", "gestureToken"],
      ["type", "nonce", "id", "method", "params"],
    )
  )
    return undefined;
  if (
    value["type"] !== "yunari.frame.request" ||
    !nonEmpty(value["nonce"]) ||
    !nonEmpty(value["id"])
  )
    return undefined;

  const method = value["method"];
  if (typeof method !== "string" || !Object.hasOwn(FRAME_METHODS, method))
    return undefined;
  const entry = FRAME_METHODS[method as FrameMethod];

  const gestureToken = value["gestureToken"];
  if (entry.write) {
    if (!nonEmpty(gestureToken)) return undefined;
  } else if (gestureToken !== undefined) {
    return undefined;
  }

  return {
    type: "yunari.frame.request",
    nonce: value["nonce"],
    id: value["id"],
    method: method as FrameMethod,
    params: value["params"],
    ...(gestureToken === undefined ? {} : { gestureToken }),
  };
}

function readEvent(value: Readonly<Record<string, unknown>>): FrameEvent | undefined {
  if (!hasExactKeys(value, ["type", "event", "height"], ["type", "event"]))
    return undefined;
  if (value["type"] !== "yunari.frame.event") return undefined;

  const event = value["event"];
  if (event === "ready") {
    return Object.hasOwn(value, "height")
      ? undefined
      : { type: "yunari.frame.event", event: "ready" };
  }
  if (event !== "resize") return undefined;

  const height = value["height"];
  if (
    typeof height !== "number" ||
    !Number.isFinite(height) ||
    height <= 0
  )
    return undefined;
  return { type: "yunari.frame.event", event: "resize", height };
}

/**
 * The frame message reader, total for hostile input: a wrong type, a nonce that
 * is not a string, an unknown or extra key, an event with a nonsensical height,
 * or a write without a gesture token all read as `undefined` rather than as a
 * partly trusted message.
 */
export function readPluginFrameMessage(
  value: unknown,
): PluginFrameMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (value["type"] === "yunari.frame.request") return readRequest(value);
  if (value["type"] === "yunari.frame.event") return readEvent(value);
  return undefined;
}
