import {
  defaultBarSettings,
  defaultGaugeSettings,
  defaultLineSettings,
} from "@yunari/renderer-core";
import { type StarterPaletteId } from "./new-fabric-theme-globals.js";
import { starterIcons } from "./new-fabric-theme-icons.js";
import {
  cardGroup,
  chart,
  frostedCard,
  label,
  type ObjectJson,
  path,
  type Run,
  text,
  valueLabel,
} from "./new-fabric-theme-objects.js";
import { uiCopy } from "./ui-copy.js";

/**
 * The starter composition, one builder per card.
 *
 * Every builder returns one Fabric group over the card's parts. The positions
 * and sizes below are the starter's authored artboard geometry at 1672 × 941:
 * the card borders are two-pixel outlines, the text and icons sit inside each
 * card, and the rings are stroked shapes. `cardGroup` is what turns those
 * artboard numbers into the group-local ones the document stores, so nothing
 * here has to be re-measured. Two deliberate departures from a literal
 * three-column layout are named here — the trends card spans the full left
 * column rather than leaving a 254-unit gap for the coffee mug, and both ring
 * labels share one offset rather than disagreeing by 15 units between the two
 * cards.
 *
 * What is not here is anything no provider supplies. The starter names its
 * CPU and GPU models and its storage volume; those three captions are bindings
 * like any other reading, so a machine that cannot say one shows a gap instead
 * of a stand-in name, and a card's name always describes the figures beside it.
 */

/** `defaultLineSettings` ships an area fill, and the reference's trend lines do not. */
const { area: _area, ...plainLine } = defaultLineSettings;

const sparkSettings = {
  ...defaultLineSettings,
  area: { ref: "palette.sparkArea" },
  min: 0,
  max: 100,
  showAxes: false,
  // The reference's sparklines are dotted rather than bare strokes.
  showMarkers: true,
  markerSize: 3,
};

const ringSettings = {
  ...defaultGaugeSettings,
  thickness: 20,
  track: { ref: "palette.chartTrack" },
};

/** A percentage with the unit as a second run, at the reference's two sizes. */
const percent = (
  valueSize: number,
  unitSize: number,
  bindingId: string,
): Run[] => [
  {
    kind: "value",
    bindingId,
    token: "text",
    size: valueSize,
    precision: 0,
    unitDisplay: "none",
  },
  { kind: "literal", text: "%", token: "text", size: unitSize },
];

/** A reading followed by its own unit, e.g. the reference's "4.8 GHz". */
const valued = (
  bindingId: string,
  unit: string,
  token: StarterPaletteId = "text",
): Run[] => [
  {
    kind: "value",
    bindingId,
    token,
    size: 20,
    precision: 1,
    unitDisplay: "none",
  },
  { kind: "literal", text: unit, token, size: 20 },
];

export function clockCard(): ObjectJson {
  return cardGroup(
    "group-time-card",
    uiCopy.cardLibrary.time,
    frostedCard("time-card", 40, 187, 367, 307),
    [
      // `hh:mm` with the meridiem on its own object: the reference sets it at a
      // quarter of the digits' size, and one tracking value is measured once per
      // object, so two sizes cannot share a text object anyway.
      valueLabel("time", 76, 214, 264, 122.04, 108, "text", "clock-time"),
      valueLabel(
        "time-period",
        350,
        294,
        60,
        27.12,
        24,
        "text",
        "clock-period",
      ),
      path(
        "time-rule",
        84,
        357,
        [
          ["M", 0, 0],
          ["L", 287, 0],
        ],
        "rule",
        2,
      ),
      valueLabel("date", 80, 370, 290, 36.16, 32, "text", "clock-date"),
    ],
  );
}

/**
 * The CPU card. Every piece is written through the ordinary families — a
 * palette-backed rectangle, text runs and a line chart — so an author can
 * restyle it with the controls the editor already ships rather than by editing
 * this file. The treatment is a `Rect` property the inspector's glass control
 * reads and writes like any other.
 */
