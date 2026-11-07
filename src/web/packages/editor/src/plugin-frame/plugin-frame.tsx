import type { FrameInit, FrameRequest } from "@yunari/extension-api";
import { useEffect, useRef, useState } from "react";
import { ACTION_BUTTON } from "../components/ui/dialog.js";
import { uiCopy } from "../ui-copy.js";
import { usePluginFrame } from "./use-plugin-frame.js";

export interface PluginFrameProps {
  readonly pluginKey: string;
  readonly entry: string;
  readonly title: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly theme: FrameInit["theme"];
  readonly onRequest: (
    request: FrameRequest,
    gestureToken: string | undefined,
  ) => Promise<unknown>;
  readonly onHeight?: (height: number) => void;
  /** A settings frame saves through `settings.set`, a write method. Only a
   *  control the host draws may mint the gesture token the write needs, so this
   *  option adds that control above the frame. A read-only body omits it. */
  readonly allowWrites?: boolean;
}

/** The route a plugin's own UI files are served from. The entry is a manifest
 *  path, but each segment is still encoded: the URL is the only place a
 *  separator could reappear. */
export function pluginFrameSrc(pluginKey: string, entry: string): string {
  const [publisher = "local", id = pluginKey] = pluginKey.split("/");
  const path = entry.split("/").map(encodeURIComponent).join("/");
  return `/api/extensions/${encodeURIComponent(publisher)}/${encodeURIComponent(id)}/ui/${path}`;
}

/**
 * One plugin's sandboxed UI.
 *
 * The frame gets `allow-scripts` and nothing else: no same-origin access, no
 * popups, no forms, no top navigation. Its only channel back is the nonce
 * protocol in `usePluginFrame`. A frame that fails to load shows the plugin's
 * name and a retry rather than an empty box, and the rest of the surface stays
 * usable.
 */
export function PluginFrame(props: PluginFrameProps): React.JSX.Element {
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const session = usePluginFrame({
    pluginKey: props.pluginKey,
    entry: props.entry,
    iframe,
    theme: props.theme,
    onRequest: props.onRequest,
    onResize: (next) => {
      setHeight(next);
      props.onHeight?.(next);
    },
  });

  // A settings change is the same `init` event with the newer values; the
  // frame never has to poll the host for its own settings.
  useEffect(() => {
    session.setSettings(props.settings);
  }, [props.settings, session.setSettings]);

  // The frame is a separate document, so its load failure is the element's own
  // error event rather than a message through the protocol.
  useEffect(() => {
    const element = iframe.current;
    if (element === null) return;
    const fail = (): void => setFailed(true);
    element.addEventListener("error", fail);
    return () => element.removeEventListener("error", fail);
  }, [attempt]);

  if (failed)
    return (
      <div
        data-yunari-plugin-frame-failed=""
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-[var(--space-8)] p-[var(--space-16)]"
      >
        <p className="m-0 text-sm text-muted">{props.title} could not load.</p>
        <button
          type="button"
          className={ACTION_BUTTON}
          onClick={() => {
            setFailed(false);
            setAttempt((current) => current + 1);
          }}
        >
          Retry
        </button>
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {props.allowWrites === true ? (
        <div className="flex items-center justify-end p-[var(--space-8)]">
          <button
            type="button"
            className={ACTION_BUTTON}
            onClick={() => {
              session.grantGesture();
            }}
          >
            {uiCopy.settings.extensions.frameEnableControls}
          </button>
        </div>
      ) : null}
      <iframe
        key={attempt}
        ref={iframe}
        title={props.title}
        src={pluginFrameSrc(props.pluginKey, props.entry)}
        sandbox="allow-scripts"
        className="min-h-0 w-full flex-1 border-0"
        style={height === undefined ? undefined : { height }}
      />
    </div>
  );
}
