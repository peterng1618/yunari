import {
  type PlanTextSegment,
  type ResolvedStyle,
  STYLE_PROPERTIES,
} from "@yunari/renderer-core";
import { paintFor } from "./paint.js";

/**
 * Convert styled runs to Fabric per-grapheme styles on one text object. The
 * splitter is injected so indices exactly match Fabric. Object-only properties
 * are reported when a run tries to override them.
 */

type FabricTextStyles = Readonly<
  Record<number, Readonly<Record<number, Readonly<Record<string, unknown>>>>>
>;

interface FabricTextShape {
  readonly text: string;
  readonly styles: FabricTextStyles;
  readonly unsupported: readonly string[];
}

type GraphemeSplitter = (value: string) => readonly string[];

/**
 * Fabric per-character key → authored properties that may feed it.
 *
 * `charSpacing` is deliberately absent: Fabric measures it once from the
 * object, so a per-character entry would be accepted and then ignored. The
 * object's own tracking is applied by `applyAuthoredText`/`refreshBoundText`
 * from the first run's resolved style, and a run that asks for a different
 * value is reported through `unsupported` below.
 */
const PER_RUN_PAINT_SOURCES: Readonly<Record<string, readonly string[]>> = {
  fill: ["color", "fill"],
  fontFamily: ["fontFamily"],
  fontSize: ["fontSize"],
  fontWeight: ["fontWeight"],
  stroke: ["strokeColor"],
  strokeWidth: ["strokeWidth"],
};

const PER_RUN_STYLE_PROPERTIES: readonly string[] = Object.values(
  PER_RUN_PAINT_SOURCES,
).flat();

type MutableStyles = Record<number, Record<number, Record<string, unknown>>>;

export function textShapeFor(
  segments: readonly PlanTextSegment[],
  nodeStyle: ResolvedStyle,
  splitGraphemes: GraphemeSplitter,
): FabricTextShape {
  const text = segments.map((segment) => segment.text).join("");

  if (segments.length <= 1) {
    // One run needs no per-character styles *when it agrees with the object*.
    // An author who styled that single run differently from its object must
    // still see it, so the authored keys are emitted rather than dropped.
    const only = segments[0];
    if (only === undefined) {
      return { text, styles: {}, unsupported: [] };
    }

    const paint = paintFor(only.style, "text");
    const authored = Object.fromEntries(
      Object.entries(paint).filter(([key]) =>
        (PER_RUN_PAINT_SOURCES[key] ?? []).some(
          (property) => property in only.style,
        ),
      ),
    );

    // Where the run resolves to what the object already paints, per-character
    // styles would be a second copy of one fact. Where it differs — the author
    // styled this run — they are the only way the difference can show.
    const nodePaint = paintFor(nodeStyle, "text");
    const differs = Object.entries(authored).some(
      ([key, value]) => nodePaint[key] !== value,
    );

    if (!differs) {
      return { text, styles: {}, unsupported: [] };
    }

    const unsupported: string[] = [];

    if (Object.keys(authored).length === 0) {
      return { text, styles: {}, unsupported: [] };
    }

    const perRun: MutableStyles = {};
    let line = 0;
    for (const [index, lineText] of only.text.split(/\r?\n/).entries()) {
      if (index > 0) line += 1;
      const target = (perRun[line] ??= {});
      for (
        let offset = 0;
        offset < splitGraphemes(lineText).length;
        offset += 1
      ) {
        target[offset] = authored;
      }
    }

    return { text, styles: perRun, unsupported };
  }

  const styles: MutableStyles = {};
  const unsupported = new Set<string>();

  let line = 0;
  let grapheme = 0;

  for (const segment of segments) {
    const paint = paintFor(segment.style, "text");
    // Per-character styles override object paint, so include authored keys only.
    const perRun = Object.fromEntries(
      Object.entries(paint).filter(([key]) =>
        (PER_RUN_PAINT_SOURCES[key] ?? []).some(
          (property) => property in segment.style,
        ),
      ),
    );

    for (const property of STYLE_PROPERTIES) {
      if (PER_RUN_STYLE_PROPERTIES.includes(property)) {
        continue;
      }

      if (
        property in segment.style &&
        segment.style[property] !== nodeStyle[property]
      ) {
        unsupported.add(property);
      }
    }

    const lines = segment.text.split(/\r?\n/);

    for (const [index, lineText] of lines.entries()) {
      if (index > 0) {
        line += 1;
        grapheme = 0;
      }

      const count = splitGraphemes(lineText).length;
      const target = (styles[line] ??= {});

      for (let offset = 0; offset < count; offset += 1) {
        target[grapheme + offset] = perRun;
      }

      grapheme += count;
    }
  }

  return { text, styles, unsupported: [...unsupported] };
}
