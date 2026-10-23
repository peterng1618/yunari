import { parseColor } from "@yunari/renderer-core";
import { ColourPicker } from "./colour-picker.js";

/** One authored stop: where it sits along the gradient, and what colour it is. */
interface GradientStop {
  readonly offset: number;
  readonly color: string;
}

/**
 * The gradient editor, sharing the picker's parts.
 *
 * The palette's gradients carry an angle and any number of stops, so a
 * two-stop editor would not do — and the stops are what the colour picker edits,
 * one picker per stop, rather than a second colour vocabulary.
 *
 * The track is the whole affordance: an author moves a stop by dragging it, and
 * sees the gradient it produces while they do. The number fields beside the
 * palette's existing ones stay for exact entry, because a drag cannot land on
 * 0.37 exactly.
 */
export function GradientEditor({
  stops,
  angle,
  onChange,
  label,
}: {
  readonly stops: readonly GradientStop[];
  readonly angle: number;
  readonly onChange: (next: { stops: GradientStop[]; angle: number }) => void;
  readonly label: string;
}): React.JSX.Element {
  const ordered = [...stops].sort((a, b) => a.offset - b.offset);
  const css = `linear-gradient(${90 - angle}deg, ${ordered
    .map((stop) => `${stop.color} ${Math.round(stop.offset * 100)}%`)
    .join(", ")})`;

  const move = (index: number, offset: number): void => {
    const clamped = Math.min(1, Math.max(0, offset));
    onChange({
      angle,
      stops: stops.map((stop, i) =>
        i === index ? { ...stop, offset: clamped } : stop,
      ),
    });
  };

  return (
    <div className="space-y-2">
      <div
        data-testid="gradient-preview"
        aria-label={label}
        className="h-10 w-full rounded-sm border border-neutral-700"
        style={{ background: css }}
      />
      <div
        data-testid="gradient-track"
        role="group"
        aria-label={label}
        className="relative h-6 w-full rounded-sm border border-neutral-700"
        style={{ background: css }}
      >
        {ordered.map((stop) => {
          const index = stops.findIndex(
            (candidate) => candidate.offset === stop.offset,
          );
          const left = `${stop.offset * 100}%`;
          return (
            <button
              key={`${index}-${stop.offset}`}
              type="button"
              data-testid={`gradient-stop-${index}`}
              aria-label={`${label} stop ${index + 1}`}
              aria-valuenow={Math.round(stop.offset * 100)}
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 border-white"
              style={{
                left,
                background: stop.color,
                // §4's boundary role, not a shadow: the 1px spread separates the
                // dot from the track beneath it, which is separation rather than
                // altitude (`--elev-*` are offset-and-blur depths).
                boxShadow: "0 0 0 1px var(--edge)",
              }}
              onPointerDown={(event) => {
                const track =
                  event.currentTarget.parentElement?.getBoundingClientRect();
                if (track === undefined || track.width === 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                move(index, (event.clientX - track.left) / track.width);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 0) return;
                const track =
                  event.currentTarget.parentElement?.getBoundingClientRect();
                if (track === undefined || track.width === 0) return;
                move(index, (event.clientX - track.left) / track.width);
              }}
            />
          );
        })}
      </div>
      {/* A picker per stop, always visible rather than behind a click.

          The palette panel rebuilds its own DOM on every redraw, so React state
          saying "this stop is open" would be destroyed by the next commit — the
          popover would close on the pick that applied it. Inline avoids the
          state entirely, and a popover closing after each pick is the behaviour
          an author wants anyway. */}
      <div className="flex flex-wrap gap-3">
        {stops.map((stop, index) => (
          <div key={index} className="flex items-center gap-1">
            <ColourPicker
              label={`${label} stop ${index + 1}`}
              value={stop.color}
              onValueChange={(color) =>
                onChange({
                  angle,
                  stops: stops.map((candidate, i) =>
                    i === index ? { ...candidate, color } : candidate,
                  ),
                })
              }
              onValueCommit={(color) =>
                onChange({
                  angle,
                  stops: stops.map((candidate, i) =>
                    i === index ? { ...candidate, color } : candidate,
                  ),
                })
              }
            />
            <span className="font-mono text-xs text-neutral-300">
              {stop.color}
              {parseColor(stop.color) === undefined
                ? " — not a colour the browser can paint"
                : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
