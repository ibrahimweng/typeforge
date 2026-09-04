/**
 * A font that varies, made out of the font that is open.
 *
 * The machinery to write `fvar`, `gvar` and `STAT` has been here since the
 * forge learned to ship a family in one file, and it takes masters as whole
 * typefaces -- so nothing about it is particular to a drawn-from-nothing face.
 * Only the forge could reach it. A font somebody opened or drew by hand could
 * not be shipped as a variable one, though this half of the application is, in
 * `variable.ts`'s own words, "already a machine for drawing the same alphabet
 * at any weight".
 *
 * A master here is the same typeface with one parameter moved. That is the
 * whole trick and it is worth saying why it works: `applyWeight` in
 * `transform.ts` walks the nodes a contour already has and offsets each one
 * along its own normal. It moves points; it does not make or remove them. So
 * two weights of the same letter come out with the same points in the same
 * order, which is the one thing a variable font cannot do without.
 *
 * Where that is not true the export already copes: `buildGvar` hands back the
 * glyphs whose masters did not line up, they are left at the default, and the
 * exporter says which. Slab serifs are the honest example -- the slider takes
 * `n` from three stroke ends to none partway along, and a letter that changes
 * how many pieces it is made of cannot be interpolated by anybody.
 */

import { PARAMS } from "@/components/param-specs";

import type { VariableOptions } from "./export";
import type { Axis, Instance } from "./variable";
import type { Typeface } from "./types";
import { axesOf, glyphAcross, type Master } from "./master";

/**
 * The weight axis, as the format numbers it.
 *
 * 100 to 900 is what every reader's software expects and what a menu of
 * weights is drawn from. The two ends are the weight slider's own limits rather
 * than a range invented here, so the axis reaches exactly as far as the control
 * does and no further -- somebody who has looked at the boldest this font goes
 * has already seen the end of the axis.
 */
export const WEIGHT_AXIS = { min: 100, max: 900 } as const;

/**
 * Where the weight slider stops, in the units the parameter is actually kept in.
 *
 * The spec's own numbers are a fraction of the em -- the slider is drawn in
 * them -- and the inspector multiplies by `unitsPerEm` on the way in, so what
 * `params.weight` holds is font units. Both halves of that are in the code and
 * neither is in the type, which is exactly how this went wrong the first time:
 * masters built at the raw fraction moved a twenty-fifth of a font unit and
 * produced a variable font whose bold and light were the same letters to four
 * decimal places, in a file that was otherwise perfectly formed.
 */
function weightLimits(unitsPerEm: number): { min: number; max: number } {
  const spec = PARAMS.find((one) => one.key === "weight");
  return { min: (spec?.min ?? -0.04) * unitsPerEm, max: (spec?.max ?? 0.06) * unitsPerEm };
}

/** Where a stored weight sits on the 100..900 line, rounded to a whole. */
export function axisPositionOf(weight: number, unitsPerEm: number): number {
  const { min, max } = weightLimits(unitsPerEm);
  const along = (weight - min) / (max - min);
  const at = WEIGHT_AXIS.min + along * (WEIGHT_AXIS.max - WEIGHT_AXIS.min);
  return Math.round(Math.min(WEIGHT_AXIS.max, Math.max(WEIGHT_AXIS.min, at)));
}

/** The same typeface with the family weight moved, sharing everything else. */
function at(typeface: Typeface, weight: number): Typeface {
  return { ...typeface, params: { ...typeface.params, weight } };
}

/**
 * The standard weights, and what a reader's menu calls them.
 *
 * Only the ones the axis actually covers. A font whose drawing sits near the
 * bold end has no Thin in it, and naming one would put an entry in every font
 * menu that lands on the lightest thing the axis has rather than on a thin.
 */
const NAMED: ReadonlyArray<{ at: number; label: string }> = [
  { at: 100, label: "Thin" },
  { at: 200, label: "ExtraLight" },
  { at: 300, label: "Light" },
  { at: 400, label: "Regular" },
  { at: 500, label: "Medium" },
  { at: 600, label: "SemiBold" },
  { at: 700, label: "Bold" },
  { at: 800, label: "ExtraBold" },
  { at: 900, label: "Black" },
];

