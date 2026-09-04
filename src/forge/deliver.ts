/**
 * The whole family, written out.
 *
 * One place rather than inside the dialog, because what comes out of here is
 * the thing the application exists to produce and it should be testable without
 * a browser in the way. The dialog decides what somebody asked for; this draws
 * it and writes the files.
 */

import { exportFont, type ExportFormat } from "@/font/export";
import type { Axis, Instance } from "@/font/variable";
import { zip } from "@/font/zip";
import { familyOf, weighted, type Forge } from "./document";
import { memberOf, nameOfWeight, weightsOf } from "./family";
import { toTypeface } from "./typeface";
import { anyEffect } from "@/font/effects";
import type { WaveBook } from "./shapes";

export interface Delivery {
  fileName: string;
  bytes: Uint8Array;
  /** What is inside, for saying so: one font, or the members of a family. */
  members: Array<{ weight: number; styleName: string; fileName: string }>;
  /** Anything worth telling somebody about what was written. */
  notes: string[];
  /** Glyphs that follow a variable axis only part of the way, by name. */
  held: string[];
}

/**
 * Draw every weight the family has and hand back one download.
 *
 * A family of one is the font itself rather than an archive holding a single
 * file, because somebody who has not asked for a family should not have to
 * unpack one.
 */
export async function deliver(
  forge: Forge,
  options: { familyName: string; format: ExportFormat; variable?: boolean },
): Promise<Delivery> {
  const family = familyOf(forge);
  const weights = weightsOf(family);
  const familyName = options.familyName || "Untitled";
  const extension = options.format === "otf" ? "otf" : "ttf";

  /*
   * A textured face cannot be a variable one, and this is where that is said.
   *
   * Two masters join only where they are drawn with the same points in the same
   * order. The roughening is seeded, so the same settings always give the same
   * edge -- but a Regular and a Bold are not the same settings: the wander is
   * measured in stem widths and laid along a perimeter, and both of those move
   * with the weight. The masters come out with different point counts and there
   * is nothing to interpolate between.
   *
   * So the variable path is taken only where nothing is switched on. Elsewhere
   * the family is written as separate files, which is the honest answer rather
   * than a variable font whose axis tears its letters apart halfway along.
   */
  const textured = anyEffect(forge.effects);
  if (options.variable && !textured && weights.length > 1 && options.format !== "otf") {
    return await varying(forge, familyName, weights, family.drawn);
  }

  const written: Array<{ weight: number; styleName: string; fileName: string; bytes: Uint8Array }> =
    [];
  /*
   * The same book the variable font keeps, kept for the separate files too.
   *
   * Not because a static font needs its masters to line up -- it has none --
   * but because these are the same family written two ways, and a family whose
   * Black `c` has a serif in one file and not in the other is two families. The
   * book decides where a bowl's list of pieces begins, and what a run ends on
   * decides how it is finished; see `begun` in `shapes.ts`.
   *
   * A family of one weight records its own page and reads it back, which is the
   * same drawing it would have had without a book at all.
   */
  const waves: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };
  const order = [family.drawn, ...weights.filter((weight) => weight !== family.drawn)];
  for (const weight of order) {
    const member = memberOf(familyName, weight);
    const typeface = await toTypeface(weighted(forge, weight), {
      familyName,
      styleName: member.styleName,
      weightClass: weight,
      waves,
      merge: true,
      kern: true,
      // The one place the tool reaches the whole font: see `ForgeExportOptions`.
      effects: true,
    });
    waves.recording = false;
    const result = await exportFont(typeface, {
      format: options.format,
      // Nothing to preserve: there was never a source font.
      fidelity: "rebuild",
      includeKerning: true,
      mergeOverlaps: true,
    });
    written.push({
      weight,
      styleName: member.styleName,
      fileName: `${member.fileName}.${extension}`,
      bytes: result.bytes,
    });
  }

  // Back into the order somebody asked for, since the drawn weight was drawn
  // first so that it could write the book rather than because it comes first.
  written.sort((one, other) => weights.indexOf(one.weight) - weights.indexOf(other.weight));

  const members = written.map(({ weight, styleName, fileName }) => ({
    weight,
    styleName,
    fileName,
  }));

  if (written.length === 1) {
    return { fileName: written[0].fileName, bytes: written[0].bytes, members, notes: [], held: [] };
  }
  const tidy = familyName.replace(/[^A-Za-z0-9]+/g, "") || "Untitled";
  return {
    fileName: `${tidy}.zip`,
    bytes: zip(written.map(({ fileName, bytes }) => ({ name: fileName, bytes }))),
    members,
    held: [],
    notes: [],
  };
}