export function cpuCard(): ObjectJson {
  return cardGroup(
    "group-cpu-card",
    uiCopy.cardLibrary.cpu,
    frostedCard("cpu-card", 421, 187, 280, 307),
    [
      path("cpu-card-icon", 456, 213, starterIcons.cpu(44), "cpu", 3.6),
      label("cpu-card-title", 528, 212, 140, 27.12, "CPU", 24, "text"),
      text(
        "cpu-card-value",
        456,
        258,
        246,
        101.7,
        percent(90, 60, "cpu-card-load"),
      ),
      // The reference writes the processor's own name under the figure. It is a
      // binding, not prose: a theme carries no machine's identity, and a caption
      // that cannot be read is a gap, never a stand-in model.
      //
      // The box runs wider than the value above it, left to the card's own
      // inset: a model name is longer than the reading column, and "…RTX 3080…"
      // and "RTX 3080 Ti" are different cards.
      text("cpu-card-caption", 433, 358, 262, 50, [
        {
          kind: "value",
          bindingId: "cpu-card-model",
          // `text`, not `dim`. The muted grey was chosen against a card at 72 %
          // opacity, where this line sat on a near-black field; on a glass that
          // actually transmits, it measures 3.1:1 against the backdrop and fails
          // AA for body text. The white token measures 5.4:1 on the same pixels,
          // and the hierarchy the grey was carrying comes from the 20 px against
          // the 24 px title instead.
          token: "text",
          size: 20,
        },
      ]),
      // `chart` is the one helper that takes Fabric's centre origin, so these
      // are the box's middle, not its corner.
      chart("cpu-card-sparkline", 571, 414, 230, 56, "line", {
        ...sparkSettings,
        area: { ref: "palette.frostArea" },
        stroke: { ref: "palette.frostInk" },
        palette: [{ ref: "palette.frostInk" }],
      }),
      text(
        "cpu-card-freq",
        456,
        452,
        220,
        22.6,
        valued("cpu-card-clock", " GHz"),
      ),
    ],
  );
}

export function gpuCard(): ObjectJson {
  return cardGroup(
    "group-gpu-card",
    uiCopy.cardLibrary.gpu,
    frostedCard("gpu-card", 715, 187, 290, 307),
    [
      path("gpu-card-icon", 748, 213, starterIcons.gpu(48), "gpu", 3.9),
      label("gpu-card-title", 824, 212, 140, 27.12, "GPU", 24, "text"),
      text(
        "gpu-card-value",
        748,
        258,
        246,
        101.7,
        percent(90, 60, "gpu-card-load"),
      ),
      // The assigned card's name, beside the figures it answers for. Two lines,
      // for the reason on the CPU card: a truncated model names no card.
      text("gpu-card-caption", 733, 358, 262, 50, [
        {
          kind: "value",
          bindingId: "gpu-card-model",
          token: "text",
          size: 20,
        },
      ]),
      chart("gpu-card-sparkline", 870, 414, 240, 56, "line", {
        ...sparkSettings,
        area: { ref: "palette.frostArea" },
        stroke: { ref: "palette.frostInk" },
        palette: [{ ref: "palette.frostInk" }],
      }),
      text(
        "gpu-card-freq",
        748,
        452,
        132,
        22.6,
        valued("gpu-card-clock", " GHz"),
      ),
      text("gpu-card-temp", 892, 452, 110, 22.6, [
        { kind: "literal", text: "| ", token: "text", size: 20 },
        {
          kind: "value",
          bindingId: "gpu-card-temp",
          token: "text",
          size: 20,
          precision: 0,
        },
      ]),
    ],
  );
}

/**
 * One memory card: a ring, the reading inside it and the capacity under it.
 *
 * The ring binds the *percentage*, never the absolute gigabytes: a gauge's `max`
 * is a plain number with no way to reference `ram.total`, so an absolute value
 * against a 0-100 range would draw a clamped fraction of a total it cannot know.
 */
