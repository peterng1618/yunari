import type { SampleSource } from "../data/source.js";
import type { Binding, ChartContent } from "../theme/document.js";
import { lineHistorySeconds } from "./line.js";

/**
 * What a chart's own plan would draw, as one string.
 *
 * **The pull is the family's own**, because a reading that is not what the
 * chart draws is not a reading. A gauge, a bar and a pie draw `latest`; a line
 * draws its trailing window, so its newest entry is what moves — read with the
 * same window the plan builder asks for, because a shorter one would miss a
 * sample that arrived late with an older timestamp.
 *
 * **A line's signature carries `nowMs`, because a line draws a window placed
 * from the clock.** Two frames with one sample between them draw two different
 * pictures; gating on the sample alone held a trends chart at its data's
 * cadence. Value families read `latest` and are clock-independent, so an idle
 * one is still skipped.
 *
 * A chart with no bindings draws a fixed placeholder, so its reading never
 * moves and it is drawn once.
 *
 * **Nothing is guaranteed about `history(small).at(-1)` being `latest`**: a
 * sample whose own timestamp runs ahead of the store's `lastNowMs` — reachable
 * with clock skew on a LAN device — is returned by `latest` and excluded by
 * `history`. Reading `history` for a gauge was how a bar kept drawing the old
 * value while its newest changed.
 *
 * Pass `playbackDelayMs` when the display's cadence overrides the source's
 * delay, so the signature asks for the history that will actually be drawn.
 */
export function chartReadingSignature(
  content: ChartContent,
  bindings: readonly Binding[],
  source: SampleSource,
  nowMs: number,
  playbackDelayMs?: number,
): string {
  const delayMs = playbackDelayMs ?? source.chartPlaybackDelayMs;
  const readings = bindings
    .map((binding) => {
      const sample =
        content.family === "line"
          ? source
              .history(
                binding.semanticKey,
                lineHistorySeconds(content.settings.windowSeconds, delayMs),
              )
              .at(-1)
          : source.latest(binding.semanticKey);
      return `${binding.id}:${sample?.status ?? "-"}:${
        sample?.timestamp ?? "-"
      }:${sample?.value ?? sample?.textValue ?? "-"}`;
    })
    .join("|");
  return content.family === "line" ? `${readings}|now:${nowMs}` : readings;
}
