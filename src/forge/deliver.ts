/**
 * The whole family, written out.
 *
 * One place rather than inside the dialog, because what comes out of here is
 * the thing the application exists to produce and it should be testable without
 * a browser in the way. The dialog decides what somebody asked for; this draws
 * it and writes the files.
 */

import { exportFont, type ExportFormat, variableName } from "@/font/export";
import type { Axis, Instance } from "@/font/variable";
import { zip } from "@/font/zip";
import { familyOf, weighted, widthsFor, type Forge } from "./document";
import { memberOf, NORMAL_WIDTH, styleNameOf, weightsOf, widthClassOf } from "./family";
import { toTypeface } from "./typeface";
import { anyEffect } from "@/font/effects";
import type { WaveBook } from "./shapes";

/** One member of a family: a weight at a width. */
export interface Member {
  weight: number;
  /** The `wdth` value, a hundred for the Normal. */
  width: number;
  styleName: string;
  fileName: string;
}

export interface Delivery {
  fileName: string;
  bytes: Uint8Array;
  /** What is inside, for saying so: one font, or the members of a family. */
  members: Member[];
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
  const widths = widthsFor(forge);
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
  const many = weights.length > 1 || widths.length > 1;
  if (options.variable && !textured && many && options.format !== "otf") {
    return await varying(forge, familyName, weights, widths, family.drawn);
  }

  const written: Array<Member & { bytes: Uint8Array }> = [];
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
  /*
   * Every weight at every width, as separate files: one file holds one width
   * as surely as it holds one weight, since the OS/2 table has a single class
   * for each. The Normal comes first, and the drawn weight first within it, so
   * that the book is written from the drawing on screen.
   */
  const order = orderOf(weights, widths, family.drawn);
  for (const { weight, width } of order) {
    const member = memberOf(familyName, weight, width);
    const typeface = await toTypeface(weighted(forge, weight, width), {
      familyName,
      styleName: member.styleName,
      weightClass: weight,
      // Said only where it is not a Normal, which then writes what it always did.
      widthClass: width === NORMAL_WIDTH ? undefined : widthClassOf(width),
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
      width,
      styleName: member.styleName,
      fileName: `${member.fileName}.${extension}`,
      bytes: result.bytes,
    });
  }

  // Back into the order somebody asked for, since the drawn weight was drawn
  // first so that it could write the book rather than because it comes first:
  // narrowest first, and lightest first within a width.
  written.sort(
    (one, other) =>
      widths.indexOf(one.width) - widths.indexOf(other.width) ||
      weights.indexOf(one.weight) - weights.indexOf(other.weight),
  );

  const members = written.map(({ weight, width, styleName, fileName }) => ({
    weight,
    width,
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
  widths: number[],
  drawn: number,
): Promise<Delivery> {
  /*
   * A slider for each thing the family has more than one of.
   *
   * The weight first, as it always was, and the width beside it once there is
   * more than one: the Normal is its default because the Normal is what is
   * drawn. A family of one weight and several widths has a width slider only.
   */
  const axes: Axis[] = [];
  if (weights.length > 1) {
    axes.push({
      tag: "wght",
      label: "Weight",
      min: Math.min(...weights),
      default: drawn,
      max: Math.max(...weights),
    });
  }
  if (widths.length > 1) {
    axes.push({
      tag: "wdth",
      label: "Width",
      min: Math.min(...widths),
      default: NORMAL_WIDTH,
      max: Math.max(...widths),
    });
  }
  // Where a member sits, said on the axes the font has and no others.
  const place = (weight: number, width: number): Record<string, number> => ({
    ...(weights.length > 1 ? { wght: weight } : {}),
    ...(widths.length > 1 ? { wdth: width } : {}),
  });
  // Narrowest first and lightest first within a width, the order a font
  // menu lists them in: "Condensed Light", "Condensed", "Condensed Bold".
  const instances: Instance[] = widths.flatMap((width) =>
    weights.map((weight) => ({ label: styleNameOf(weight, width), at: place(weight, width) })),
  );

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
   *
   * The other widths count off the same book, which is what keeps a Condensed
   * wave drawn with as many humps as the Normal one it varies from.
   */
  const waves: WaveBook = {
    lengths: new Map(),
    bowls: new Map(),
    balls: new Map(),
    corners: new Map(),
    recording: true,
  };

  const drawing = async (weight: number, width: number) =>
    await toTypeface(weighted(forge, weight, width), {
      familyName,
      styleName: memberOf(familyName, weight, width).styleName,
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
      kern: weight === drawn && width === NORMAL_WIDTH,
    });

  const master = await drawing(drawn, NORMAL_WIDTH);
  waves.recording = false;

  /*
   * A master at every weight at every width: the ends of each axis and every
   * corner between them, so a Condensed Bold is drawn rather than worked out.
   * Worked out, it would be the Bold's difference added to the Condensed's,
   * and a Bold is not a Regular plus some ink in the same place at every
   * width -- its counters close on a Condensed's counters, which are already
   * narrower. Drawn, it is the corner of a grid, and `buildGvar` writes only
   * what the two differences either side of it do not already say.
   */
  const masters = [];
  for (const { weight, width } of orderOf(weights, widths, drawn)) {
    if (weight === drawn && width === NORMAL_WIDTH) continue;
    masters.push({ at: place(weight, width), typeface: await drawing(weight, width) });
  }

  const result = await exportFont(master, {
    format: "ttf",
    fidelity: "rebuild",
    includeKerning: true,
    mergeOverlaps: false,
    // Drawn here, so the winding says which contour is a counter outright.
    roles: "winding",
    variable: { axes, instances, masters, corners: weights.length > 1 && widths.length > 1 },
  });

  /*
   * The name every foundry gives a variable font: the family, then the axes it
   * carries, in the brackets a font manager knows to read -- in the order of
   * the alphabet, which is the Google Fonts rule and the one everybody else
   * has taken up: `Family[wdth,wght].ttf`. The same rule as an opened font's
   * varying file, from the same place.
   */
  const fileName = `${variableName(
    familyName,
    axes.map((axis) => axis.tag),
  )}.ttf`;
  return {
    fileName,
    bytes: result.bytes,
    members: widths.flatMap((width) =>
      weights.map((weight) => ({
        weight,
        width,
        styleName: styleNameOf(weight, width),
        fileName,
      })),
    ),
    notes: result.notes,
    held: result.held,
  };
}

/**
 * Every weight at every width, in the order they are drawn: the drawing on
 * screen first, then the rest of the Normal, then each other width.
 */
function orderOf(
  weights: number[],
  widths: number[],
  drawn: number,
): Array<{ weight: number; width: number }> {
  const heavy = [drawn, ...weights.filter((weight) => weight !== drawn)];
  const wide = [NORMAL_WIDTH, ...widths.filter((width) => width !== NORMAL_WIDTH)];
  return wide.flatMap((width) => heavy.map((weight) => ({ weight, width })));
}
