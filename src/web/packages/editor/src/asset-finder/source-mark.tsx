import type * as React from "react";

/** The sources' own marks, from Simple Icons (CC0).
 *
 *  A card names its source by the mark its author already knows rather than by
 *  a licence word, which said what the row cost rather than where it came from.
 *  A source with no mark anywhere — Lineicons publishes no bundleable brand
 *  SVG — falls back to its monogram rather than to a blank corner. */
const MARKS: Readonly<Record<string, string>> = {
  lucide:
    "M18.483 1.123a1.09 1.09 0 0 0-.752.362 1.09 1.09 0 0 0 .088 1.54 11.956 11.956 0 0 1 4 8.946 7.62 7.62 0 0 1-7.637 7.636 7.62 7.62 0 0 1-7.637-7.636 3.255 3.255 0 0 1 3.273-3.273c1.82 0 3.273 1.45 3.273 3.273a1.09 1.09 0 0 0 1.09 1.09 1.09 1.09 0 0 0 1.092-1.09c0-3-2.455-5.455-5.455-5.455s-5.454 2.455-5.454 5.455c0 5.408 4.408 9.818 9.818 9.818 5.41 0 9.818-4.41 9.818-9.818A14.16 14.16 0 0 0 19.272 1.4a1.09 1.09 0 0 0-.789-.277ZM9.818 2.15C4.408 2.151 0 6.561 0 11.97a14.16 14.16 0 0 0 4.8 10.637 1.09 1.09 0 0 0 1.54-.096 1.09 1.09 0 0 0-.095-1.54 11.957 11.957 0 0 1-4.063-9 7.62 7.62 0 0 1 7.636-7.637 7.62 7.62 0 0 1 7.637 7.636 3.256 3.256 0 0 1-3.273 3.273 3.256 3.256 0 0 1-3.273-3.273 1.09 1.09 0 0 0-1.09-1.09 1.09 1.09 0 0 0-1.092 1.09c0 3 2.455 5.455 5.455 5.455s5.454-2.455 5.454-5.455c0-5.408-4.408-9.818-9.818-9.818z",
  "fontawesome-free":
    "M4.3934 4.5c.6837-.4317 1.1379-1.194 1.1379-2.0625C5.5313 1.0913 4.4398 0 3.0938 0 1.7475 0 .6563 1.0913.6563 2.4375c0 .7805.3668 1.4753.9375 1.9214V24h3v-3h17.5126c.6834 0 1.2373-.554 1.2373-1.2373a1.237 1.237 0 0 0-.1066-.5027l-2.8934-6.51 2.8934-6.51a1.237 1.237 0 0 0 .1066-.5026c0-.6834-.5539-1.2374-1.2373-1.2374Z",
  unsplash: "M7.5 6.75V0h9v6.75h-9zm9 3.75H24V24H0V10.5h7.5v6.75h9V10.5z",
};

/** A source with no logo anywhere still has two initials; one letter of
 *  "Color Hunt" and "ColorSwoop" would be the same mark twice in one grid. */
const MONOGRAMS: Readonly<Record<string, string>> = {
  colorhunt: "CH",
  colorswoop: "CS",
  uigradients: "UG",
  webgradients: "WG",
};

/** One source's mark, named for a screen reader by the source's own label. */
export function SourceMark({
  id,
  label,
}: {
  readonly id: string;
  readonly label: string;
}): React.JSX.Element {
  const mark = MARKS[id];
  if (mark === undefined) {
    const monogram = MONOGRAMS[id] ?? label.slice(0, 1);
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        data-yunari-asset-source={id}
        className={`inline-flex size-3.5 flex-none items-center justify-center rounded-[var(--radius-sm)] border border-edge font-medium text-muted uppercase ${
          monogram.length > 1 ? "text-[10px] tracking-tight" : "text-xs"
        }`}
      >
        {monogram}
      </span>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      data-yunari-asset-source={id}
      className="size-3.5 flex-none fill-current text-muted"
    >
      <path d={mark} />
    </svg>
  );
}
