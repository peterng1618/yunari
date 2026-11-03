/**
 * The Lucide geometry the starter's icons are drawn from, copied from
 * `lucide-react/dist/esm/icons/*.mjs`.
 *
 * `lucide-react` is a React package: importing its per-icon modules here would
 * pull React into the Node MCP process, which never mounts a component. These
 * are the same `__iconData` node arrays the package publishes, carried as data.
 *
 * @license lucide-react v1.61.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of the original package.
 */

export type LucideIconNode = readonly [
  string,
  Readonly<Record<string, string | number | undefined>>,
];

export const lucideChartColumns: readonly LucideIconNode[] = [
  ["path", { d: "M5 21v-6", key: "1hz6c0" }],
  ["path", { d: "M12 21V3", key: "1lcnhd" }],
  ["path", { d: "M19 21V9", key: "unv183" }],
];

export const lucideChevronRight: readonly LucideIconNode[] = [
  ["path", { d: "m9 18 6-6-6-6", key: "mthhwq" }],
];

export const lucideCircuitBoard: readonly LucideIconNode[] = [
  [
    "rect",
    {
      width: "18",
      height: "18",
      x: "3",
      y: "3",
      rx: "2",
      key: "afitv7",
    },
  ],
  ["path", { d: "M11 9h4a2 2 0 0 0 2-2V3", key: "1ve2rv" }],
  ["circle", { cx: "9", cy: "9", r: "2", key: "af1f0g" }],
  ["path", { d: "M7 21v-4a2 2 0 0 1 2-2h4", key: "1fwkro" }],
  ["circle", { cx: "15", cy: "15", r: "2", key: "3i40o0" }],
];

export const lucideCpu: readonly LucideIconNode[] = [
  ["path", { d: "M12 20v2", key: "1lh1kg" }],
  ["path", { d: "M12 2v2", key: "tus03m" }],
  ["path", { d: "M17 20v2", key: "1rnc9c" }],
  ["path", { d: "M17 2v2", key: "11trls" }],
  ["path", { d: "M2 12h2", key: "1t8f8n" }],
  ["path", { d: "M2 17h2", key: "7oei6x" }],
  ["path", { d: "M2 7h2", key: "asdhe0" }],
  ["path", { d: "M20 12h2", key: "1q8mjw" }],
  ["path", { d: "M20 17h2", key: "1fpfkl" }],
  ["path", { d: "M20 7h2", key: "1o8tra" }],
  ["path", { d: "M7 20v2", key: "4gnj0m" }],
  ["path", { d: "M7 2v2", key: "1i4yhu" }],
  [
    "rect",
    { x: "4", y: "4", width: "16", height: "16", rx: "2", key: "1vbyd7" },
  ],
  ["rect", { x: "8", y: "8", width: "8", height: "8", rx: "1", key: "z9xiuo" }],
];

export const lucideHardDrive: readonly LucideIconNode[] = [
  ["path", { d: "M10 16h.01", key: "1bzywj" }],
  [
    "path",
    {
      d: "M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
      key: "18tbho",
    },
  ],
  ["path", { d: "M21.946 12.013H2.054", key: "zqlbp7" }],
  ["path", { d: "M6 16h.01", key: "1pmjb7" }],
];

export const lucideMemoryStick: readonly LucideIconNode[] = [
  ["path", { d: "M12 12v-2", key: "fwoke6" }],
  ["path", { d: "M12 18v-2", key: "qj6yno" }],
  ["path", { d: "M16 12v-2", key: "heuere" }],
  ["path", { d: "M16 18v-2", key: "s1ct0w" }],
  ["path", { d: "M2 11h1.5", key: "15p63e" }],
  ["path", { d: "M20 18v-2", key: "12ehxp" }],
  ["path", { d: "M20.5 11H22", key: "khsy7a" }],
  ["path", { d: "M4 18v-2", key: "1c3oqr" }],
  ["path", { d: "M8 12v-2", key: "1mwtfd" }],
  ["path", { d: "M8 18v-2", key: "qcmpov" }],
  [
    "rect",
    { x: "2", y: "6", width: "20", height: "10", rx: "2", key: "1qcswk" },
  ],
];

export const lucideWifi: readonly LucideIconNode[] = [
  ["path", { d: "M12 20h.01", key: "zekei9" }],
  ["path", { d: "M2 8.82a15 15 0 0 1 20 0", key: "dnpr2z" }],
  ["path", { d: "M5 12.859a10 10 0 0 1 14 0", key: "1x1e6c" }],
  ["path", { d: "M8.5 16.429a5 5 0 0 1 7 0", key: "1bycff" }],
];

export const lucideThermometer: readonly LucideIconNode[] = [
  ["path", { d: "M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z", key: "17jzev" }],
];

export const lucideFan: readonly LucideIconNode[] = [
  [
    "path",
    {
      d: "M10.827 16.379a6.082 6.082 0 0 1-8.618-7.002l5.412 1.45a6.082 6.082 0 0 1 7.002-8.618l-1.45 5.412a6.082 6.082 0 0 1 8.618 7.002l-5.412-1.45a6.082 6.082 0 0 1-7.002 8.618l1.45-5.412Z",
      key: "484a7f",
    },
  ],
  ["path", { d: "M12 12v.01", key: "u5ubse" }],
];

export const lucideGauge: readonly LucideIconNode[] = [
  ["path", { d: "m12 14 4-4", key: "9kzdfg" }],
  ["path", { d: "M3.34 19a10 10 0 1 1 17.32 0", key: "19p75a" }],
];

export const lucideActivity: readonly LucideIconNode[] = [
  [
    "path",
    {
      d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
      key: "169zse",
    },
  ],
];

export const lucidePower: readonly LucideIconNode[] = [
  ["path", { d: "M12 2v10", key: "mnfbl" }],
  ["path", { d: "M18.4 6.6a9 9 0 1 1-12.77.04", key: "obofu9" }],
];

export const lucideClock: readonly LucideIconNode[] = [
  ["circle", { cx: "12", cy: "12", r: "10", key: "1mglay" }],
  ["path", { d: "M12 6v6l4 2", key: "mmk7yg" }],
];

export const lucideZap: readonly LucideIconNode[] = [
  [
    "path",
    {
      d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z",
      key: "1v7up4",
    },
  ],
];

export const lucideArrowUp: readonly LucideIconNode[] = [
  ["path", { d: "m5 12 7-7 7 7", key: "hav0vg" }],
  ["path", { d: "M12 19V5", key: "x0mq9r" }],
];

export const lucideArrowDown: readonly LucideIconNode[] = [
  ["path", { d: "M12 5v14", key: "s699le" }],
  ["path", { d: "m19 12-7 7-7-7", key: "1idqje" }],
];