/**
 * What the font would be if it varied by weight.
 *
 * Two masters and no more: the weight slider is a straight line, so the ends
 * describe the whole of it and a third in the middle would carry deltas that
 * are already implied. The typeface being exported is the default master and
 * is deliberately not in the list -- the exporter uses what it was handed.
 *
 * Returns nothing when the font is already at one end of the slider, because
 * an axis whose default sits on its own minimum is a font with a slider that
 * only goes one way, and saying so plainly beats shipping one.
 */
export function varyByWeight(typeface: Typeface): VariableOptions | null {
  const limits = weightLimits(typeface.unitsPerEm);
  const here = typeface.params.weight;
  if (here <= limits.min || here >= limits.max) return null;

  const axes: Axis[] = [
    {
      tag: "wght",
      label: "Weight",
      min: WEIGHT_AXIS.min,
      default: axisPositionOf(here, typeface.unitsPerEm),
      max: WEIGHT_AXIS.max,
    },
  ];

  const named = NAMED.filter((one) => one.at >= WEIGHT_AXIS.min && one.at <= WEIGHT_AXIS.max);
  const instances: Instance[] = named.map((one) => ({
    label: one.label,
    at: { wght: one.at },
  }));

  return {
    axes,
    instances,
    masters: [
      { at: { wght: WEIGHT_AXIS.min }, typeface: at(typeface, limits.min) },
      { at: { wght: WEIGHT_AXIS.max }, typeface: at(typeface, limits.max) },
    ],
  };
}

/**
 * What the font is at one place on the axis, as a whole typeface.
 *
 * Two things want this and they want the same thing: a static instance -- "the
 * Medium, as a file" -- and a proof somebody is scrubbing. Both are the font at
 * a position rather than a letter at one, which is why it is written once here
 * rather than twice.
 *
 * A letter whose weights do not line up keeps the first weight's drawing, which
 * is exactly what the variable export does with the same letter: it stands
 * still while the rest of the font moves. The two halves of the application
 * should not disagree about what a font at 550 looks like.
 */
export function typefaceAt(masters: Master[], at: Record<string, number>): Typeface {
  const first = masters[0].typeface;
  if (masters.length < 2) return first;
  return {
    ...first,
    glyphs: first.glyphs.map((glyph) => glyphAcross(glyph.name, masters, at) ?? glyph),
  };
}

/**
 * The font as a varying one, built out of the versions somebody drew.
 *
 * The other `varyByWeight` above synthesises its masters by moving one number,
 * which is a machine-made bold: even where a drawn one is optical, thickening a
 * hairline and a stem by the same amount. This takes the drawings instead.
 *
 * Every axis the document has, not only weight. The axes come from where the
 * versions actually stand -- see `axesOf` -- so the file can never claim a
 * slider it has no drawing to reach, which is the way this goes wrong: a `wdth`
 * in `fvar` with nothing behind it is a control that does nothing.
 *
 * The default is the first version, because that is what the document treats as
 * the original everywhere else and what `gvar` stores every other one as a
 * difference from. The instances are the versions that were drawn, by the names
 * they were given -- not a standard list, because a menu entry for a Thin this
 * font does not have lands on whatever the axis reaches at its lightest and
 * calls it a Thin.
 *
 * Nothing when there is one version, or when nothing was drawn away from the
 * middle of any axis: there is no axis, and the caller falls back to the
 * synthesised pair.
 */
export function varyByDrawnVersions(masters: Master[]): VariableOptions | null {
  if (masters.length < 2) return null;
  const axes = axesOf(masters);
  if (axes.length === 0) return null;

  /*
   * Two versions standing in the same place is not a design space, and the
   * document refuses to make one -- this is the second door, for a file that
   * arrived with one.
   */
  const seen = new Set<string>();
  for (const master of masters) {
    const key = axes.map((axis) => master.at[axis.tag] ?? axis.default).join(",");
    if (seen.has(key)) return null;
    seen.add(key);
  }

  const place = (master: Master): Record<string, number> =>
    Object.fromEntries(axes.map((axis) => [axis.tag, master.at[axis.tag] ?? axis.default]));

  return {
    axes,
    instances: masters.map((one) => ({ label: one.name, at: place(one) })),
    // The first version is the default and the exporter uses what it was
    // handed, so it is deliberately not in here.
    masters: masters.slice(1).map((one) => ({ at: place(one), typeface: one.typeface })),
  };
}
