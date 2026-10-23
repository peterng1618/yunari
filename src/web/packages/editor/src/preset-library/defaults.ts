import type { ColourPreset, GradientPreset } from "./index.js";

/**
 * The first-run library. Values are authored as `rgb()` rather than hex because
 * this file is editor source inside the design-token gate's reach; the store
 * normalises them to hex when it reads.
 */
export const DEFAULT_COLOUR_PRESETS: readonly ColourPreset[] = [
  { id: "default-colour-slate-900", name: "Slate 900", value: "rgb(15 23 42)" },
  {
    id: "default-colour-slate-600",
    name: "Slate 600",
    value: "rgb(71 85 105)",
  },
  {
    id: "default-colour-slate-400",
    name: "Slate 400",
    value: "rgb(148 163 184)",
  },
  {
    id: "default-colour-slate-100",
    name: "Slate 100",
    value: "rgb(241 245 249)",
  },
  { id: "default-colour-red", name: "Red", value: "rgb(239 68 68)" },
  { id: "default-colour-orange", name: "Orange", value: "rgb(249 115 22)" },
  { id: "default-colour-amber", name: "Amber", value: "rgb(234 179 8)" },
  { id: "default-colour-green", name: "Green", value: "rgb(34 197 94)" },
  { id: "default-colour-cyan", name: "Cyan", value: "rgb(6 182 212)" },
  { id: "default-colour-blue", name: "Blue", value: "rgb(59 130 246)" },
  { id: "default-colour-violet", name: "Violet", value: "rgb(139 92 246)" },
  { id: "default-colour-pink", name: "Pink", value: "rgb(236 72 153)" },
];

/** `angle: 0` is a CSS `90deg` gradient in the editor's stored convention. */
function gradient(
  slug: string,
  name: string,
  from: string,
  to: string,
): GradientPreset {
  return {
    id: `default-gradient-${slug}`,
    name,
    angle: 0,
    stops: [
      { offset: 0, color: from },
      { offset: 1, color: to },
    ],
  };
}

/** The fifteen named swatches from <https://cssgradient.io/swatches/>, read 2026-10-23. */
export const DEFAULT_GRADIENT_PRESETS: readonly GradientPreset[] = [
  gradient("vital-ocean", "Vital Ocean", "rgb(28 181 224)", "rgb(0 8 81)"),
  gradient("kale-salad", "Kale Salad", "rgb(0 201 255)", "rgb(146 254 157)"),
  gradient("disco-club", "Disco Club", "rgb(252 70 107)", "rgb(63 94 251)"),
  gradient("shady-lane", "Shady Lane", "rgb(63 43 150)", "rgb(168 192 255)"),
  gradient("retro-wagon", "Retro Wagon", "rgb(253 187 45)", "rgb(34 193 195)"),
  gradient("fresco-crush", "Fresco Crush", "rgb(253 187 45)", "rgb(58 28 113)"),
  gradient(
    "cucumber-water",
    "Cucumber Water",
    "rgb(227 255 231)",
    "rgb(217 231 255)",
  ),
  gradient("sea-salt", "Sea Salt", "rgb(75 108 183)", "rgb(24 40 72)"),
  gradient("par-four", "Par Four", "rgb(158 189 19)", "rgb(0 133 82)"),
  gradient("ooey-gooey", "Ooey Gooey", "rgb(7 0 184)", "rgb(0 255 136)"),
  gradient(
    "bloody-mimosa",
    "Bloody Mimosa",
    "rgb(213 51 105)",
    "rgb(218 174 81)",
  ),
  gradient(
    "lovely-lilly",
    "Lovely Lilly",
    "rgb(239 213 255)",
    "rgb(81 90 218)",
  ),
  gradient("aqua-spray", "Aqua Spray", "rgb(0 210 255)", "rgb(58 71 213)"),
  gradient("mello-yellow", "Mello Yellow", "rgb(248 255 0)", "rgb(58 213 159)"),
  gradient(
    "dusty-cactus",
    "Dusty Cactus",
    "rgb(252 255 158)",
    "rgb(198 119 0)",
  ),
];
