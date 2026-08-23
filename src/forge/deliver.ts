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

  if (options.variable && weights.length > 1 && options.format !== "otf") {
    return await varying(forge, familyName, weights, family.drawn);
  }

  const written: Array<{ weight: number; styleName: string; fileName: string; bytes: Uint8Array }> =
    [];
  for (const weight of weights) {
    const member = memberOf(familyName, weight);
    const typeface = await toTypeface(weighted(forge, weight), {
      familyName,
      styleName: member.styleName,
      weightClass: weight,
      merge: true,
      kern: true,
    });
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

  const drawing = async (weight: number) =>
    await toTypeface(weighted(forge, weight), {
      familyName,
      styleName: memberOf(familyName, weight).styleName,
      weightClass: weight,
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

  const masters = [];
  for (const weight of weights) {
    if (weight === drawn) continue;
    masters.push({ at: { wght: weight }, typeface: await drawing(weight) });
  }

  const result = await exportFont(await drawing(drawn), {
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
