/**
 * What every family parameter is, in one place.
 *
 * The inspector draws these as sliders and the help drawer explains them, and
 * both read this list. Written out twice they would have drifted the first time
 * a range was adjusted, and a help page that describes a control the tool no
 * longer has is worse than no help page.
 *
 * The grouping is the order a designer works in: how heavy, then how the parts
 * sit, then what comes out the other end.
 */

import type { GlyphParams } from "@/font/types";

export interface ParamSpec {
  key: keyof GlyphParams;
  label: string;
  /** What the control does, in the terms a designer would use. */
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Whether the range is in font units and should scale with the em size. */
  emRelative?: boolean;
}

export const PARAMS: ParamSpec[] = [
  {
    key: "cornerRadius",
    label: "Corner radius",
    hint: "Rounds sharp corners. Stem ends and serif joints soften first.",
    min: 0,
    max: 0.15,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "weight",
    label: "Weight",
    hint: "Thickens or thins every stroke. Negative values lighten.",
    min: -0.04,
    max: 0.06,
    step: 0.0005,
    emRelative: true,
  },
  {
    key: "counterScale",
    label: "Middle space",
    hint: "Opens or closes the enclosed space inside letters such as o, e and a.",
    min: 0.6,
    max: 1.4,
    step: 0.005,
  },
  {
    key: "width",
    label: "Width",
    hint: "Stretches or condenses letterforms horizontally.",
    min: 0.6,
    max: 1.5,
    step: 0.005,
  },
  {
    key: "slant",
    label: "Slant",
    hint: "Shears the letters about the baseline, making an oblique.",
    min: -20,
    max: 20,
    step: 0.5,
    unit: "°",
  },
  {
    key: "xHeightScale",
    label: "x-height",
    hint: "Scales everything above the baseline. Descenders stay put.",
    min: 0.8,
    max: 1.25,
    step: 0.005,
  },
  {
    key: "crossbar",
    label: "Crossbar",
    hint: "Raises or lowers the stroke crossing the middle: the bar of H and A, the middle arm of E, the eye of e.",
    min: -0.08,
    max: 0.08,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "shoulder",
    label: "Shoulder",
    hint: "Moves where an arch springs from its stem. Up squares the shoulder of n and m; down opens them out.",
    min: -0.08,
    max: 0.08,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "slab",
    label: "Slab serifs",
    hint: "Lays a bar across every flat stroke end, turning a sans into a slab. Round terminals are left alone.",
    min: 0,
    max: 0.1,
    step: 0.001,
    emRelative: true,
  },
  {
    key: "pixelGrid",
    label: "Pixel grid",
    hint: "Redraws every letter on a grid this many cells to the em. Zero leaves the curves alone.",
    min: 0,
    max: 64,
    step: 1,
    unit: " px/em",
  },
  {
    key: "tracking",
    label: "Tracking",
    hint: "Adds space either side of every glyph, loosening the whole setting.",
    min: -0.05,
    max: 0.1,
    step: 0.001,
    emRelative: true,
  },
];

/** How the parameters are grouped when they are explained rather than used. */
export const PARAM_GROUPS: Array<{ title: string; blurb: string; keys: Array<keyof GlyphParams> }> = [
  {
    title: "Weight and proportion",
    blurb:
      "The whole letter at once. These are the qualities a type family varies from one style to the next.",
    keys: ["weight", "width", "xHeightScale", "slant", "tracking"],
  },
  {
    title: "Anatomy",
    blurb:
      "The named parts of a letter, moved where they sit rather than by scaling the whole shape.",
    keys: ["crossbar", "shoulder", "counterScale", "cornerRadius", "slab"],
  },
  {
    title: "Output",
    blurb: "What the letters are redrawn on before they leave.",
    keys: ["pixelGrid"],
  },
];