/**
 * The whole family in one file, with a slider between the weights.
 *
 * The same drawings as the separate files, written once with the differences
 * between them stored alongside. What makes that possible here rather than
 * merely desirable is the engine: every weight is the same skeleton swept with
 * a wider pen, so the same strokes are drawn in the same order whatever the
 * weight, and a difference between two of them is a list of points that moved.
 *
 * Nothing is merged, which is the one thing this path does differently and the
 * reason it works. Fusing a letter's strokes into a single outline re-points
 * it, and where the strokes meet differently as the pen widens the fused
 * outlines stop matching: over the 196 letters of a Sans, 187 line up across
 * five weights as drawn and only 125 once fused. So the strokes are left
 * overlapping and the file says so -- which is what the overlap flag in `glyf`
 * is for, and what every variable font does.
 */
async function varying(
  forge: Forge,
  familyName: string,
  weights: number[],
  drawn: number,
): Promise<Delivery> {
  const axes: Axis[] = [
    {
      tag: "wght",
      label: "Weight",
      min: Math.min(...weights),
      default: drawn,
      max: Math.max(...weights),
    },
  ];
  const instances: Instance[] = weights.map((weight) => ({
    label: nameOfWeight(weight),
    at: { wght: weight },
  }));

  /*
   * The run lengths every master counts its waves off, taken from the weight
   * the family was drawn at: see `WaveBook` in `shapes.ts`.
   *
   * Which means the drawn weight has to be drawn first, and it is -- the loop
   * below skips it and the export at the end uses what is drawn here. Before
   * this, each master counted its own humps off its own run lengths, and a run
   * that crossed a boundary somewhere on the axis came out with a different
   * number of them at the two ends: 26 of the Wavy's letters, and no way to
   * count differently that does not move the boundary rather than remove it.
   */
  const waves: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };

  const drawing = async (weight: number) =>
    await toTypeface(weighted(forge, weight), {
      familyName,
      styleName: memberOf(familyName, weight).styleName,
      weightClass: weight,
      waves,
      // The whole point: see above.
      merge: false,
      /*
       * Only the drawn weight is measured for kerning.
       *
       * A variable font carries one set of pairs and the format has no way to
       * vary them, so the masters' would be measured and thrown away. Taking it
       * from the weight the family was drawn at is the same choice every
       * variable font makes.
       */
      kern: weight === drawn,
    });

  const master = await drawing(drawn);
  waves.recording = false;

  const masters = [];
  for (const weight of weights) {
    if (weight === drawn) continue;
    masters.push({ at: { wght: weight }, typeface: await drawing(weight) });
  }

  const result = await exportFont(master, {
    format: "ttf",
    fidelity: "rebuild",
    includeKerning: true,
    mergeOverlaps: false,
    // Drawn here, so the winding says which contour is a counter outright.
    roles: "winding",
    variable: { axes, instances, masters },
  });

  const tidy = familyName.replace(/[^A-Za-z0-9]+/g, "") || "Untitled";
  return {
    // The name every foundry gives a variable font: the family, then the axes
    // it carries, in the brackets a font manager knows to read.
    fileName: `${tidy}[wght].ttf`,
    bytes: result.bytes,
    members: weights.map((weight) => ({
      weight,
      styleName: nameOfWeight(weight),
      fileName: `${tidy}[wght].ttf`,
    })),
    notes: result.notes,
    held: result.held,
  };
}
