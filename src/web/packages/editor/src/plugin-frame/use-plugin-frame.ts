import {
  FRAME_METHODS,
  type FrameInit,
  type FrameMethod,
  type FrameRequest,
  type FrameResult,
  readPluginFrameMessage,
} from "@yunari/extension-api";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** How long a host control's gesture stays usable. A token is also consumed by
 *  the first write, so a quick double click cannot spend two writes. */
export const GESTURE_LIFETIME_MS = 30_000;

export interface PluginFrameSession {
  readonly nonce: string;
  readonly ready: boolean;
  readonly error: string | undefined;
  request(method: FrameMethod, params: unknown): Promise<unknown>;
  grantGesture(): string;
  setSettings(settings: Readonly<Record<string, unknown>>): void;
}

export interface UsePluginFrameOptions {
  readonly pluginKey: string;
  readonly entry: string;
  readonly iframe: RefObject<HTMLIFrameElement | null>;
  readonly onRequest: (
    request: FrameRequest,
    gestureToken: string | undefined,
  ) => Promise<unknown>;
  readonly theme: FrameInit["theme"];
  readonly onResize?: (height: number) => void;
}

function token(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Answer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string };

/**
 * The editor side of the frame protocol.
 *
 * The iframe is an opaque-origin sandbox, so `event.origin` is `"null"` and is
 * never compared. A message is trusted only when it came from this frame's own
 * window and carries the nonce minted for this mount. The method table decides
 * which requests need a gesture; a gesture token is minted by a host control,
 * posted once to the frame, and consumed by the first write or after
 * `GESTURE_LIFETIME_MS`.
 *
 * Capability and consent are the host's call: `onRequest` rechecks both before
 * it touches settings or asset bytes, so the frame's own claim is never the
 * authority.
 */
export function usePluginFrame(
  options: UsePluginFrameOptions,
): PluginFrameSession {
  const [nonce] = useState(token);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const readyRef = useRef(false);
  const settingsRef = useRef<Readonly<Record<string, unknown>>>({});
  const themeRef = useRef(options.theme);
  themeRef.current = options.theme;
  const gestureRef = useRef<
    { readonly token: string; readonly expiresAt: number } | undefined
  >(undefined);
  const idRef = useRef(0);

  const post = useCallback(
    (message: unknown) => {
      options.iframe.current?.contentWindow?.postMessage(message, "*");
    },
    [options.iframe],
  );

  const init = useCallback(() => {
    post({
      type: "yunari.frame.init",
      nonce,
      pluginKey: options.pluginKey,
      settings: settingsRef.current,
      theme: themeRef.current,
    } satisfies FrameInit);
  }, [nonce, options.pluginKey, post]);

  /** A gesture is one token, one write, thirty seconds. */
  const takeGesture = (): string | undefined => {
    const granted = gestureRef.current;
    gestureRef.current = undefined;
    if (granted === undefined || Date.now() > granted.expiresAt)
      return undefined;
    return granted.token;
  };

  const dispatch = useCallback(
    async (
      method: FrameMethod,
      params: unknown,
      suppliedToken: string | undefined,
      requestId?: string,
    ): Promise<Answer> => {
      const entry = FRAME_METHODS[method];
      let gestureToken: string | undefined;

      if (entry.write) {
        const granted = takeGesture();
        if (
          granted === undefined ||
          (suppliedToken !== undefined && suppliedToken !== granted)
        )
          return {
            ok: false,
            reason: "This control needs a gesture from a host control.",
          };
        gestureToken = granted;
      }

      try {
        return {
          ok: true,
          value: await options.onRequest(
            {
              type: "yunari.frame.request",
              nonce,
              id: requestId ?? `req-${++idRef.current}`,
              method,
              params,
              ...(gestureToken === undefined ? {} : { gestureToken }),
            },
            gestureToken,
          ),
        };
      } catch (refusal: unknown) {
        return { ok: false, reason: messageOf(refusal) };
      }
    },
    [nonce, options.onRequest],
  );

  const answer = useCallback(
    async (message: FrameRequest) => {
      const result = await dispatch(
        message.method,
        message.params,
        message.gestureToken,
        message.id,
      );
      const answer: FrameResult = {
        type: "yunari.frame.result",
        id: message.id,
        ...(result.ok
          ? { ok: true, value: result.value }
          : { ok: false, reason: result.reason }),
      };
      post(answer);
    },
    [dispatch, post],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== options.iframe.current?.contentWindow) return;

      const message = readPluginFrameMessage(event.data);
      if (message === undefined) return;

      if (message.type === "yunari.frame.request") {
        // A valid nonce is the only credential a read needs; a write still
        // needs the gesture consumed inside `dispatch`.
        if (message.nonce !== nonce) return;
        void answer(message);
        return;
      }

      if (message.event === "ready") {
        readyRef.current = true;
        setReady(true);
        init();
        return;
      }

      if (message.height !== undefined) options.onResize?.(message.height);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [answer, init, nonce, options.iframe, options.onResize]);

  const request = useCallback(
    async (method: FrameMethod, params: unknown): Promise<unknown> => {
      const result = await dispatch(method, params, undefined);
      if (!result.ok) {
        setError(result.reason);
        throw new Error(result.reason);
      }
      return result.value;
    },
    [dispatch],
  );

  const grantGesture = useCallback((): string => {
    const minted = token();
    gestureRef.current = {
      token: minted,
      expiresAt: Date.now() + GESTURE_LIFETIME_MS,
    };
    post({ type: "yunari.frame.gesture", nonce, token: minted });
    return minted;
  }, [nonce, post]);

  const setSettings = useCallback(
    (settings: Readonly<Record<string, unknown>>): void => {
      settingsRef.current = settings;
      if (readyRef.current) init();
    },
    [init],
  );

  return useMemo(
    () => ({
      nonce,
      ready,
      error,
      request,
      grantGesture,
      setSettings,
    }),
    [error, grantGesture, nonce, ready, request, setSettings],
  );
}