function memoryCard(options: {
  readonly prefix: "ram" | "vram";
  readonly id: string;
  // The unit's word, passed by the caller: RAM and VRAM differ only in it, and
  // hardcoding either inside the shared builder would be a second owner.
  readonly unit: string;
  readonly left: number;
  readonly width: number;
  readonly ringCentreX: number;
  readonly title: string;
  readonly titleLeft: number;
  readonly iconLeft: number;
  readonly fullRing: boolean;
}): ObjectJson {
  const { prefix } = options;
  return cardGroup(
    `group-${options.id}`,
    options.unit,
    frostedCard(options.id, options.left, 187, options.width, 307),
    [
      path(
        `${prefix}-card-icon`,
        options.iconLeft,
        213,
        starterIcons[prefix](50),
        prefix,
        4.1,
      ),
      label(
        `${prefix}-card-title`,
        options.titleLeft,
        212,
        160,
        27.12,
        options.title,
        24,
        "text",
      ),
      chart(`${prefix}-gauge`, options.ringCentreX, 375, 218, 218, "gauge", {
        ...ringSettings,
        // A full ring is a settings value on one family, not a second family:
        // the default 225 -> -45 is the 270-degree arc, and 0 -> 360 closes it.
        ...(options.fullRing ? { startAngle: 0, endAngle: 360 } : {}),
        progress: { ref: `palette.${prefix}` },
      }),
      // The value and the capacity are ordinary text objects:
      // `buildGaugeOption` hides `detail` and `axisLabel` outright, so there is
      // no chart-internal value text to suppress and no choice to make.
      //
      // Both sit at the reference's own centre, and they hold it because
      // `text()` authors a `Textbox` with a fixed box — the box is restored on
      // every refresh, so the placement arithmetic has the authored width to
      // work from.
      text(
        `${prefix}-value`,
        options.ringCentreX - 90,
        337,
        180,
        67.8,
        percent(60, 46, `${prefix}-percent`),
        { align: "center", verticalAlign: "middle" },
      ),
      text(
        `${prefix}-capacity`,
        options.ringCentreX - 100,
        406,
        200,
        22.6,
        [
          {
            kind: "value",
            bindingId: `${prefix}-used`,
            token: "text",
            size: 20,
            precision: 1,
            unitDisplay: "none",
          },
          {
            kind: "literal",
            text: " / ",
            token: "text",
            size: 20,
          },
          {
            kind: "value",
            bindingId: `${prefix}-total`,
            token: "text",
            size: 20,
            precision: 0,
            unitDisplay: "none",
          },
          {
            kind: "literal",
            text: " GB",
            token: "text",
            size: 20,
          },
        ],
        { align: "center" },
      ),
    ],
  );
}

export function ramCard(): ObjectJson {
  return memoryCard({
    prefix: "ram",
    id: "ram-card",
    unit: uiCopy.cardLibrary.ram,
    left: 1019,
    width: 299,
    ringCentreX: 1168,
    title: "RAM",
    titleLeft: 1124,
    iconLeft: 1052,
    fullRing: false,
  });
}

export function vramCard(): ObjectJson {
  return memoryCard({
    prefix: "vram",
    id: "vram-card",
    unit: uiCopy.cardLibrary.vram,
    left: 1332,
    width: 300,
    ringCentreX: 1482,
    title: "VRAM",
    titleLeft: 1444,
    iconLeft: 1366,
    fullRing: true,
  });
}

export function trendsCard(): ObjectJson {
  const legend: Run[] = [];
  for (const [token, name] of [
    ["cpu", "CPU"],
    ["gpu", "GPU"],
    ["ram", "RAM"],
  ] as const) {
    legend.push({ kind: "literal", text: "●", token, size: 20 });
    legend.push({
      kind: "literal",
      text: ` ${name}${name === "RAM" ? "" : "   "}`,
      token: "text",
      size: 20,
    });
  }
  return cardGroup(
    "group-trends-card",
    uiCopy.cardLibrary.trends,
    frostedCard("trends-card", 40, 507, 1084, 335),
    [
      path("trends-card-icon", 74, 530, starterIcons.trends(34), "cpu", 2.8),
      label(
        "trends-card-title",
        134,
        528,
        420,
        27.12,
        "Performance Trends",
        24,
        "text",
      ),
      // The legend is a text object, not a chart setting: `LineSettings` has no
      // legend property and the settings panel exposes no legend field.
      text("trends-legend", 680, 528, 390, 22.6, legend, { align: "center" }),
      chart("trends-chart", 616, 695, 963, 215, "line", {
        ...plainLine,
        // Area fill is first-series only, so three filled series are not
        // expressible; the reference's three strokes are what this keeps.
        palette: [
          { ref: "palette.cpu" },
          { ref: "palette.gpu" },
          { ref: "palette.ram" },
        ],
        stroke: { ref: "palette.cpu" },
        min: 0,
        max: 100,
        showAxes: true,
        showMarkers: true,
        markerSize: 3,
      }),
    ],
  );
}

