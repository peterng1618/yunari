import type { SampleSource } from "../data/source.js";
import type { Binding, ChartContent } from "../theme/document.js";
import type { FabricPalette } from "../theme/fabric-envelope.js";
import { chartPaintReferences } from "./chart-paint.js";
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
 * **The palette is an input to the plan, not to the document.** A chart's
 * settings name the tokens they paint with, so the values of those tokens are
 * part of what the chart would draw; a token the chart does not name is not.
 * Without that, a live palette sample forced every chart to redraw.
 */
export function chartReadingSignature(
  content: ChartContent,
  bindings: readonly Binding[],
  source: SampleSource,
  nowMs: number,
  palette?: FabricPalette,
): string {
  const readings = bindings
    .map((binding) => {
      const sample =
        content.family === "line"
          ? source
              .history(
                binding.semanticKey,
                lineHistorySeconds(
                  content.settings.windowSeconds,
                  source.chartPlaybackDelayMs,
                ),
              )
              .at(-1)
          : source.latest(binding.semanticKey);
      return `${binding.id}:${sample?.status ?? "-"}:${
        sample?.timestamp ?? "-"
      }:${sample?.value ?? sample?.textValue ?? "-"}`;
    })
    .join("|");
  const drawn =
    content.family === "line" ? `${readings}|now:${nowMs}` : readings;
  return `${inkSignature(content.settings, palette)}|${drawn}`;
}

/** The palette values the chart's own settings name, as one comparable string. */
function inkSignature(
  settings: unknown,
  palette: FabricPalette | undefined,
): string {
  const refs = chartPaintReferences(settings);
  if (refs.length === 0) return "";
  return refs
    .map((ref) => {
      const id = ref.startsWith("palette.")
        ? ref.slice("palette.".length)
        : undefined;
      const value = id === undefined ? undefined : palette?.[id]?.value;
      return `${ref}=${value === undefined ? "-" : JSON.stringify(value)}`;
    })
    .join("|");
}
