import {
  VIDEO_LIMITS,
  VIDEO_TRIM,
  type VideoTrimRange,
} from "@yunari/theme-package";
import type * as React from "react";
import { useEffect, useRef, useState } from "react";
import { ACTION_BUTTON, Dialog } from "../../components/ui/dialog.js";
import { uiCopy } from "../../ui-copy.js";

export interface VideoTrimModalProps {
  /** A URL the video element can stream: an object URL for a picked file, the
   *  host's asset route for a Wallpaper Engine item. */
  readonly src: string;
  readonly name: string;
  /** `undefined` is the whole file: no cut, so the host re-encodes without a
   *  loop blend. */
  readonly onConfirm: (trim: VideoTrimRange | undefined) => void;
  readonly onClose: () => void;
}

/**
 * The one trim surface a video import passes through.
 *
 * A player and a two-ended timeline, before the host normalizer runs: a long
 * source is cut to the author's span there, and only a cut span is blended at
 * the loop seam. The whole-file answer is a first-class button rather than a
 * pair of handles dragged to the ends, so an untrimmed import cannot depend on
 * a reader knowing that the default means "no cut".
 */
export function VideoTrimModal({
  src,
  name,
  onConfirm,
  onClose,
}: VideoTrimModalProps): React.JSX.Element {
  const copy = uiCopy.panels.trimVideo;
  const video = useRef<HTMLVideoElement>(null);
  const [durationMs, setDurationMs] = useState<number>();
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = video.current;
    if (element === null) return;
    // The playhead follows the in point, so a handle drag shows the frame the
    // cut would keep rather than leaving the player wherever it was.
    element.currentTime = startMs / 1000;
  }, [startMs]);

  const whole = durationMs === undefined;
  const span = durationMs === undefined ? 0 : endMs - startMs;
  // The host refuses a whole file past the cap, so the shortcut is closed
  // rather than offered and then refused.
  const tooLong =
    durationMs !== undefined && durationMs > VIDEO_LIMITS.maxDurationMs;

  const clampStart = (next: number): void => {
    const highest = Math.max(0, endMs - VIDEO_TRIM.minSpanMs);
    setStartMs(Math.min(Math.max(0, Math.round(next)), highest));
  };
  const clampEnd = (next: number): void => {
    const lowest = Math.min(durationMs ?? 0, startMs + VIDEO_TRIM.minSpanMs);
    setEndMs(Math.max(lowest, Math.min(Math.round(next), durationMs ?? 0)));
  };

  const confirm = (trim: VideoTrimRange | undefined): void => {
    // A pause before the surface closes: the chosen in point is the last frame
    // the author looked at.
    video.current?.pause();
    onConfirm(trim);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={copy.title}
      closeLabel={uiCopy.assets.close}
      closeIcon
      className="editor-shell-dialog--video-trim"
    >
      <div
        data-yunari-video-trim-modal=""
        className="flex w-[var(--import-dialog-width)] flex-col gap-[var(--space-10)]"
      >
        <span className="break-words pr-[var(--space-32)] text-sm font-semibold text-text [overflow-wrap:anywhere]">
          {name}
        </span>
        <video
          ref={video}
          data-yunari-video-trim-player=""
          src={src}
          controls
          preload="metadata"
          className="max-h-[40vh] w-full rounded-[var(--radius-md)] bg-black"
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (!Number.isFinite(seconds) || seconds <= 0) {
              setFailed(true);
              return;
            }
            setDurationMs(Math.round(seconds * 1000));
            setEndMs(Math.round(seconds * 1000));
          }}
          onError={() => {
            setFailed(true);
          }}
        />

        {failed ? (
          <p role="alert" className="m-0 text-sm text-text">
            {copy.unplayable}
          </p>
        ) : null}

        {whole || failed ? null : (
          <div className="flex flex-col gap-[var(--space-4)]">
            <span className="text-xs text-muted">{copy.hint}</span>
            <div className="flex items-center gap-[var(--space-8)]">
              <label className="flex min-w-0 flex-1 flex-col gap-[var(--space-4)] text-2xs text-faint">
                {copy.start}
                <input
                  data-yunari-video-trim-start=""
                  type="range"
                  min={0}
                  max={durationMs}
                  step={100}
                  value={startMs}
                  aria-valuetext={secondsText(startMs)}
                  onChange={(event) => {
                    clampStart(Number(event.target.value));
                  }}
                  className="w-full"
                />
              </label>
              <label className="flex min-w-0 flex-1 flex-col gap-[var(--space-4)] text-2xs text-faint">
                {copy.end}
                <input
                  data-yunari-video-trim-end=""
                  type="range"
                  min={0}
                  max={durationMs}
                  step={100}
                  value={endMs}
                  aria-valuetext={secondsText(endMs)}
                  onChange={(event) => {
                    clampEnd(Number(event.target.value));
                  }}
                  className="w-full"
                />
              </label>
            </div>
            {tooLong ? (
              <span className="text-xs text-muted">
                {copy.tooLong(secondsText(VIDEO_LIMITS.maxDurationMs))}
              </span>
            ) : null}
            <span data-yunari-video-trim-span="" className="text-xs text-text">
              {copy.selection(secondsText(startMs), secondsText(endMs))}
              {" · "}
              {copy.output(secondsText(span - VIDEO_TRIM.blendMs))}
            </span>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-[var(--space-6)]">
          <button
            type="button"
            data-yunari-video-trim-whole=""
            className={ACTION_BUTTON}
            disabled={tooLong}
            onClick={() => {
              confirm(undefined);
            }}
          >
            {copy.useWhole}
          </button>
          {whole || failed ? null : (
            <button
              type="button"
              data-yunari-video-trim-confirm=""
              className={ACTION_BUTTON}
              onClick={() => {
                const full = startMs === 0 && endMs === durationMs;
                confirm(full ? undefined : { startMs, endMs });
              }}
            >
              {copy.confirm}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** A range's end, as a short clock. */
function secondsText(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100) / 10);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(1).padStart(4, "0")}`;
}
