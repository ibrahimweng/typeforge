/**
 * The whole family, written out.
 *
 * One place rather than inside the dialog, because what comes out of here is
 * the thing the application exists to produce and it should be testable without
 * a browser in the way. The dialog decides what somebody asked for; this draws
 * it and writes the files.
 */

import { exportFont, type ExportFormat } from "@/font/export";
import { zip } from "@/font/zip";
import { familyOf, weighted, type Forge } from "./document";
import { memberOf, weightsOf } from "./family";
import { toTypeface } from "./typeface";

export interface Delivery {
  fileName: string;
  bytes: Uint8Array;
  /** What is inside, for saying so: one font, or the members of a family. */
  members: Array<{ weight: number; styleName: string; fileName: string }>;
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
  options: { familyName: string; format: ExportFormat },
): Promise<Delivery> {
  const family = familyOf(forge);
  const weights = weightsOf(family);
  const familyName = options.familyName || "Untitled";
  const extension = options.format === "otf" ? "otf" : "ttf";

  const written: Array<{ weight: number; styleName: string; fileName: string; bytes: Uint8Array }> =
    [];
  for (const weight of weights) {
    const member = memberOf(familyName, weight);
    const typeface = await toTypeface(weighted(forge, weight), {
      familyName,
      styleName: member.styleName,
      weightClass: weight,
      merge: true,
    });
    const result = await exportFont(typeface, {
      format: options.format,
      // Nothing to preserve: there was never a source font.
      fidelity: "rebuild",
      includeKerning: false,
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
    return { fileName: written[0].fileName, bytes: written[0].bytes, members };
  }
  const tidy = familyName.replace(/[^A-Za-z0-9]+/g, "") || "Untitled";
  return {
    fileName: `${tidy}.zip`,
    bytes: zip(written.map(({ fileName, bytes }) => ({ name: fileName, bytes }))),
    members,
  };
}
