/**
 * The frame-timing windows the host owns, independent of where frames came
 * from. Frames arrive one at a time with the host's receipt time; each query
 * prunes what has aged out.
 *
 * `fps` is `1000 / mean(frametime)` over the last second. `low1` needs at least
 * 1000 frames inside the rolling 60-second window, then averages the slowest
 * `ceil(1%)` of those frametimes and converts that mean frametime back to FPS.
 * Converting the mean frametime (not averaging per-frame FPS) is the reading a
 * 1% low is defined by; the two differ whenever the slow frames differ from
 * each other.
 */

const FPS_WINDOW_MS = 1_000;
const LOW_WINDOW_MS = 60_000;
const LOW_MIN_FRAMES = 1_000;

interface Frametime {
  readonly frametimeMs: number;
  readonly atMs: number;
}

export class FrameWindow {
  #frames: Frametime[] = [];

  /** Ignores a frametime that is not a positive finite number. */
  add(frametimeMs: number, atMs: number): void {
    if (!Number.isFinite(frametimeMs) || frametimeMs <= 0) return;
    if (!Number.isFinite(atMs)) return;

    // Pruning is left to the next query: a reading is queried at least as often
    // as it arrives, and pruning here would copy the window on every frame.
    this.#frames.push({ frametimeMs, atMs });
  }

  fps(nowMs: number): number | undefined {
    const recent = this.#prune(nowMs).filter(
      (frame) => frame.atMs >= nowMs - FPS_WINDOW_MS,
    );

    if (recent.length === 0) return undefined;

    const total = recent.reduce((sum, frame) => sum + frame.frametimeMs, 0);
    return 1000 / (total / recent.length);
  }

  /** Undefined below 1000 frames in the window, as a 1% low needs a population. */
  low1(nowMs: number): number | undefined {
    const frames = this.#prune(nowMs);

    if (frames.length < LOW_MIN_FRAMES) return undefined;

    const sorted = frames
      .map((frame) => frame.frametimeMs)
      .sort((a, b) => a - b);
    const slowest = sorted.slice(-Math.ceil(sorted.length / 100));
    const total = slowest.reduce((sum, frametimeMs) => sum + frametimeMs, 0);

    return 1000 / (total / slowest.length);
  }

  #prune(nowMs: number): readonly Frametime[] {
    const kept = this.#frames.filter(
      (frame) => frame.atMs >= nowMs - LOW_WINDOW_MS,
    );
    this.#frames = kept;
    return kept;
  }
}