export function storageCard(): ObjectJson {
  return cardGroup(
    "group-storage-card",
    uiCopy.cardLibrary.storage,
    frostedCard("storage-card", 1138, 507, 494, 165),
    [
      path(
        "storage-card-icon",
        1170,
        528,
        starterIcons.storage(40),
        "cpu",
        3.3,
      ),
      label("storage-card-title", 1234, 528, 240, 27.12, "Storage", 24, "text"),
      // The reference writes the share against the card's right edge.
      text(
        "storage-card-value",
        1460,
        526,
        200,
        49.72,
        [
          {
            kind: "value",
            bindingId: "storage-percent",
            token: "text",
            size: 44,
            precision: 0,
          },
        ],
        { align: "center" },
      ),
      chart("storage-bar", 1385, 603, 430, 26, "bar", {
        ...defaultBarSettings,
        // A track is what makes a bar a progress bar rather than a column.
        min: 0,
        max: 100,
        barWidth: 20,
        cornerRadius: 10,
        fill: { ref: "palette.storageFill" },
        track: { ref: "palette.chartTrack" },
        // 20 wide is half-radius — a pill. The track states its own rather than
        // taking the bar's, because the ruling is that the two are independent
        // and the shipped theme should say what it wants rather than inherit
        // one.
        trackCornerRadius: 10,
      }),
      // The row the reference puts the volume name and a chevron on. The name is
      // the selected volume's own: it reads a gap until a consumer picks a
      // drive, because until then the bar measures every volume at once and no
      // one volume's name describes that sum. The chevron is not a reading and
      // claims nothing, so it ships: decorative in this scope, not a navigation
      // action.
      text("storage-card-name", 1234, 612, 330, 22.6, [
        {
          kind: "value",
          bindingId: "storage-card-volume",
          token: "text",
          size: 20,
        },
      ]),
      path("storage-chevron", 1590, 626, starterIcons.chevron(24), "text", 2),
    ],
  );
}

export function networkCard(): ObjectJson {
  return cardGroup(
    "group-network-card",
    uiCopy.cardLibrary.network,
    frostedCard("network-card", 1138, 687, 494, 155),
    [
      path(
        "network-card-icon",
        1170,
        706,
        starterIcons.network(40),
        "down",
        3.3,
      ),
      label("network-card-title", 1230, 704, 240, 27.12, "Network", 24, "text"),
      // The arrows are typographic marks rather than icon objects: they sit
      // inside a label whose width changes with the reading, and a separate Path
      // would not follow it.
      text("network-down", 1355, 702, 135, 22.6, [
        { kind: "literal", text: "↓ ", token: "down", size: 20 },
        {
          kind: "value",
          bindingId: "network-download-label",
          token: "text",
          size: 20,
          precision: 1,
        },
      ]),
      text("network-up", 1505, 702, 135, 22.6, [
        { kind: "literal", text: "↑ ", token: "gpu", size: 20 },
        {
          kind: "value",
          bindingId: "network-upload-label",
          token: "text",
          size: 20,
          precision: 1,
        },
      ]),
      chart("network-chart", 1385, 783, 430, 70, "line", {
        ...plainLine,
        palette: [{ ref: "palette.down" }, { ref: "palette.gpu" }],
        stroke: { ref: "palette.down" },
        min: 0,
        showAxes: false,
        showMarkers: true,
        markerSize: 3,
      }),
    ],
  );
}
